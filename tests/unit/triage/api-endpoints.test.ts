/**
 * Real-sqlite tests for the judgment triage server lib + HTTP handlers.
 *
 * The brief explicitly required NOT mocking the DB ("Mock-vs-prod drift =
 * documented operator no-no"). Every test seeds a fresh tmp sqlite file
 * with the real `worker_runs` and `worker_run_judgment_suggestions`
 * schemas, exercises the actual functions, and asserts state by reading
 * the same DB back. Only `serverConfig` and `env_redactor` are mocked —
 * the DB itself is real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import Database from 'better-sqlite3';

// vi.mock factories are hoisted above the file's other statements, so any
// values they reference must also be hoisted with vi.hoisted(). The normal
// `import`s above are NOT yet bound when vi.hoisted runs, so we use require()
// inside the hoisted factory to resolve the path safely.
const { TEST_DB } = vi.hoisted(() => {
	const nodePath = require('node:path');
	const nodeOs = require('node:os');
	return {
		TEST_DB: nodePath.join(
			nodeOs.tmpdir(),
			`triage-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`
		) as string
	};
});

// Override serverConfig BEFORE importing judgmentTriage so the lib reads our
// temp DB path. This is config-mocking, not DB-mocking.
vi.mock('$lib/server/config', () => ({
	serverConfig: { memoryDbPath: TEST_DB }
}));

// observation_emit reads the same memoryDbPath via its own serverConfig import.
// Stub redactEnvValues so the observation insert path doesn't depend on the
// env-redactor binary being available in CI.
vi.mock('$lib/server/env_redactor', () => ({
	redactEnvValues: (s: string) => ({ redacted: s, redactions: 0 })
}));

// Import AFTER the mocks above.
import {
	getTriageSuggestions,
	submitTriageDecision,
	getSuggestionById
} from '../../../src/lib/server/judgmentTriage';

function seedDb(): void {
	const db = new Database(TEST_DB);
	db.exec(`
		CREATE TABLE worker_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			trace_id TEXT NOT NULL UNIQUE,
			worker TEXT NOT NULL,
			project_id TEXT,
			status TEXT,
			outcome TEXT NOT NULL,
			exit_code INTEGER,
			started_at TEXT NOT NULL,
			completed_at TEXT,
			duration_ms INTEGER,
			prompt_hash TEXT,
			escalation_category TEXT,
			task_shape TEXT,
			commit_sha TEXT,
			operator_judgment TEXT,
			stderr_tail TEXT,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE worker_run_judgment_suggestions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL,
			trace_id TEXT NOT NULL,
			suggested_label TEXT NOT NULL,
			rationale TEXT,
			derived_from TEXT,
			confidence TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'derived',
			created_at TEXT NOT NULL,
			operator_confirmed INTEGER,
			operator_label TEXT,
			UNIQUE(run_id)
		);
		-- observations is touched by the best-effort Tier-0 emission inside
		-- submitTriageDecision via emitObservation. Seeded with the same columns
		-- ensureSchema() creates in production so the insert path doesn't log.
		CREATE TABLE observations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			observation_id TEXT UNIQUE NOT NULL,
			trace_id TEXT,
			ticket_id TEXT,
			project_id TEXT NOT NULL,
			observation_kind TEXT NOT NULL,
			text TEXT NOT NULL,
			task_shape TEXT,
			timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
			source TEXT,
			chat_thread_id TEXT,
			tier_at_emit TEXT,
			models_used TEXT
		);
	`);

	const insertRun = db.prepare(
		`INSERT INTO worker_runs (trace_id, worker, outcome, started_at, project_id)
		 VALUES (?, ?, ?, ?, ?)`
	);
	insertRun.run('trace-1', 'cursor', 'success', '2026-06-25T00:00:00Z', 'project-miru');
	insertRun.run('trace-2', 'gmi', 'failed', '2026-06-25T00:01:00Z', 'logueos-orchestrator');
	insertRun.run('trace-3', 'cdx', 'inconclusive_clean', '2026-06-25T00:02:00Z', null);

	const insertSugg = db.prepare(
		`INSERT INTO worker_run_judgment_suggestions
		 (run_id, trace_id, suggested_label, rationale, derived_from, confidence, source, created_at, operator_confirmed)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	insertSugg.run(
		1,
		'trace-1',
		'accepted',
		'PR merged cleanly',
		'pr_merged',
		'high',
		'derived',
		'2026-06-25T00:00:00Z',
		null
	);
	insertSugg.run(
		2,
		'trace-2',
		'rejected',
		'tests failed',
		'test_gate',
		'high',
		'derived',
		'2026-06-25T00:01:00Z',
		null
	);
	// Pre-confirmed suggestion — should never appear in the triage queue.
	insertSugg.run(
		3,
		'trace-3',
		'accepted',
		'evidence of work',
		'evidence_of_work',
		'medium',
		'derived',
		'2026-06-25T00:02:00Z',
		1
	);

	db.close();
}

function cleanupDb(): void {
	for (const ext of ['', '-journal', '-wal', '-shm']) {
		try {
			fs.unlinkSync(TEST_DB + ext);
		} catch {
			/* not present */
		}
	}
}

