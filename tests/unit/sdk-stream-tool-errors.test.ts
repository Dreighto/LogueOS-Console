// Tests for the `onFinish` tool-error persistence logic added in the
// 2026-05-27 audit (PR: sdk-stream tool error capture).
//
// The changed behaviour: when the LLM response contains parts whose
// `type` starts with `tool-` AND `state === 'output-error'`, those are
// now formatted and appended to the persisted chat message so the operator
// can find them in the thread history even after the ephemeral streaming
// chips have vanished.
//
// Approach: mock the `ai` module so `toUIMessageStreamResponse` exposes the
// `onFinish` callback to the test, then exercise the callback in isolation
// with crafted `responseMessage.parts` payloads.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Captured callback reference ────────────────────────────────────────────
type OnFinishArg = {
	responseMessage: {
		parts?: Array<{
			type?: string;
			text?: string;
			state?: string;
			errorText?: string;
		}>;
	};
};
let capturedOnFinish: ((arg: OnFinishArg) => void) | null = null;

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock('ai', async () => {
	return {
		streamText: vi.fn().mockReturnValue({
			toUIMessageStreamResponse: vi.fn().mockImplementation((opts: { onFinish?: unknown }) => {
				capturedOnFinish = opts.onFinish as (arg: OnFinishArg) => void;
				return new Response('stream');
			})
		}),
		convertToModelMessages: vi.fn().mockResolvedValue([]),
		generateId: vi.fn().mockReturnValue('mock-id'),
		// `tool` is called at module load time to build the `tools` const;
		// return a minimal passthrough so the import doesn't throw.
		tool: vi.fn().mockImplementation((t: unknown) => t)
	};
});

vi.mock('@ai-sdk/anthropic', () => ({
	createAnthropic: vi.fn().mockReturnValue(() => () => 'mock-anthropic-model')
}));

vi.mock('@ai-sdk/google', () => ({
	createGoogleGenerativeAI: vi.fn().mockReturnValue(() => () => 'mock-google-model')
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
	createOpenAICompatible: vi.fn().mockReturnValue(() => () => 'mock-local-model')
}));

const addChatMessageSpy = vi.fn();
vi.mock('$lib/server/chat', () => ({
	addChatMessage: (...args: unknown[]) => addChatMessageSpy(...args),
	getChatMessages: vi.fn().mockReturnValue([]),
	listChatThreads: vi.fn().mockReturnValue([])
}));

vi.mock('$lib/server/phase_classifier', () => ({
	classifyTier: vi.fn().mockReturnValue('chat')
}));

vi.mock('$lib/server/thread_state', () => ({
	getThreadState: vi.fn().mockReturnValue({ current_tier: 'chat', provider_override: null }),
	upsertThreadTier: vi.fn()
}));

vi.mock('$lib/server/thread_meta', () => ({
	touchLastActivity: vi.fn(),
	upsertThreadMeta: vi.fn()
}));

vi.mock('$lib/server/workspace_context', () => ({
	getWorkspaceContext: vi.fn().mockReturnValue('')
}));

