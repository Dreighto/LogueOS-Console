// SDK-native streaming endpoint — Vercel AI SDK 6 / `streamText` +
// `toUIMessageStreamResponse()`. Feature-parity replacement for the legacy
// custom-SSE `/api/chat/stream` route, ready for PR 2b client cutover.
//
// PR 2b.1 (this file): the endpoint accepts the SDK 6 client shape
// (`{ messages: UIMessage[], thread, target_repo, provider?, model? }`)
// AND handles all the legacy responsibilities:
//   - persist operator message + assistant reply to chat_messages
//   - upsert chat_thread_meta + chat_thread_state
//   - classify tier from the latest user message
//   - pick provider via thread_state.provider_override OR explicit body
//   - default to Gemini for chat tier (matches legacy AGY-chat-lock UX)
//   - emit the SDK Data Stream Protocol so useChat() consumes natively
//
// What's intentionally NOT here yet (PR 2b.2 / 2b.3 / PR 4):
//   - multi-provider fall-forward (SDK middleware can add later)
//   - image-gen mode (separate dispatch path)
//   - @cc / @agy dispatch routing (separate non-streaming path)
//   - slash commands (client-side intercept before send)
//   - Ollama / local routing (task #11)
//
// Auth: route falls under /api/chat/* so hooks.server.ts SENSITIVE_PREFIXES
// already covers it. Tailnet-direct passes; Funnel requests 401.
//
// Provider auth (Anthropic OAuth via Claude Max quota — FREE — is preferred
// to billed API key; Gemini API key only for now):
//   Anthropic: CLAUDE_CODE_OAUTH_TOKEN (Bearer) → LOGUEOS_ROUTING_KEY /
//              MIRU_ROUTING_KEY / ANTHROPIC_API_KEY (x-api-key fallback)
//   Google:    GEMINI_API_KEY → GOOGLE_API_KEY

import type { RequestHandler } from './$types';
import { streamText, convertToModelMessages, generateId, tool, type UIMessage } from 'ai';
import { z } from 'zod';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { addChatMessage, getChatMessages, listChatThreads } from '$lib/server/chat';
import { classifyTier, type Tier } from '$lib/server/phase_classifier';
import { getThreadState, upsertThreadTier } from '$lib/server/thread_state';
import { touchLastActivity, upsertThreadMeta } from '$lib/server/thread_meta';
import { getWorkspaceContext } from '$lib/server/workspace_context';

// LogueOS-on-SDK tools — read-only operator-context fetches the LLM can call
// when answering. PR 10a shipped the first tool; PR 10c (this commit) adds
// two more high-value reads. Future PRs (10d+) layer write-tools with
// operator-approval gates (linear_create_issue, service_restart) and the
// full MCP-gateway pass-through. See task #10.
const tools = {
	list_chat_threads: tool({
		description:
			"Lists the operator's chat threads with message counts and latest activity. Use when the operator asks about their threads, history, or what conversations exist.",
		inputSchema: z.object({
			limit: z
				.number()
				.int()
				.min(1)
				.max(50)
				.default(10)
				.describe('How many threads to return (default 10, max 50)')
		}),
		execute: async ({ limit }: { limit?: number }) => {
			const all = listChatThreads();
			const n = Math.min(Math.max(limit ?? 10, 1), 50);
			return {
				count: all.length,
				returned: Math.min(all.length, n),
				threads: all.slice(0, n).map((t) => ({
					thread_id: t.thread_id,
					message_count: t.message_count,
					latest_ts: t.latest_ts
				}))
			};
		}
	}),
	read_thread_messages: tool({
		description:
			"Returns the most recent N messages from a specific chat thread. Use when the operator wants to recall, summarize, or refer back to a conversation — including the active thread when they ask 'what did I say earlier?' or 'summarize this thread'.",
		inputSchema: z.object({
			thread_id: z
				.string()
				.describe(
					'Thread id (use the active thread id from the system context if the operator does not specify one)'
				),
			limit: z
				.number()
				.int()
				.min(1)
				.max(50)
				.default(20)
				.describe('How many recent messages to return (default 20, max 50)')
		}),
		execute: async ({ thread_id, limit }: { thread_id: string; limit?: number }) => {
			const rows = getChatMessages(Math.min(Math.max(limit ?? 20, 1), 50), thread_id);
			return {
				thread_id,
				returned: rows.length,
				messages: rows.map((m) => ({
					sender: m.sender,
					message: m.message,
					timestamp: m.timestamp
				}))
			};
		}
	}),
	get_server_status: tool({
		description:
			'Reports the live status of the operator-facing LogueOS services on this machine (Console, dispatch listener, MCP gateway). Use when the operator asks if services are up, what is running, or troubleshoots a "why did nothing happen" symptom.',
		inputSchema: z.object({}),
		execute: async () => {
			const probes: { name: string; url: string }[] = [
				{ name: 'console', url: 'http://127.0.0.1:18767/console/' },
				{ name: 'dispatch_listener', url: 'http://127.0.0.1:19100/healthz' },
				{ name: 'mcp_gateway', url: 'http://127.0.0.1:18766/mcp' }
			];
			const results = await Promise.all(
				probes.map(async (p) => {
					try {
						const r = await fetch(p.url, {
							method: 'GET',
							signal: AbortSignal.timeout(2000)
						});
						return { name: p.name, url: p.url, ok: r.status < 500, status: r.status };
					} catch (err) {
						return {
							name: p.name,
							url: p.url,
							ok: false,
							error: (err as Error).message
						};
					}
				})
			);
			return { checked_at: new Date().toISOString(), services: results };
		}
	})
};

