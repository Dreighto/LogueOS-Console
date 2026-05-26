// Streaming chat endpoint — Server-Sent Events transport for the
// conversational chat path. Mirrors the routeChat branch of /api/chat but
// emits tokens as they arrive from the LLM provider so the UI can render
// the reply live instead of waiting on a full block.
//
// Body shape matches /api/chat (`message`, `thread`, optionally `agent`).
// Reserved for the conversational case — dispatch, image, hermes, workflow
// still POST /api/chat as before.
//
// SSE event format:
//   data: {"type":"token","text":"..."}\n\n     → append to current reply
//   data: {"type":"done","provider":"gemini",
//          "model":"gemini-2.5-flash-lite","trace_id":"..."}\n\n
//   data: {"type":"error","message":"..."}\n\n  → terminal failure

import type { RequestHandler } from './$types';
import { addChatMessage, getChatMessages } from '$lib/server/chat';
import { classifyTier } from '$lib/server/phase_classifier';
import { getThreadState, upsertThreadTier } from '$lib/server/thread_state';
import { routeChatStream } from '$lib/server/llm_router';
import type { RouterMessage } from '$lib/server/llm_router';
import { touchLastActivity, upsertThreadMeta } from '$lib/server/thread_meta';

function buildSystemPrompt(ctx: {
	targetRepo: string;
	currentTier: string;
	threadId: string;
}): string {
	return `You are the operator's planning partner inside LogueOS Console.

Operator profile — Captain (dreighto):
- Not a coder. Plain English first, technical detail only when it adds value.
- Direct tone. No "Great question!" openers, no preamble, no recapping the question back.
- Hates being lectured. Don't restate your role unless asked.

LogueOS context (background — don't lecture about it):
- Kernel: LogueOS-Orchestrator. Project payloads: LogueOS-Console, project-miru, NASDOOM.
- Workers: CC (Claude Code) and AGY (Antigravity / Gemini-class). Both ship code via dispatched sessions.
- This surface is for conversation, not execution. The operator dispatches real work by typing @cc / @agy in the chat, or pressing workflow buttons (Critique / Build / Verify / Retry) on a previous reply.
- Active workspace: ${ctx.targetRepo} · Tier: ${ctx.currentTier} · Thread: ${ctx.threadId}

Rules:
- Answer the actual question briefly. Operator is often on iPhone — long replies become walls.
- If a task needs files edited, commands run, tests written, PRs opened, or services restarted, say "that's a @cc job" (or @agy) — don't pretend you can do it from this chat.
- Never claim to have done something you didn't.
- If you're uncertain, say so plainly.`;
}

export const POST: RequestHandler = async ({ request }) => {
	// Propagate client disconnect down to the upstream LLM call so we don't
	// hold the node process open after the operator navigates away. Without
	// this, an in-flight SSE connection blocks the systemd service from
	// SIGTERMing cleanly during deploy/restart cycles (90s+ shutdown).
	const upstreamAbort = new AbortController();
	request.signal.addEventListener('abort', () => upstreamAbort.abort());

	const body = await request.json().catch(() => ({}));
	const { sender, message } = body as { sender?: string; message?: string };
	const threadId: string =
		(body && typeof body.thread === 'string' ? body.thread.trim() : '') || 'default';

	if (!message || !message.trim()) {
		return new Response(JSON.stringify({ error: 'Message content is required.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Persist the operator's message immediately so subsequent polls see it.
	addChatMessage(sender || 'operator', message.trim(), null, null, null, 'sent', threadId);
	upsertThreadMeta(threadId, {});
	touchLastActivity(threadId);

	const threadState = getThreadState(threadId);
	const allForClassify = getChatMessages(30, threadId);
	const recentForClassify = allForClassify.slice(0, -1);
	const currentTier = classifyTier({
		userMessage: message.trim(),
		recentMessages: recentForClassify,
		currentTier: threadState.current_tier,
		operatorOverride: threadState.operator_override
	});
	upsertThreadTier(threadId, currentTier, null);

	// Repo selection — same heuristic as /api/chat (text-keyword scan).
	const text = message.toLowerCase();
	let targetRepo = 'LogueOS-Console';
	if (text.includes('miru')) targetRepo = 'project-miru';
	else if (
		text.includes('orchestrator') ||
		text.includes('kernel') ||
		text.includes('logueos-orchestrator')
	)
		targetRepo = 'LogueOS-Orchestrator';
	else if (text.includes('nasdoom')) targetRepo = 'NASDOOM';

	// Assemble router messages from the thread history, capped at 20.
	const allHistory = getChatMessages(30, threadId);
	let lastResetIdx = -1;
	for (let i = allHistory.length - 1; i >= 0; i--) {
		if (
			allHistory[i].sender === 'system' &&
			allHistory[i].message.startsWith('--- NEW CONVERSATION ---')
		) {
			lastResetIdx = i;
			break;
		}
	}
	const slice = (lastResetIdx >= 0 ? allHistory.slice(lastResetIdx + 1) : allHistory).slice(0, -1);
	const routerMessages: RouterMessage[] = [
		...slice
			.filter((r) => r.sender !== 'system')
			.map((r) => ({
				role: (r.sender === 'operator' ? 'user' : 'assistant') as 'user' | 'assistant',
				content: r.message
			})),
		{ role: 'user' as const, content: message.trim() }
	].slice(-20);

	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (obj: object) => {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
			};
			try {
				// Provider preference order:
				//   1. Operator's persisted provider_override (if set via the
				//      model picker) — pin to that provider.
				//   2. Default to 'gemini' (AGY chat lock) since this endpoint
				//      serves the conversational path AGY is responsible for.
				const providerPref =
					threadState.provider_override === 'anthropic' ||
					threadState.provider_override === 'gemini'
						? threadState.provider_override
						: 'gemini';
				for await (const evt of routeChatStream(
					currentTier,
					routerMessages,
					providerPref,
					upstreamAbort.signal,
					buildSystemPrompt({ targetRepo, currentTier, threadId })
				)) {
					if (evt.type === 'token') {
						send({ type: 'token', text: evt.text });
					} else {
						// Persist the assembled reply to DB so subsequent polls and
						// other clients see it.
						addChatMessage('agy', evt.reply, null, null, null, 'sent', threadId);
						upsertThreadTier(threadId, currentTier, evt.model_used);
						send({
							type: 'done',
							provider_used: evt.provider_used,
							model_used: evt.model_used,
							tokens_used: evt.tokens_used,
							fell_forward: evt.fell_forward
						});
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'unknown error';
				console.error('[/api/chat/stream] error:', err);
				send({ type: 'error', message: msg.slice(0, 300) });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		status: 200,
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
