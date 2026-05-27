// Unit tests for the draft autosave error-handling logic added in the
// 2026-05-27 audit (src/routes/chat/+page.svelte, Draft Persist Effect).
//
// Previously the fetch().catch(() => {}) silently swallowed every failure.
// The new behaviour:
//   - non-ok response  → show a one-time toast, set draftPersistFailing=true
//   - ok response      → clear draftPersistFailing if it was set (recovery)
//   - network error    → show a one-time toast, set draftPersistFailing=true
//   - repeated failure → do NOT show a second toast (dedup via draftPersistFailing flag)
//
// The $effect and $state live inside the Svelte 5 component and cannot be
// extracted without refactoring the source. These tests therefore replicate
// the identical state-machine logic as a self-contained pure function and
// assert its invariants. Any change to the production branches should be
// mirrored here.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mirror of the draft-persist state machine in +page.svelte ───────────────
// Keep in sync with: src/routes/chat/+page.svelte (Draft Persist Effect).
//
// The production code runs inside a `$effect` that fires after each debounce.
// Here we model each debounce tick as a single call to `handleDraftResponse`.
interface ToastSpy {
	add: ReturnType<typeof vi.fn>;
}

function makeStateMachine(toasts: ToastSpy) {
	let draftPersistFailing = false;

	function handleDraftResponse(r: { ok: boolean; status: number }) {
		if (!r.ok) {
			if (!draftPersistFailing) {
				console.warn('[draft] persist failed:', r.status);
				toasts.add(
					`Draft autosave failing (${r.status}) — finish your message before closing the tab.`,
					'error'
				);
				draftPersistFailing = true;
			}
		} else if (draftPersistFailing) {
			draftPersistFailing = false;
		}
	}

	function handleDraftNetworkError(err: unknown) {
		if (!draftPersistFailing) {
			console.warn('[draft] network error:', err);
			toasts.add(
				'Draft autosave failing — finish your message before closing the tab.',
				'error'
			);
			draftPersistFailing = true;
		}
	}

	return {
		handleDraftResponse,
		handleDraftNetworkError,
		getFailingState: () => draftPersistFailing
	};
}
// ─────────────────────────────────────────────────────────────────────────────

