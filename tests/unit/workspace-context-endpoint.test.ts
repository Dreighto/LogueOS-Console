// Input-validation tests for /api/chat/workspaces/[name]/context.
// Covers CR (PR #140) finding: non-string addendum should be rejected
// rather than silently coerced to '' (which would clear stored context).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDbPath: string;

vi.mock('$lib/server/config', () => ({
	get serverConfig() {
		return { memoryDbPath: tmpDbPath };
	}
}));

import { PUT, GET } from '../../src/routes/api/chat/workspaces/[name]/context/+server';

type PutArgs = Parameters<typeof PUT>[0];
type GetArgs = Parameters<typeof GET>[0];

function makePut(name: string, body: unknown): PutArgs {
	const init: RequestInit = {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	};
	return {
		params: { name },
		request: new Request(`http://localhost/api/chat/workspaces/${name}/context`, init)
	} as unknown as PutArgs;
}

function makeGet(name: string): GetArgs {
	return { params: { name } } as unknown as GetArgs;
}

beforeEach(() => {
	tmpDbPath = path.join(os.tmpdir(), `wc-endpoint-${Date.now()}-${Math.random()}.db`);
});

afterEach(() => {
	if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
});

describe('PUT /api/chat/workspaces/[name]/context — input validation', () => {
	it('returns 400 invalid_json on malformed JSON body', async () => {
		const resp = await PUT(makePut('LogueOS-Console', 'not json'));
		expect(resp.status).toBe(400);
		const body = (await resp.json()) as { error: string };
		expect(body.error).toBe('invalid_json');
	});

	// CR finding #2 — null/non-string addendum used to coerce to '' and clear
	// the stored value. Now it must 400.
	it('returns 400 invalid_addendum for null addendum (does not clear)', async () => {
		// Seed a value first.
		await PUT(makePut('LogueOS-Console', { addendum: 'precious context' }));
		const seeded = await GET(makeGet('LogueOS-Console'));
		expect(((await seeded.json()) as { addendum: string }).addendum).toBe('precious context');

		// Hostile/malformed PUT with null addendum.
		const resp = await PUT(makePut('LogueOS-Console', { addendum: null }));
		expect(resp.status).toBe(400);
		const body = (await resp.json()) as { error: string };
		expect(body.error).toBe('invalid_addendum');

		// Value must still be there.
		const after = await GET(makeGet('LogueOS-Console'));
		expect(((await after.json()) as { addendum: string }).addendum).toBe('precious context');
	});

	it('returns 400 invalid_addendum for number addendum', async () => {
		const resp = await PUT(makePut('LogueOS-Console', { addendum: 42 }));
		expect(resp.status).toBe(400);
		const body = (await resp.json()) as { error: string };
		expect(body.error).toBe('invalid_addendum');
	});

	it('returns 413 addendum_too_long when exceeding limit', async () => {
		const long = 'a'.repeat(4001);
		const resp = await PUT(makePut('LogueOS-Console', { addendum: long }));
		expect(resp.status).toBe(413);
		const body = (await resp.json()) as { error: string; limit: number };
		expect(body.error).toBe('addendum_too_long');
		expect(body.limit).toBe(4000);
	});

	it('accepts a valid string addendum at the limit', async () => {
		const atLimit = 'b'.repeat(4000);
		const resp = await PUT(makePut('LogueOS-Console', { addendum: atLimit }));
		expect(resp.status).toBe(200);
		const body = (await resp.json()) as { workspace: string; addendum: string };
		expect(body.workspace).toBe('LogueOS-Console');
		expect(body.addendum).toBe(atLimit);
	});

	it('absent addendum behaves as clear (empty string)', async () => {
		await PUT(makePut('LogueOS-Console', { addendum: 'will be cleared' }));
		const resp = await PUT(makePut('LogueOS-Console', {}));
		expect(resp.status).toBe(200);
		const after = await GET(makeGet('LogueOS-Console'));
		expect(((await after.json()) as { addendum: string }).addendum).toBe('');
	});
});
