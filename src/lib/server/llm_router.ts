// LLM Router — OAuth-first auth chain + cross-provider fall-forward.
//
// Routes by tier (chat / planning / deep / local) with provider preference
// order: anthropic → gemini → openai → ollama. Gemini-preference mode
// is used when the operator has selected the 'agy' agent lock.
//
// 402 billing error: rotate credential within same provider, do NOT
// drop to a lower model tier. Surface the error.
//
// 5xx / cap-exhausted: fall forward to next-cheapest provider in the
// SAME tier before returning an error to the operator.
//
// Always returns provider_used + model_used so the UI can display them.

import * as anthropic from './providers/anthropic';
import * as gemini from './providers/gemini';
import * as openai from './providers/openai';
import * as ollama from './providers/ollama';
import { getTokenUsage, addTokenUsage } from './thread_state';
import type { Tier } from './phase_classifier';

export type { Tier };

// Model IDs per tier per provider.
const TIER_MODELS: Record<Tier, Partial<Record<Provider, string>>> = {
	chat: {
		anthropic: 'claude-haiku-4-5-20251001',
		gemini: 'gemini-2.5-flash-lite',
		openai: 'gpt-4o-mini',
		ollama: 'qwen2.5:7b'
	},
	planning: {
		anthropic: 'claude-sonnet-4-6',
		gemini: 'gemini-2.5-flash',
		openai: 'gpt-4o',
		ollama: 'qwen2.5:14b'
	},
	deep: {
		anthropic: 'claude-opus-4-7',
		gemini: 'gemini-2.5-pro',
		openai: 'gpt-4o',
		ollama: 'qwen2.5:14b'
	},
	local: {
		ollama: 'qwen2.5:14b'
	}
};

type Provider = 'anthropic' | 'gemini' | 'openai' | 'ollama';

// Default provider order: Anthropic first (Claude Max sub), Gemini second
// (OAuth), OpenAI third (API key only), Ollama last (local).
const DEFAULT_ORDER: Provider[] = ['anthropic', 'gemini', 'openai', 'ollama'];
// When operator selects the 'agy' agent lock, Gemini goes first.
const GEMINI_FIRST_ORDER: Provider[] = ['gemini', 'anthropic', 'openai', 'ollama'];

export interface RouterMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface RouterResult {
	reply: string;
	provider_used: string;
	model_used: string;
	tokens_used: number;
	/** True if router fell forward from the operator's preferred provider. */
	fell_forward: boolean;
}

function getDailyTokenCap(provider: Provider): number {
	const caps: Record<Provider, number> = {
		anthropic: parseInt(process.env.ANTHROPIC_DAILY_TOKEN_CAP || '1000000', 10),
		openai: parseInt(process.env.OPENAI_DAILY_TOKEN_CAP || '200000', 10),
		gemini: parseInt(process.env.GEMINI_DAILY_TOKEN_CAP || '2000000', 10),
		ollama: Infinity
	};
	return caps[provider] ?? Infinity;
}

function isCapExceeded(provider: Provider): boolean {
	if (provider === 'ollama') return false;
	const used = getTokenUsage(provider);
	const cap = getDailyTokenCap(provider);
	return used >= cap;
}

function getStatus(err: unknown): number {
	return (err as { status?: number }).status ?? 0;
}

export async function routeChat(
	tier: Tier,
	messages: RouterMessage[],
	/** 'gemini' to prefer Gemini (agy lock), undefined for Anthropic-first. */
	preference?: 'gemini',
	signal?: AbortSignal
): Promise<RouterResult> {
	const order = preference === 'gemini' ? GEMINI_FIRST_ORDER : DEFAULT_ORDER;

	// For 'local' tier, only Ollama is in the map.
	const filteredOrder: Provider[] = tier === 'local' ? ['ollama'] : order;

	let fell_forward = false;

	for (let i = 0; i < filteredOrder.length; i++) {
		const provider = filteredOrder[i];
		const model = TIER_MODELS[tier]?.[provider];
		if (!model) continue;

		// Skip unavailable providers and cap-exceeded ones.
		if (provider !== 'ollama' && isCapExceeded(provider)) {
			fell_forward = true;
			continue;
		}

		try {
			let result: { reply: string; usage: { input: number; output: number; total: number } };

			if (provider === 'anthropic') {
				if (!anthropic.isAvailable()) continue;
				result = await anthropic.chat({ messages, model, signal });
			} else if (provider === 'gemini') {
				if (!gemini.isAvailable()) continue;
				result = await gemini.chat({ messages, model, signal });
			} else if (provider === 'openai') {
				if (!openai.isAvailable()) continue;
				result = await openai.chat({ messages, model, signal });
			} else {
				result = await ollama.chat({ messages, model, signal });
			}

			// Track usage.
			addTokenUsage(provider, result.usage.total);

			return {
				reply: result.reply,
				provider_used: provider,
				model_used: model,
				tokens_used: result.usage.total,
				fell_forward
			};
		} catch (err) {
			const status = getStatus(err);

			// 402 billing: rotate credential within provider (don't tier-down),
			// but there's only one credential per provider here — surface error
			// directly rather than silently falling forward.
			if (status === 402) {
				throw new Error(
					`${provider} billing limit (402). Credential rotation required — check account standing.`
				);
			}

			// 5xx or cap-exhausted: fall forward to next provider in same tier.
			console.error(`[llm_router] ${provider} failed (HTTP ${status || 'unknown'}):`, err);
			fell_forward = true;
			// Continue to next provider in loop.
		}
	}

	throw new Error(`All providers exhausted for tier '${tier}'. Check provider keys and daily caps.`);
}
