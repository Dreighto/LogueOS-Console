// CRUD helpers for workspace_context — per-target-repo system prompt
// addendum the operator can type once and have it auto-injected into every
// chat send for that workspace.
//
// Task #22 (Projects-light borrow from Claude). Keeps state per-workspace
// rather than per-thread so the operator doesn't have to retype context
// every time they /new a thread. Schema mirrors the chat_thread_meta
// pattern — lazy CREATE TABLE IF NOT EXISTS on first access.

import fs from 'node:fs';
import Database from 'better-sqlite3';
import { serverConfig } from './config';

export interface WorkspaceContext {
	workspace: string;
	addendum: string;
	updated_at: string;
}

const ensuredPaths = new Set<string>();

function ensureTable(db: Database.Database): void {
	const key = serverConfig.memoryDbPath;
	if (ensuredPaths.has(key)) return;
	db.exec(`
		CREATE TABLE IF NOT EXISTS workspace_context (
			workspace TEXT PRIMARY KEY,
			addendum TEXT NOT NULL DEFAULT '',
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
	`);
	ensuredPaths.add(key);
}

function getDb(): Database.Database {
	return new Database(serverConfig.memoryDbPath);
}

/** Returns the addendum for a workspace, or empty string if none set. */
export function getWorkspaceContext(workspace: string): string {
	if (!fs.existsSync(serverConfig.memoryDbPath)) return '';
	const db = getDb();
	try {
		ensureTable(db);
		const row = db
			.prepare('SELECT addendum FROM workspace_context WHERE workspace = ?')
			.get(workspace) as { addendum?: string } | undefined;
		return row?.addendum ?? '';
	} catch (e: unknown) {
		console.error('getWorkspaceContext error:', e);
		return '';
	} finally {
		db.close();
	}
}

/**
 * Upsert a workspace's addendum. Passing an empty/whitespace-only string
 * deletes the row (keeps the table free of empty entries).
 */
export function setWorkspaceContext(workspace: string, addendum: string): void {
	const trimmed = (addendum || '').trim();
	const db = getDb();
	try {
		ensureTable(db);
		if (!trimmed) {
			db.prepare('DELETE FROM workspace_context WHERE workspace = ?').run(workspace);
			return;
		}
		db.prepare(
			`INSERT INTO workspace_context (workspace, addendum, updated_at)
			 VALUES (?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(workspace) DO UPDATE SET addendum = excluded.addendum, updated_at = CURRENT_TIMESTAMP`
		).run(workspace, trimmed);
	} catch (e: unknown) {
		console.error('setWorkspaceContext error:', e);
		throw e;
	} finally {
		db.close();
	}
}
