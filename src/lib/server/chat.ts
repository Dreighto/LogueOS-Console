import fs from 'node:fs';
import Database from 'better-sqlite3';
import { serverConfig } from './config';
import type { ChatMessage, InteractiveAction } from '$lib/types/chat';

function getDb(): Database.Database {
	return new Database(serverConfig.memoryDbPath);
}

function parseRow(row: any): ChatMessage {
	let interactive_action: InteractiveAction | null = null;
	if (row.interactive_action) {
		try {
			interactive_action = JSON.parse(row.interactive_action);
		} catch {
			interactive_action = null;
		}
	}
	return {
		id: row.id,
		sender: row.sender,
		message: row.message,
		trace_id: row.trace_id || null,
		ticket_id: row.ticket_id || null,
		interactive_action,
		status: row.status,
		timestamp: row.timestamp,
		thread_id: row.thread_id || 'default'
	};
}

export function getChatMessages(limit = 100, threadId = 'default'): ChatMessage[] {
	if (!fs.existsSync(serverConfig.memoryDbPath)) {
		return [];
	}

	const db = getDb();
	try {
		const rows = db
			.prepare(
				'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY timestamp ASC LIMIT ?'
			)
			.all(threadId, limit) as any[];

		return rows.map(parseRow);
	} catch (e: unknown) {
		console.error('getChatMessages error:', e);
		return [];
	} finally {
		db.close();
	}
}

/**
 * List distinct threads in chat_messages with a count + latest activity.
 * Used by the chat tab's thread switcher.
 */
export function listChatThreads(): { thread_id: string; message_count: number; latest_ts: string }[] {
	if (!fs.existsSync(serverConfig.memoryDbPath)) return [];
	const db = getDb();
	try {
		const rows = db
			.prepare(
				`SELECT thread_id, COUNT(*) AS message_count, MAX(timestamp) AS latest_ts
				 FROM chat_messages
				 GROUP BY thread_id
				 ORDER BY latest_ts DESC`
			)
			.all() as any[];
		return rows.map((r) => ({
			thread_id: r.thread_id || 'default',
			message_count: r.message_count,
			latest_ts: r.latest_ts
		}));
	} catch (e: unknown) {
		console.error('listChatThreads error:', e);
		return [];
	} finally {
		db.close();
	}
}

export function addChatMessage(
	sender: string,
	message: string,
	traceId: string | null = null,
	ticketId: string | null = null,
	interactiveAction: InteractiveAction | null = null,
	status = 'sent',
	threadId = 'default'
): ChatMessage {
	const db = getDb();
	try {
		const actionStr = interactiveAction ? JSON.stringify(interactiveAction) : null;
		const info = db
			.prepare(
				`INSERT INTO chat_messages (sender, message, trace_id, ticket_id, interactive_action, status, thread_id)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run(sender, message, traceId, ticketId, actionStr, status, threadId);

		const insertedId = info.lastInsertRowid;
		const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(insertedId) as any;
		return parseRow(row);
	} catch (e: unknown) {
		console.error('addChatMessage error:', e);
		throw e;
	} finally {
		db.close();
	}
}

export function updateActionStatus(messageId: number, status: 'approved' | 'denied'): boolean {
	const db = getDb();
	try {
		// First get the existing message
		const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId) as any;
		if (!row) return false;

		let interactive_action: InteractiveAction | null = null;
		if (row.interactive_action) {
			try {
				interactive_action = JSON.parse(row.interactive_action);
			} catch {
				interactive_action = null;
			}
		}

		if (interactive_action) {
			interactive_action.status = status;
			const actionStr = JSON.stringify(interactive_action);
			
			db.prepare('UPDATE chat_messages SET status = ?, interactive_action = ? WHERE id = ?')
				.run(status, actionStr, messageId);
			return true;
		}

		return false;
	} catch (e: unknown) {
		console.error('updateActionStatus error:', e);
		return false;
	} finally {
		db.close();
	}
}
