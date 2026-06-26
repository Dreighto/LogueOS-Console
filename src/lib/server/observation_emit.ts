// Tier 0 observation emission for Console-sourced observations.
// Writes directly to the observations table in logueos_memory.db.
//
// Extra columns (source, chat_thread_id, tier_at_emit, models_used) are added
// lazily via ALTER TABLE — pre-existing rows and rows written by
// tools/emit_observation.py simply have NULL in these columns, which is fine.
//
// Privacy guard: every body is run through env_redactor before persist.
// Fail-closed — emission is BLOCKED if redaction cannot run.

import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { serverConfig } from './config';
import { redactEnvValues } from './env_redactor';

export interface ObservationParams {
	source: string;
	thread_id: string;
	tier_at_emit: string;
	models_used: string[];
	project_id: string;
	task_shape: string[];
	body: string;
	observation_kind?: string;
}

const ensuredDbs = new Set<string>();

function ensureSchema(db: Database.Database): void {
	const key = serverConfig.memoryDbPath;
	if (ensuredDbs.has(key)) return;

	db.exec(`
		CREATE TABLE IF NOT EXISTS observations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			observation_id TEXT UNIQUE NOT NULL,
			trace_id TEXT,
			ticket_id TEXT,
			project_id TEXT NOT NULL,
			observation_kind TEXT NOT NULL,
			text TEXT NOT NULL,
			task_shape TEXT,
			timestamp TEXT DEFAULT CURRENT_TIMESTAMP
		)
	`);

	// Extra columns for chat-sourced observations. Try each individually;
	// SQLite throws on duplicate column name — catch and continue.
	const extra: [string, string][] = [
		['source', 'TEXT'],
		['chat_thread_id', 'TEXT'],
		['tier_at_emit', 'TEXT'],
		['models_used', 'TEXT']
	];
	for (const [col, type] of extra) {
		try {
			db.exec(`ALTER TABLE observations ADD COLUMN ${col} ${type}`);
		} catch {
			/* already exists */
		}
	}

	ensuredDbs.add(key);
}

/**
 * Emit a Tier 0 observation into the shared logueos_memory.db.
 * Returns false if the privacy redactor fails (fail-closed).
 */
export function emitObservation(params: ObservationParams): {
	ok: boolean;
	reason?: string;
	observation_id?: string;
} {
	const redacted = redactEnvValues(params.body);
	if (redacted === null) {
		return { ok: false, reason: 'redaction_failed' };
	}

	if (!fs.existsSync(serverConfig.memoryDbPath)) {
		return { ok: false, reason: 'db_not_found' };
	}

	const db = new Database(serverConfig.memoryDbPath);
	try {
		ensureSchema(db);

		const observation_id = crypto.randomUUID().replace(/-/g, '');
		const ts = new Date().toISOString();
		const extendedShape = [...params.task_shape, `source:${params.source}`, `tier:${params.tier_at_emit}`];

		db.prepare(
			`
			INSERT INTO observations (
				observation_id, project_id, observation_kind, text, task_shape, timestamp,
				source, chat_thread_id, tier_at_emit, models_used
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`
		).run(
			observation_id,
			params.project_id,
			params.observation_kind ?? 'what-worked',
			redacted.redacted,
			JSON.stringify(extendedShape),
			ts,
			params.source,
			params.thread_id,
			params.tier_at_emit,
			JSON.stringify(params.models_used)
		);

		return { ok: true, observation_id };
	} catch (e) {
		console.error('emitObservation error:', e);
		return { ok: false, reason: String(e) };
	} finally {
		db.close();
	}
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}