describe('Draft persist error handling (chat page Draft Persist Effect)', () => {
	let toasts: ToastSpy;
	let machine: ReturnType<typeof makeStateMachine>;

	beforeEach(() => {
		toasts = { add: vi.fn() };
		machine = makeStateMachine(toasts);
	});

	// ── Happy path ────────────────────────────────────────────────────────────

	it('does not show a toast and keeps flag false when response is ok (200)', () => {
		machine.handleDraftResponse({ ok: true, status: 200 });

		expect(toasts.add).not.toHaveBeenCalled();
		expect(machine.getFailingState()).toBe(false);
	});

	it('does not show a toast on a second consecutive ok response', () => {
		machine.handleDraftResponse({ ok: true, status: 200 });
		machine.handleDraftResponse({ ok: true, status: 200 });

		expect(toasts.add).not.toHaveBeenCalled();
	});

	// ── Non-ok response: first failure ───────────────────────────────────────

	it('shows a toast and sets flag on first non-ok response (500)', () => {
		machine.handleDraftResponse({ ok: false, status: 500 });

		expect(toasts.add).toHaveBeenCalledOnce();
		const [msg, level] = toasts.add.mock.calls[0];
		expect(msg).toContain('500');
		expect(msg).toContain('Draft autosave failing');
		expect(level).toBe('error');
		expect(machine.getFailingState()).toBe(true);
	});

	it('shows a toast and sets flag on first non-ok response (503)', () => {
		machine.handleDraftResponse({ ok: false, status: 503 });

		expect(toasts.add).toHaveBeenCalledOnce();
		const [msg] = toasts.add.mock.calls[0];
		expect(msg).toContain('503');
		expect(machine.getFailingState()).toBe(true);
	});

	// ── Non-ok response: deduplication ───────────────────────────────────────

	it('does NOT show a second toast on repeated non-ok responses', () => {
		machine.handleDraftResponse({ ok: false, status: 500 }); // first — shows toast
		machine.handleDraftResponse({ ok: false, status: 500 }); // second — silent

		expect(toasts.add).toHaveBeenCalledOnce();
	});

	it('does NOT show a second toast after multiple non-ok responses with different status codes', () => {
		machine.handleDraftResponse({ ok: false, status: 500 });
		machine.handleDraftResponse({ ok: false, status: 503 });
		machine.handleDraftResponse({ ok: false, status: 429 });

		expect(toasts.add).toHaveBeenCalledOnce();
	});

	// ── Recovery ─────────────────────────────────────────────────────────────

	it('clears the failing flag when an ok response arrives after a failure', () => {
		machine.handleDraftResponse({ ok: false, status: 500 });
		expect(machine.getFailingState()).toBe(true);

		machine.handleDraftResponse({ ok: true, status: 200 });
		expect(machine.getFailingState()).toBe(false);
	});

	it('does not show a new toast when recovering (ok after failure)', () => {
		machine.handleDraftResponse({ ok: false, status: 500 }); // toast shown
		toasts.add.mockClear(); // clear so we can check nothing new is added

		machine.handleDraftResponse({ ok: true, status: 200 }); // recovery
		expect(toasts.add).not.toHaveBeenCalled();
	});

	it('shows a new toast after recovery then a new failure', () => {
		machine.handleDraftResponse({ ok: false, status: 500 }); // first failure
		machine.handleDraftResponse({ ok: true, status: 200 }); // recovery
		toasts.add.mockClear();

		machine.handleDraftResponse({ ok: false, status: 500 }); // second failure
		expect(toasts.add).toHaveBeenCalledOnce();
	});

	// ── Network error: first failure ─────────────────────────────────────────

	it('shows a toast and sets flag on first network error (TypeError: Failed to fetch)', () => {
		machine.handleDraftNetworkError(new TypeError('Failed to fetch'));

		expect(toasts.add).toHaveBeenCalledOnce();
		const [msg, level] = toasts.add.mock.calls[0];
		expect(msg).toContain('Draft autosave failing');
		expect(level).toBe('error');
		expect(machine.getFailingState()).toBe(true);
	});

	it('network error toast does NOT include a status code (no response available)', () => {
		machine.handleDraftNetworkError(new Error('Network failure'));

		const [msg] = toasts.add.mock.calls[0];
		// The network-error branch uses a fixed message without a status code.
		expect(msg).not.toMatch(/\(\d{3}\)/);
	});

	// ── Network error: deduplication ─────────────────────────────────────────

	it('does NOT show a second toast on repeated network errors', () => {
		machine.handleDraftNetworkError(new Error('fetch failed'));
		machine.handleDraftNetworkError(new Error('fetch failed again'));

		expect(toasts.add).toHaveBeenCalledOnce();
	});

	// ── Mixed sequence ────────────────────────────────────────────────────────

	it('deduplicates across non-ok response followed by network error', () => {
		machine.handleDraftResponse({ ok: false, status: 500 }); // sets flag, shows toast
		machine.handleDraftNetworkError(new Error('fetch failed')); // flag already set, silent

		expect(toasts.add).toHaveBeenCalledOnce();
	});

	it('recovery via ok response also clears flag set by a network error', () => {
		machine.handleDraftNetworkError(new Error('fetch failed'));
		expect(machine.getFailingState()).toBe(true);

		machine.handleDraftResponse({ ok: true, status: 200 });
		expect(machine.getFailingState()).toBe(false);
	});

	// ── Regression: toast includes status code only for HTTP failures ─────────

	it('non-ok response toast includes the HTTP status code', () => {
		machine.handleDraftResponse({ ok: false, status: 404 });

		const [msg] = toasts.add.mock.calls[0];
		expect(msg).toContain('404');
	});

	it('network error toast does NOT include a status code', () => {
		machine.handleDraftNetworkError(new TypeError('Failed to fetch'));

		const [msg] = toasts.add.mock.calls[0];
		expect(msg).toBe(
			'Draft autosave failing — finish your message before closing the tab.'
		);
	});
});