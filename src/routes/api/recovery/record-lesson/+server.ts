import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { emitObservation } from '$lib/server/observation_emit';
import Database from 'better-sqlite3';
import { serverConfig } from '$lib/server/config';
import fs from 'node:fs';

const TRACE_ID_PATTERN = /^[a-zA-Z0-9_-]{6,128}$/;
// Dedup window: skip if we've already recorded a lesson for this trace within
// this many seconds. Avoids double-records from rapid UI taps.
const DEDUP_WINDOW_S = 300;

function recentLessonExistsForTrace(traceId: string): boolean {
	if (!fs.existsSync(serverConfig.memoryDbPath)) return false;
	try {
		const db = new Database(serverConfig.memoryDbPath, { readonly: true });
		try {
			// emitObservation maps thread_id -> chat_thread_id column; trace_id
			// column is populated only by kernel-side emit_observation.py.
			// Match on chat_thread_id (the Console-side canonical field) and
			// also on source to exclude unrelated chat observations.
			const row = db
				.prepare(
					`SELECT 1 FROM observations
					 WHERE chat_thread_id = ?
					   AND source = 'console.recovery'
					   AND unixepoch('now') - unixepoch(timestamp) < ?
					 LIMIT 1`
				)
				.get(traceId, DEDUP_WINDOW_S);
			return row !== undefined;
		} finally {
			db.close();
		}
	} catch {
		return false;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	let body: { trace_id?: unknown; note?: unknown };
	try {
		body = (await request.json()) as { trace_id?: unknown; note?: unknown };
	} catch {
		return json({ error: 'invalid_json_body' }, { status: 400 });
	}

	const trace_id = body.trace_id;
	if (typeof trace_id !== 'string' || !TRACE_ID_PATTERN.test(trace_id)) {
		return json({ error: 'invalid_trace_id' }, { status: 400 });
	}

	const note =
		body.note !== undefined
			? typeof body.note === 'string'
				? body.note.trim().slice(0, 2000)
				: null
			: null;

	if (recentLessonExistsForTrace(trace_id)) {
		return json({ ok: true, skipped: true, reason: 'duplicate_within_dedup_window' });
	}

	const observationBody = note
		? `Run ${trace_id} stalled and was manually escalated. Operator note: ${note}`
		: `Run ${trace_id} stalled and was manually escalated by the operator via the recovery surface.`;

	const result = emitObservation({
		source: 'console.recovery',
		thread_id: trace_id,
		tier_at_emit: '0',
		models_used: [],
		project_id: 'logueos-console',
		task_shape: ['recovery', 'operator-escalation'],
		body: observationBody,
		observation_kind: 'what-didnt-work'
	});

	if (!result.ok) {
		console.error('record-lesson emit failed:', result.reason);
		return json({ error: 'observation_emit_failed', reason: result.reason }, { status: 500 });
	}

	return json({ ok: true, observation_id: result.observation_id });
};