// ─── Import after mocks ──────────────────────────────────────────────────────
import { POST } from '../../src/routes/api/chat/sdk-stream/+server';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal valid POST body that will reach the onFinish stage. */
function makeReq(overrides: Record<string, unknown> = {}): Parameters<typeof POST>[0] {
	const body = {
		provider: 'local' as const, // no credentials needed for local / Ollama
		messages: [
			{
				id: 'msg-1',
				role: 'user' as const,
				parts: [{ type: 'text', text: 'hello' }],
				content: 'hello'
			}
		],
		thread: 'test-thread',
		...overrides
	};
	return {
		request: new Request('http://localhost/api/chat/sdk-stream', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0];
}

/** Invoke the captured onFinish callback with the given parts array. */
function runOnFinish(
	parts: Array<{ type?: string; text?: string; state?: string; errorText?: string }>
) {
	if (!capturedOnFinish) throw new Error('onFinish was not captured — POST not called?');
	capturedOnFinish({ responseMessage: { parts } });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('/api/chat/sdk-stream — onFinish tool error persistence', () => {
	beforeEach(async () => {
		capturedOnFinish = null;
		addChatMessageSpy.mockClear();
		// Trigger POST so that onFinish is captured via the mock.
		await POST(makeReq());
	});

	// ── Happy path: no tool errors ──────────────────────────────────────────

	it('persists plain text reply when there are no tool errors', () => {
		runOnFinish([{ type: 'text', text: 'Hello operator' }]);

		expect(addChatMessageSpy).toHaveBeenCalledOnce();
		const [, finalText] = addChatMessageSpy.mock.calls[0];
		expect(finalText).toBe('Hello operator');
	});

	it('does NOT call addChatMessage when reply is empty and there are no tool errors', () => {
		runOnFinish([{ type: 'text', text: '' }]);

		expect(addChatMessageSpy).not.toHaveBeenCalled();
	});

	it('does NOT call addChatMessage when parts array is empty', () => {
		runOnFinish([]);

		expect(addChatMessageSpy).not.toHaveBeenCalled();
	});

	it('does NOT call addChatMessage when responseMessage has no parts', () => {
		if (!capturedOnFinish) throw new Error('onFinish not captured');
		// Pass responseMessage without `parts` to exercise the `|| []` fallback.
		capturedOnFinish({ responseMessage: {} as OnFinishArg['responseMessage'] });

		expect(addChatMessageSpy).not.toHaveBeenCalled();
	});

	// ── Tool error detection ────────────────────────────────────────────────

	it('appends a single tool error to the reply text', () => {
		runOnFinish([
			{ type: 'text', text: 'Here is what I found.' },
			{ type: 'tool-list_chat_threads', state: 'output-error', errorText: 'DB locked' }
		]);

		expect(addChatMessageSpy).toHaveBeenCalledOnce();
		const [, finalText] = addChatMessageSpy.mock.calls[0];
		expect(finalText).toBe(
			"Here is what I found.\n\n⚠️ Tool 'list_chat_threads' failed: DB locked"
		);
	});

	it('appends multiple tool errors separated by double newlines', () => {
		runOnFinish([
			{ type: 'text', text: 'Partial answer.' },
			{
				type: 'tool-get_server_status',
				state: 'output-error',
				errorText: 'Connection refused'
			},
			{
				type: 'tool-read_thread_messages',
				state: 'output-error',
				errorText: 'Timeout'
			}
		]);

		expect(addChatMessageSpy).toHaveBeenCalledOnce();
		const [, finalText] = addChatMessageSpy.mock.calls[0];
		expect(finalText).toBe(
			"Partial answer.\n\n⚠️ Tool 'get_server_status' failed: Connection refused\n\n⚠️ Tool 'read_thread_messages' failed: Timeout"
		);
	});

	it('persists tool errors even when the reply text is empty', () => {
		// No text part — only a tool error. finalText must still be truthy so
		// addChatMessage gets called.
		runOnFinish([{ type: 'tool-list_chat_threads', state: 'output-error', errorText: 'Oops' }]);

		expect(addChatMessageSpy).toHaveBeenCalledOnce();
		const [, finalText] = addChatMessageSpy.mock.calls[0];
		expect(finalText).toBe("⚠️ Tool 'list_chat_threads' failed: Oops");
	});

	// ── Edge cases: missing fields ──────────────────────────────────────────

	it('falls back to "unknown error" when errorText is absent', () => {
		runOnFinish([
			{ type: 'tool-list_chat_threads', state: 'output-error' } // no errorText
		]);

		const [, finalText] = addChatMessageSpy.mock.calls[0];
		expect(finalText).toContain('unknown error');
	});

	it('falls back to "unknown" tool name when type is undefined', () => {
		// Simulates a runtime shape we don't control (future SDK versions).
		runOnFinish([
			{ state: 'output-error', errorText: 'mystery failure' } // no type
		]);

		// A part without `type` does not start with 'tool-', so it should NOT
		// be treated as a tool error — the filter should exclude it.
		expect(addChatMessageSpy).not.toHaveBeenCalled();
	});

	// ── Non-error tool states must NOT be captured ──────────────────────────

	it('ignores tool parts that are NOT in output-error state', () => {
		runOnFinish([
			{ type: 'text', text: 'Done.' },
			{ type: 'tool-list_chat_threads', state: 'output-ready' }, // success
			{ type: 'tool-list_chat_threads', state: 'input' } // in-flight
		]);

		const [, finalText] = addChatMessageSpy.mock.calls[0];
		// Only the plain text reply — no tool-error suffix.
		expect(finalText).toBe('Done.');
	});

	it('ignores non-tool parts that happen to have state=output-error', () => {
		// A hypothetical part whose type doesn't start with 'tool-'.
		runOnFinish([
			{ type: 'text', text: 'Reply.' },
			{ type: 'step-finish', state: 'output-error', errorText: 'ignored' }
		]);

		const [, finalText] = addChatMessageSpy.mock.calls[0];
		expect(finalText).toBe('Reply.');
	});

	// ── Sender label mapping ────────────────────────────────────────────────

	it('uses sender "local" for provider=local', async () => {
		// (provider is already 'local' from makeReq default)
		runOnFinish([{ type: 'text', text: 'Local reply' }]);

		const [senderLabel] = addChatMessageSpy.mock.calls[0];
		expect(senderLabel).toBe('local');
	});

	it('uses sender "cc" for provider=anthropic', async () => {
		addChatMessageSpy.mockClear();
		capturedOnFinish = null;

		// Override env so pickModel doesn't throw for anthropic.
		const origEnv = process.env.ANTHROPIC_API_KEY;
		process.env.ANTHROPIC_API_KEY = 'test-key';
		try {
			await POST(makeReq({ provider: 'anthropic' }));
			runOnFinish([{ type: 'text', text: 'Anthropic reply' }]);

			const [senderLabel] = addChatMessageSpy.mock.calls[0];
			expect(senderLabel).toBe('cc');
		} finally {
			process.env.ANTHROPIC_API_KEY = origEnv;
		}
	});

	it('uses sender "agy" for provider=google', async () => {
		addChatMessageSpy.mockClear();
		capturedOnFinish = null;

		const origEnv = process.env.GEMINI_API_KEY;
		process.env.GEMINI_API_KEY = 'test-key';
		try {
			await POST(makeReq({ provider: 'google' }));
			runOnFinish([{ type: 'text', text: 'Google reply' }]);

			const [senderLabel] = addChatMessageSpy.mock.calls[0];
			expect(senderLabel).toBe('agy');
		} finally {
			process.env.GEMINI_API_KEY = origEnv;
		}
	});

	// ── Regression: only one addChatMessage call per onFinish ──────────────

	it('calls addChatMessage exactly once even with mixed text and tool-error parts', () => {
		runOnFinish([
			{ type: 'text', text: 'Part A' },
			{ type: 'text', text: ' Part B' },
			{ type: 'tool-list_chat_threads', state: 'output-error', errorText: 'err' },
			{ type: 'tool-get_server_status', state: 'output-error', errorText: 'err2' }
		]);

		// Text parts are concatenated; two tool errors appended — but only one DB write.
		expect(addChatMessageSpy).toHaveBeenCalledOnce();
		const [, finalText] = addChatMessageSpy.mock.calls[0];
		expect(finalText).toContain('Part A Part B');
		expect(finalText).toContain("⚠️ Tool 'list_chat_threads' failed: err");
		expect(finalText).toContain("⚠️ Tool 'get_server_status' failed: err2");
	});
});