type Provider = 'anthropic' | 'google' | 'local';

// Local Ollama endpoint — OpenAI-compatible interface at
// http://localhost:11434/v1. Task #11: brings the operator's eGPU into
// play once installed. Works against CPU too while waiting.
const OLLAMA_BASE_URL =
	process.env.OLLAMA_BASE_URL?.replace(/\/+$/, '') || 'http://127.0.0.1:11434';
const OLLAMA_V1 = `${OLLAMA_BASE_URL}/v1`;

// Tier × provider → model id. Mirrors src/lib/server/llm_router.ts so
// behaviour stays aligned; we keep a local copy to avoid pulling in the
// fall-forward routing logic (PR 2b.2 ships single-provider per request;
// SDK middleware can layer fall-forward later if needed).
const TIER_MODELS: Record<Tier, Record<Provider, string>> = {
	chat: {
		anthropic: 'claude-haiku-4-5-20251001',
		google: 'gemini-2.5-flash-lite',
		local: 'qwen2.5:7b'
	},
	planning: {
		anthropic: 'claude-sonnet-4-6',
		google: 'gemini-2.5-flash',
		local: 'qwen2.5:14b'
	},
	deep: {
		anthropic: 'claude-opus-4-7',
		google: 'gemini-2.5-pro',
		local: 'qwen2.5:14b'
	},
	local: {
		// Local tier uses the local provider exclusively now.
		anthropic: 'claude-haiku-4-5-20251001',
		google: 'gemini-2.5-flash-lite',
		local: 'qwen2.5:14b'
	}
};

function getAnthropicAuth(): { authToken?: string; apiKey?: string } {
	const oauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
	if (oauth) return { authToken: oauth };
	const apiKey =
		process.env.LOGUEOS_ROUTING_KEY ||
		process.env.MIRU_ROUTING_KEY ||
		process.env.ANTHROPIC_API_KEY ||
		'';
	if (apiKey) return { apiKey };
	return {};
}

function getGoogleKey(): string {
	return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}

function pickModel(provider: Provider, tier: Tier, requestedModel?: string) {
	const modelId = requestedModel || TIER_MODELS[tier][provider];
	if (provider === 'anthropic') {
		const auth = getAnthropicAuth();
		if (!auth.authToken && !auth.apiKey) {
			throw new Error('Anthropic credential unavailable');
		}
		return { model: createAnthropic(auth)(modelId), modelId };
	}
	if (provider === 'local') {
		// Ollama exposes an OpenAI-compatible interface; no auth required
		// (binds to localhost only — exposed via Tailscale Serve if at all).
		// Task #11 — eGPU local routing for the 5060 Ti.
		const localProvider = createOpenAICompatible({
			name: 'ollama-local',
			baseURL: OLLAMA_V1,
			apiKey: 'ollama' // placeholder, ignored by Ollama but required by SDK shape
		});
		return { model: localProvider(modelId), modelId };
	}
	const apiKey = getGoogleKey();
	if (!apiKey) throw new Error('Google credential unavailable');
	return { model: createGoogleGenerativeAI({ apiKey })(modelId), modelId };
}