beforeEach(() => {
	cleanupDb();
	seedDb();
});

afterEach(() => {
	cleanupDb();
});

describe('getTriageSuggestions (real sqlite)', () => {
	it('returns only unconfirmed suggestions in created_at order', () => {
		const result = getTriageSuggestions();
		expect(result.suggestions).toHaveLength(2);
		expect(result.suggestions[0].suggestion.trace_id).toBe('trace-1');
		expect(result.suggestions[1].suggestion.trace_id).toBe('trace-2');
	});

	it('joins the worker_runs row onto each suggestion', () => {
		const result = getTriageSuggestions();
		expect(result.suggestions[0].run.worker).toBe('cursor');
		expect(result.suggestions[0].run.project_id).toBe('project-miru');
		expect(result.suggestions[1].run.outcome).toBe('failed');
	});

	it('reports progress vs total suggestions', () => {
		const result = getTriageSuggestions();
		expect(result.total_unconfirmed).toBe(2);
		expect(result.progress).toEqual({ reviewed: 1, total: 3 });
	});

	it('respects the limit parameter', () => {
		const result = getTriageSuggestions(1);
		expect(result.suggestions).toHaveLength(1);
		expect(result.suggestions[0].suggestion.trace_id).toBe('trace-1');
	});

	it('returns empty when the DB file is missing', () => {
		cleanupDb();
		const result = getTriageSuggestions();
		expect(result.suggestions).toEqual([]);
		expect(result.total_unconfirmed).toBe(0);
	});
});

describe('submitTriageDecision (real sqlite)', () => {
	function readSugg(id: number) {
		const db = new Database(TEST_DB, { readonly: true });
		const row = db
			.prepare(
				`SELECT operator_confirmed, operator_label FROM worker_run_judgment_suggestions WHERE id = ?`
			)
			.get(id) as { operator_confirmed: number | null; operator_label: string | null } | undefined;
		db.close();
		return row;
	}

	function readRunJudgment(id: number) {
		const db = new Database(TEST_DB, { readonly: true });
		const row = db.prepare(`SELECT operator_judgment FROM worker_runs WHERE id = ?`).get(id) as
			| { operator_judgment: string | null }
			| undefined;
		db.close();
		return row?.operator_judgment ?? null;
	}

	it('accept copies suggested_label and sets operator_judgment=accepted on both tables', () => {
		const ok = submitTriageDecision({ suggestion_id: 1, decision: 'accept' });
		expect(ok).toBe(true);

		const sugg = readSugg(1);
		expect(sugg?.operator_confirmed).toBe(1);
		expect(sugg?.operator_label).toBe('accepted');
		expect(readRunJudgment(1)).toBe('accepted');
	});

	it('reject sets operator_judgment=rejected on both tables', () => {
		const ok = submitTriageDecision({ suggestion_id: 2, decision: 'reject' });
		expect(ok).toBe(true);
		expect(readSugg(2)?.operator_label).toBe('rejected');
		expect(readRunJudgment(2)).toBe('rejected');
	});

	it('edit applies the supplied operator_label and tags operator_judgment=edited', () => {
		const ok = submitTriageDecision({
			suggestion_id: 1,
			decision: 'edit',
			operator_label: 'partial_success'
		});
		expect(ok).toBe(true);
		expect(readSugg(1)?.operator_label).toBe('partial_success');
		expect(readRunJudgment(1)).toBe('edited');
	});

	it('rejects edit without operator_label and leaves both tables unchanged', () => {
		const ok = submitTriageDecision({ suggestion_id: 1, decision: 'edit' });
		expect(ok).toBe(false);
		expect(readSugg(1)?.operator_confirmed).toBeNull();
		expect(readRunJudgment(1)).toBeNull();
	});

	it('rejects edit with whitespace-only operator_label', () => {
		const ok = submitTriageDecision({
			suggestion_id: 1,
			decision: 'edit',
			operator_label: '   '
		});
		expect(ok).toBe(false);
		expect(readSugg(1)?.operator_confirmed).toBeNull();
	});

	it('rejects unknown decision strings', () => {
		const ok = submitTriageDecision({ suggestion_id: 1, decision: 'maybe' as never });
		expect(ok).toBe(false);
		expect(readSugg(1)?.operator_confirmed).toBeNull();
	});

	it('rolls back when the worker_runs UPDATE fails (brief-required transaction safety)', () => {
		// Force the second UPDATE in the transaction to throw by renaming the
		// column it targets. The first UPDATE (suggestions) must roll back —
		// per brief: "All three or none."
		const corruptDb = new Database(TEST_DB);
		corruptDb.exec(
			`ALTER TABLE worker_runs RENAME COLUMN operator_judgment TO operator_judgment_renamed`
		);
		corruptDb.close();

		const ok = submitTriageDecision({ suggestion_id: 1, decision: 'accept' });
		expect(ok).toBe(false);

		// Suggestion must be untouched — rollback worked.
		const sugg = readSugg(1);
		expect(sugg?.operator_confirmed).toBeNull();
		expect(sugg?.operator_label).toBeNull();
	});
});

