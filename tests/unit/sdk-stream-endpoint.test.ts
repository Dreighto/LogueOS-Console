// Shape-only tests for /api/chat/sdk-stream — verifies error paths that
// don't need a live LLM credential. Smoke-testing a real stream lives in
// the e2e suite, gated by env vars at the CI runner.
//
// What we assert here:
//   - POST with no body → 400 invalid_json
//   - POST with empty messages → 400 messages_required
//
// The happy path (200 streaming response) is exercised by curl during local
// dev / preview verification, and will be added to the e2e suite once PR 2
// lands the client-side useChat() wiring.

import { describe, expect, it } from 'vitest';
import { POST } from '../../src/routes/api/chat/sdk-stream/+server';

function makeReq(body: unknown): Parameters<typeof POST>[0] {
	const init: RequestInit = {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	};
	return {
		request: new Request('http://localhost/api/chat/sdk-stream', init)
	} as Parameters<typeof POST>[0];
}

describe('/api/chat/sdk-stream — input validation', () => {
	it('returns 400 invalid_json on non-JSON body', async () => {
		const resp = await POST(makeReq('this is not json'));
		expect(resp.status).toBe(400);
		const body = (await resp.json()) as { error: string };
		expect(body.error).toBe('invalid_json');
	});

	it('returns 400 messages_required when messages is missing', async () => {
		const resp = await POST(makeReq({}));
		expect(resp.status).toBe(400);
		const body = (await resp.json()) as { error: string };
		expect(body.error).toBe('messages_required');
	});

	it('returns 400 messages_required when messages is empty array', async () => {
		const resp = await POST(makeReq({ messages: [] }));
		expect(resp.status).toBe(400);
		const body = (await resp.json()) as { error: string };
		expect(body.error).toBe('messages_required');
	});

	it('returns 400 messages_required when messages is not an array', async () => {
		const resp = await POST(makeReq({ messages: 'oops' }));
		expect(resp.status).toBe(400);
		const body = (await resp.json()) as { error: string };
		expect(body.error).toBe('messages_required');
	});
});
