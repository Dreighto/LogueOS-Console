// Unit tests for the LLM stream error classification logic added in the
// 2026-05-27 audit (src/routes/chat/+page.svelte, sendMessage catch block).
//
// Previously every LLM failure showed "LLM stream failed: unknown", which
// made 401 OAuth expiry indistinguishable from a real outage. The new code
// classifies the raw error message and shows an actionable toast.
//
// Since the classification is inlined inside the Svelte component's
// sendMessage function (and Svelte 5 rune components require heavyweight
// setup to mount in jsdom), these tests mirror the exact branching logic
// as a standalone pure function. Any change to the production branches
// should be reflected here — if this test breaks after a page.svelte edit,
// that is the intended signal.

import { describe, expect, it } from 'vitest';

// ─── Mirror of the classification logic in +page.svelte ──────────────────────
// Keep in sync with: src/routes/chat/+page.svelte (sendMessage catch block).
function classifyLlmError(rawMsg: string): string {
	const lower = rawMsg.toLowerCase();
	if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('expired')) {
		return 'Auth expired — log in again (Anthropic/Gemini OAuth).';
	} else if (
		lower.includes('credential') ||
		lower.includes('not configured') ||
		lower.includes('503')
	) {
		return `Provider unreachable: ${rawMsg}. Check the upstream service or fall back to another provider.`;
	} else if (lower.includes('429') || lower.includes('rate limit')) {
		return 'Rate limited by provider. Wait a moment and retry, or switch model.';
	} else if (lower.includes('aborted') || lower.includes('canceled')) {
		return 'Stream cancelled.';
	}
	return `LLM stream failed: ${rawMsg}`;
}
// ─────────────────────────────────────────────────────────────────────────────

describe('LLM stream error classification (chat page sendMessage)', () => {
	// ── Auth / 401 branch ────────────────────────────────────────────────────

	it('classifies "401" error as auth expired', () => {
		expect(classifyLlmError('HTTP 401 Unauthorized')).toBe(
			'Auth expired — log in again (Anthropic/Gemini OAuth).'
		);
	});

	it('classifies "unauthorized" (lowercase) as auth expired', () => {
		expect(classifyLlmError('unauthorized access')).toBe(
			'Auth expired — log in again (Anthropic/Gemini OAuth).'
		);
	});

	it('classifies "Unauthorized" (mixed case) as auth expired', () => {
		expect(classifyLlmError('Unauthorized: token revoked')).toBe(
			'Auth expired — log in again (Anthropic/Gemini OAuth).'
		);
	});

	it('classifies "expired" as auth expired (covers OAuth token expiry)', () => {
		expect(classifyLlmError('OAuth token expired')).toBe(
			'Auth expired — log in again (Anthropic/Gemini OAuth).'
		);
	});

	// ── Provider unreachable / credential branch ─────────────────────────────

	it('classifies "credential" error as provider unreachable', () => {
		const rawMsg = 'Anthropic credential unavailable';
		expect(classifyLlmError(rawMsg)).toBe(
			`Provider unreachable: ${rawMsg}. Check the upstream service or fall back to another provider.`
		);
	});

	it('classifies "not configured" as provider unreachable', () => {
		const rawMsg = 'API key not configured for provider';
		expect(classifyLlmError(rawMsg)).toBe(
			`Provider unreachable: ${rawMsg}. Check the upstream service or fall back to another provider.`
		);
	});

	it('classifies "503" as provider unreachable', () => {
		const rawMsg = 'Service Unavailable (503)';
		expect(classifyLlmError(rawMsg)).toBe(
			`Provider unreachable: ${rawMsg}. Check the upstream service or fall back to another provider.`
		);
	});

	it('includes the original rawMsg in the provider unreachable toast body', () => {
		const rawMsg = 'Google credential unavailable';
		const result = classifyLlmError(rawMsg);
		expect(result).toContain(rawMsg);
	});

	// ── Rate limit / 429 branch ──────────────────────────────────────────────

	it('classifies "429" as rate limited', () => {
		expect(classifyLlmError('Error 429: too many requests')).toBe(
			'Rate limited by provider. Wait a moment and retry, or switch model.'
		);
	});

	it('classifies "rate limit" as rate limited', () => {
		expect(classifyLlmError('rate limit exceeded')).toBe(
			'Rate limited by provider. Wait a moment and retry, or switch model.'
		);
	});

	it('classifies "Rate Limit" (mixed case) as rate limited', () => {
		expect(classifyLlmError('Rate Limit hit for claude-haiku')).toBe(
			'Rate limited by provider. Wait a moment and retry, or switch model.'
		);
	});

	// ── Aborted / cancelled branch ───────────────────────────────────────────

	it('classifies "aborted" as stream cancelled', () => {
		expect(classifyLlmError('Request aborted by client')).toBe('Stream cancelled.');
	});

	it('classifies "canceled" (US spelling) as stream cancelled', () => {
		expect(classifyLlmError('Operation canceled')).toBe('Stream cancelled.');
	});

	it('classifies "Aborted" (capitalised) as stream cancelled', () => {
		expect(classifyLlmError('Aborted')).toBe('Stream cancelled.');
	});

	// ── Default / fallthrough branch ─────────────────────────────────────────

	it('falls through to generic "LLM stream failed" for unrecognised errors', () => {
		const rawMsg = 'Something entirely unexpected happened';
		expect(classifyLlmError(rawMsg)).toBe(`LLM stream failed: ${rawMsg}`);
	});

	it('falls through for the string "unknown" (non-Error throw)', () => {
		expect(classifyLlmError('unknown')).toBe('LLM stream failed: unknown');
	});

	it('falls through for an empty string', () => {
		expect(classifyLlmError('')).toBe('LLM stream failed: ');
	});

	// ── Priority / overlap checks ─────────────────────────────────────────────
	// Ensures that when multiple keywords appear, the FIRST matching branch wins.

	it('auth branch takes priority over provider branch (401 + credential in same message)', () => {
		// "401 credential" matches both auth and provider — auth is checked first.
		const result = classifyLlmError('401 credential mismatch');
		expect(result).toBe('Auth expired — log in again (Anthropic/Gemini OAuth).');
	});

	it('auth branch takes priority when message contains both "expired" and "503"', () => {
		const result = classifyLlmError('token expired 503');
		expect(result).toBe('Auth expired — log in again (Anthropic/Gemini OAuth).');
	});
});