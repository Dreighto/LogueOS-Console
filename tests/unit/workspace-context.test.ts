// Unit tests for workspace_context helpers — the Projects-light borrow.
// Uses an isolated in-process SQLite DB via the serverConfig.memoryDbPath
// override so the real chat_state.db is not touched.

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

import { getWorkspaceContext, setWorkspaceContext } from '../../src/lib/server/workspace_context';

beforeEach(() => {
	tmpDbPath = path.join(os.tmpdir(), `workspace-context-${Date.now()}-${Math.random()}.db`);
});

afterEach(() => {
	if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
});

describe('workspace_context helpers', () => {
	it('returns empty string when DB file does not exist', () => {
		expect(getWorkspaceContext('any-workspace')).toBe('');
	});

	it('round-trips an addendum via set + get', () => {
		setWorkspaceContext('LogueOS-Console', 'Chat surface at src/routes/chat.');
		expect(getWorkspaceContext('LogueOS-Console')).toBe('Chat surface at src/routes/chat.');
	});

	it('trims leading/trailing whitespace on set', () => {
		setWorkspaceContext('miru', '   addendum body   \n');
		expect(getWorkspaceContext('miru')).toBe('addendum body');
	});

	it('deletes the row when set with an empty string', () => {
		setWorkspaceContext('miru', 'will be cleared');
		expect(getWorkspaceContext('miru')).toBe('will be cleared');
		setWorkspaceContext('miru', '');
		expect(getWorkspaceContext('miru')).toBe('');
	});

	it('deletes the row when set with whitespace-only string', () => {
		setWorkspaceContext('miru', 'will be cleared');
		setWorkspaceContext('miru', '   \n  ');
		expect(getWorkspaceContext('miru')).toBe('');
	});

	it('isolates addenda per workspace', () => {
		setWorkspaceContext('LogueOS-Console', 'console body');
		setWorkspaceContext('miru', 'miru body');
		expect(getWorkspaceContext('LogueOS-Console')).toBe('console body');
		expect(getWorkspaceContext('miru')).toBe('miru body');
		expect(getWorkspaceContext('nasdoom')).toBe('');
	});

	it('overwrites an existing addendum on subsequent set', () => {
		setWorkspaceContext('LogueOS-Console', 'first');
		setWorkspaceContext('LogueOS-Console', 'second');
		expect(getWorkspaceContext('LogueOS-Console')).toBe('second');
	});
});