describe('getSuggestionById (real sqlite)', () => {
	it('returns the suggestion when present', () => {
		const sugg = getSuggestionById(1);
		expect(sugg).not.toBeNull();
		expect(sugg!.trace_id).toBe('trace-1');
		expect(sugg!.suggested_label).toBe('accepted');
	});

	it('returns null when the id is missing', () => {
		expect(getSuggestionById(9999)).toBeNull();
	});
});

describe('HTTP handlers /api/runs/triage', () => {
	it('GET returns the unconfirmed suggestions payload', async () => {
		const { GET } = await import('../../../src/routes/api/runs/triage/+server');
		const resp = await GET({
			url: new URL('http://localhost/api/runs/triage')
		} as Parameters<typeof GET>[0]);
		const data = (await resp.json()) as { suggestions: unknown[]; total_unconfirmed: number };
		expect(data.suggestions).toHaveLength(2);
		expect(data.total_unconfirmed).toBe(2);
	});

	it('GET respects custom limit', async () => {
		const { GET } = await import('../../../src/routes/api/runs/triage/+server');
		const resp = await GET({
			url: new URL('http://localhost/api/runs/triage?limit=1')
		} as Parameters<typeof GET>[0]);
		const data = (await resp.json()) as { suggestions: unknown[] };
		expect(data.suggestions).toHaveLength(1);
	});

	it('POST 400s on missing suggestion_id', async () => {
		const { POST } = await import('../../../src/routes/api/runs/triage/+server');
		const resp = await POST({
			request: { json: () => Promise.resolve({ decision: 'accept' }) }
		} as Parameters<typeof POST>[0]);
		expect(resp.status).toBe(400);
	});

	it('POST 400s on unknown decision', async () => {
		const { POST } = await import('../../../src/routes/api/runs/triage/+server');
		const resp = await POST({
			request: { json: () => Promise.resolve({ suggestion_id: 1, decision: 'maybe' }) }
		} as Parameters<typeof POST>[0]);
		expect(resp.status).toBe(400);
	});

	it('POST 400s on edit without operator_label', async () => {
		const { POST } = await import('../../../src/routes/api/runs/triage/+server');
		const resp = await POST({
			request: { json: () => Promise.resolve({ suggestion_id: 1, decision: 'edit' }) }
		} as Parameters<typeof POST>[0]);
		expect(resp.status).toBe(400);
	});

	it('POST 404s when the suggestion id does not exist', async () => {
		const { POST } = await import('../../../src/routes/api/runs/triage/+server');
		const resp = await POST({
			request: { json: () => Promise.resolve({ suggestion_id: 9999, decision: 'accept' }) }
		} as Parameters<typeof POST>[0]);
		expect(resp.status).toBe(404);
	});

	it('POST 409s when the suggestion is already confirmed', async () => {
		const { POST } = await import('../../../src/routes/api/runs/triage/+server');
		const resp = await POST({
			request: { json: () => Promise.resolve({ suggestion_id: 3, decision: 'accept' }) }
		} as Parameters<typeof POST>[0]);
		expect(resp.status).toBe(409);
	});

	it('POST commits an accept and surfaces updated progress', async () => {
		const { POST } = await import('../../../src/routes/api/runs/triage/+server');
		const resp = await POST({
			request: { json: () => Promise.resolve({ suggestion_id: 1, decision: 'accept' }) }
		} as Parameters<typeof POST>[0]);
		expect(resp.status).toBe(200);
		const data = (await resp.json()) as { success: boolean; progress: { reviewed: number } };
		expect(data.success).toBe(true);
		expect(data.progress.reviewed).toBe(2); // was 1, now +1
	});
});