function buildSystemPrompt(ctx: {
	targetRepo: string;
	currentTier: Tier;
	threadId: string;
}): string {
	const base = `You are the operator's planning partner inside LogueOS Console.

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

	// Workspace-specific addendum (task #22 — Projects-light). Operator types
	// this once per workspace via the chip's "Edit context" link; auto-
	// injects into every chat send within that workspace. Saves retyping
	// project-specific instructions every new thread.
	const addendum = getWorkspaceContext(ctx.targetRepo);
	if (!addendum) return base;
	return `${base}

Workspace-specific context for ${ctx.targetRepo} (operator-authored):
${addendum}`;
}

// Repo selection from message text — same keyword-scan heuristic as the
// legacy endpoint. Client may also pass an explicit `target_repo`.
function detectTargetRepo(message: string, hint?: string): string {
	if (hint) return hint;
	const text = message.toLowerCase();
	if (text.includes('miru')) return 'project-miru';
	if (
		text.includes('orchestrator') ||
		text.includes('kernel') ||
		text.includes('logueos-orchestrator')
	) {
		return 'LogueOS-Orchestrator';
	}
	if (text.includes('nasdoom')) return 'NASDOOM';
	return 'LogueOS-Console';
}

// Pull the latest user message's plain-text content from a UIMessage[] —
// needed for tier classification + persistence. The SDK ships UIMessage
// with a `parts` array; only `type: "text"` parts are concatenated here.
function latestUserText(messages: UIMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== 'user') continue;
		const parts = m.parts || [];
		const txt = parts
			.filter((p) => p.type === 'text')
			.map((p) => (p as { type: 'text'; text: string }).text)
			.join('');
		if (txt) return txt;
	}
	return '';
}

export const POST: RequestHandler = async ({ request }) => {
	let body: {
		messages?: UIMessage[];
		thread?: string;
		target_repo?: string;
		provider?: Provider;
		model?: string;
	};
	try {
		body = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'invalid_json' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const messages = body.messages ?? [];
	if (!Array.isArray(messages) || messages.length === 0) {
		return new Response(JSON.stringify({ error: 'messages_required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const threadId =
		typeof body.thread === 'string' && body.thread.trim() ? body.thread.trim() : 'default';
	const userText = latestUserText(messages);
	if (!userText) {
		return new Response(JSON.stringify({ error: 'no_text_content' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Persist the operator's message immediately so /api/chat polls see it,
	// the audit JSONL records reflect reality, and other clients (sidebar
	// counts, regen helpers) can pick it up. This matches the legacy
	// endpoint's behaviour.
	addChatMessage('operator', userText, null, null, null, 'sent', threadId);
	upsertThreadMeta(threadId, {});
	touchLastActivity(threadId);

	const threadState = getThreadState(threadId);
	const allForClassify = getChatMessages(30, threadId);
	const recentForClassify = allForClassify.slice(0, -1);
	const currentTier = classifyTier({
		userMessage: userText,
		recentMessages: recentForClassify,
		currentTier: threadState.current_tier,
		operatorOverride: threadState.operator_override
	});
	upsertThreadTier(threadId, currentTier, null);

	const targetRepo = detectTargetRepo(userText, body.target_repo);

	// Provider preference:
	//   1. Explicit body.provider (client just chose a model)
	//   2. thread_state.provider_override (persisted via model picker)
	//   3. Default 'google' (matches legacy AGY-chat-lock UX). Operator can
	//      flip to Anthropic via picker; Anthropic-via-OAuth is free.
	const overrideFromState: Provider | null =
		threadState.provider_override === 'anthropic'
			? 'anthropic'
			: threadState.provider_override === 'gemini'
				? 'google'
				: threadState.provider_override === 'local'
					? 'local'
					: null;
	// Tier 'local' implicitly selects the local provider unless the operator
	// has explicitly overridden. Lets the existing "Local (Ollama)" model
	// picker option route through Ollama without per-thread setup.
	const tierImpliesLocal: Provider | null = currentTier === 'local' ? 'local' : null;
	const provider: Provider = body.provider ?? overrideFromState ?? tierImpliesLocal ?? 'google';

	let modelHandle: { model: ReturnType<ReturnType<typeof createAnthropic>>; modelId: string };
	try {
		modelHandle = pickModel(provider, currentTier, body.model);
	} catch (err) {
		return new Response(
			JSON.stringify({ error: 'credential_unavailable', detail: (err as Error).message }),
			{ status: 503, headers: { 'Content-Type': 'application/json' } }
		);
	}

	const systemPrompt = buildSystemPrompt({ targetRepo, currentTier, threadId });

	const result = streamText({
		model: modelHandle.model,
		system: systemPrompt,
		messages: await convertToModelMessages(messages),
		tools,
		// Cap multi-step tool loops — keeps a runaway "call → reflect → call"
		// chain from consuming Max quota / API budget.
		stopWhen: ({ steps }) => steps.length >= 5
	});

	return result.toUIMessageStreamResponse({
		originalMessages: messages,
		generateMessageId: () => generateId(),
		onFinish: ({ responseMessage }) => {
			// Concatenate every text part of the response into a single string
			// for the chat_messages row. Matches the legacy `addChatMessage`
			// call shape for backwards compatibility with existing readers.
			const replyText = (responseMessage.parts || [])
				.filter((p) => p.type === 'text')
				.map((p) => (p as { type: 'text'; text: string }).text)
				.join('');
			if (replyText) {
				const senderLabel: 'cc' | 'agy' | 'local' =
					provider === 'anthropic' ? 'cc' : provider === 'local' ? 'local' : 'agy';
				addChatMessage(senderLabel, replyText, null, null, null, 'sent', threadId);
			}
			// Persist model_used so the picker chip can show "Claude Haiku 4.5"
			// instead of "Auto" on next render.
			upsertThreadTier(threadId, currentTier, modelHandle.modelId);
			touchLastActivity(threadId);
		}
	});
};
