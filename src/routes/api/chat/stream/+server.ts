import type { RequestHandler } from './$types';
import { addChatMessage, getChatMessages } from '$lib/server/chat';
import { classifyTier } from '$lib/server/phase_classifier';
import { getThreadState, upsertThreadTier } from '$lib/server/thread_state';
import { touchLastActivity, upsertThreadMeta } from '$lib/server/thread_meta';

import { streamText, convertToModelMessages } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TIER_MODELS: Record<string, Partial<Record<string, string>>> = {
	chat: {
		anthropic: 'claude-3-5-haiku-latest', // mapping internal to SDK
		gemini: 'gemini-2.5-flash-lite',
		openai: 'gpt-4o-mini',
	},
	planning: {
		anthropic: 'claude-3-7-sonnet-latest',
		gemini: 'gemini-2.5-flash',
		openai: 'gpt-4o',
	},
	deep: {
		anthropic: 'claude-3-opus-latest',
		gemini: 'gemini-2.5-pro',
		openai: 'gpt-4o',
	}
};

function resolveModel(tier: string, providerPref: string) {
	const modelId = TIER_MODELS[tier]?.[providerPref] || TIER_MODELS['chat'][providerPref];
	if (!modelId) {
		return google('gemini-2.5-flash-lite'); // fallback
	}
	if (providerPref === 'anthropic') return anthropic(modelId);
	if (providerPref === 'openai') return openai(modelId);
	return google(modelId);
}

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
	const body = await request.json().catch(() => ({}));
	const { id, messages } = body as { id?: string; messages?: any[] };
	const threadId = (id || 'default').trim();

	if (!messages || messages.length === 0) {
		return new Response(JSON.stringify({ error: 'Messages array is required.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// The SDK messages array comes directly from the client.
	// We need to persist the operator's message immediately.
	const userMessage = messages[messages.length - 1];
	
	// We need to handle attachments in the operator's message if any.
	// Vercel AI SDK puts them in experimental_attachments or just inline.
	// The prompt states: "Vision support: the SDK natively handles ContentPart for images.
	// But instead of building our own ContentPart type, use the SDK's experimental_attachments field on the message OR include image parts in the content array per the SDK's UIMessage schema."
	
	// We just persist the text part to DB for now.
	const userText = typeof userMessage.content === 'string' ? userMessage.content : 
		(userMessage.content.find((p: any) => p.type === 'text')?.text || '');

	addChatMessage('operator', userText.trim(), null, null, null, 'sent', threadId);
	upsertThreadMeta(threadId, {});
	touchLastActivity(threadId);

	const threadState = getThreadState(threadId);
	const allForClassify = getChatMessages(30, threadId);
	const recentForClassify = allForClassify.slice(0, -1);
	const currentTier = classifyTier({
		userMessage: userText.trim(),
		recentMessages: recentForClassify,
		currentTier: threadState.current_tier,
		operatorOverride: threadState.operator_override
	});
	upsertThreadTier(threadId, currentTier, null);

	const textLower = userText.toLowerCase();
	let targetRepo = 'LogueOS-Console';
	if (textLower.includes('miru')) targetRepo = 'project-miru';
	else if (
		textLower.includes('orchestrator') ||
		textLower.includes('kernel') ||
		textLower.includes('logueos-orchestrator')
	)
		targetRepo = 'LogueOS-Orchestrator';
	else if (textLower.includes('nasdoom')) targetRepo = 'NASDOOM';

	const providerPref =
		threadState.provider_override === 'anthropic' ||
		threadState.provider_override === 'gemini' ||
		threadState.provider_override === 'openai'
			? threadState.provider_override
			: 'gemini';

	const selectedModel = resolveModel(currentTier, providerPref);

	const result = streamText({
		model: selectedModel,
		system: buildSystemPrompt({ targetRepo, currentTier, threadId }),
		messages: convertToModelMessages(messages),
		onFinish: async ({ response }) => {
			// Persist assistant message with the SDK-generated ID
			const assistantContent = response.messages.find(m => m.role === 'assistant')?.content;
			const replyText = typeof assistantContent === 'string' ? assistantContent : 
				(Array.isArray(assistantContent) ? assistantContent.find((p: any) => p.type === 'text')?.text || '' : '');
			
			addChatMessage('agy', replyText, null, null, null, 'sent', threadId);
			upsertThreadTier(threadId, currentTier, selectedModel.modelId);
		}
	});

	result.consumeStream(); // ← KEY: keeps draining into DB even if client disconnects
	return result.toDataStreamResponse();
};
