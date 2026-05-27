// SDK-native streaming endpoint — Vercel AI SDK 6 / `streamText` +
// `toUIMessageStreamResponse()`. Side-by-side with the legacy custom-SSE
// `/api/chat/stream` route. The client will migrate to this once PR 2 wires
// `useChat()` into the surface.
//
// PR 1 scope (this file): the endpoint exists, accepts the SDK 6 request
// shape (`{ messages: UIMessage[], provider?, model? }`), returns the SDK
// Data Stream Protocol via `result.toUIMessageStreamResponse()`. NO client
// changes, NO persistence — that's PR 2. The existing legacy endpoint stays
// untouched so the live chat surface keeps working unchanged.
//
// Auth: the route is under `/api/chat/*` which is already in
// SENSITIVE_PREFIXES in hooks.server.ts — Funnel requests get 401.
// Tailnet-direct passes through as the operator.
//
// Provider routing (PR 1 baseline — to be expanded in PR 2/3):
//   - Anthropic: LOGUEOS_ROUTING_KEY → MIRU_ROUTING_KEY (back-compat)
//                → ANTHROPIC_API_KEY (last resort). Canonical env name
//                is LOGUEOS_ROUTING_KEY post de-Miru rename.
//   - Google:    GEMINI_API_KEY → GOOGLE_API_KEY fallback (API-key path
//                only; OAuth via ~/.gemini/oauth_creds.json comes in PR 2
//                where it gets the custom HttpClient wiring it needs).

import type { RequestHandler } from './$types';
import { streamText, convertToModelMessages, type UIMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

type Provider = 'anthropic' | 'google';

const DEFAULT_MODELS: Record<Provider, string> = {
	anthropic: 'claude-haiku-4-5-20251001',
	google: 'gemini-2.5-flash-lite'
};

function getAnthropicKey(): string {
	return (
		process.env.LOGUEOS_ROUTING_KEY ||
		process.env.MIRU_ROUTING_KEY ||
		process.env.ANTHROPIC_API_KEY ||
		''
	);
}

function getGoogleKey(): string {
	return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}

function pickModel(provider: Provider, requested?: string) {
	const modelId = requested || DEFAULT_MODELS[provider];
	if (provider === 'anthropic') {
		const apiKey = getAnthropicKey();
		if (!apiKey) throw new Error('Anthropic credential unavailable');
		return createAnthropic({ apiKey })(modelId);
	}
	const apiKey = getGoogleKey();
	if (!apiKey) throw new Error('Google credential unavailable');
	return createGoogleGenerativeAI({ apiKey })(modelId);
}

function buildSystemPrompt(): string {
	// Smaller prompt than the legacy endpoint while PR 1 is just plumbing —
	// the full system prompt + per-thread context land in PR 2 alongside the
	// useChat() client integration.
	return [
		'You are the operator dreighto’s planning partner inside LogueOS Console.',
		'',
		'Style:',
		'- Plain English. Operator is not a coder.',
		'- Direct, no preamble, no “Great question!”.',
		'- Brief — operator is often on iPhone; walls of text feel like noise.'
	].join('\n');
}

export const POST: RequestHandler = async ({ request }) => {
	let body: { messages?: UIMessage[]; provider?: Provider; model?: string };
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

	const provider: Provider = body.provider === 'google' ? 'google' : 'anthropic';

	let model;
	try {
		model = pickModel(provider, body.model);
	} catch (err) {
		return new Response(
			JSON.stringify({ error: 'credential_unavailable', detail: (err as Error).message }),
			{ status: 503, headers: { 'Content-Type': 'application/json' } }
		);
	}

	const result = streamText({
		model,
		system: buildSystemPrompt(),
		messages: await convertToModelMessages(messages)
	});

	return result.toUIMessageStreamResponse();
};
