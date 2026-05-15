import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { killWorker, DispatchListenerError } from '$lib/server/dispatch-listener';

// Operator-facing kill endpoint. The Console UI (WorkerCard "Kill" button)
// POSTs { trace_id } here; we sign + forward to the dispatch_listener's
// /kill route. Same trace_id pattern the listener accepts (alphanumeric +
// underscore + hyphen, 6-128 chars) — validated client-side AND here so
// the listener stays the final authority.

const TRACE_ID_RE = /^[a-zA-Z0-9_-]{6,128}$/;

interface KillRequestBody {
	trace_id?: unknown;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: KillRequestBody;
	try {
		body = (await request.json()) as KillRequestBody;
	} catch {
		return json({ error: 'invalid_json_body' }, { status: 400 });
	}

	const traceId = body.trace_id;
	if (typeof traceId !== 'string' || !TRACE_ID_RE.test(traceId)) {
		return json(
			{ error: 'invalid_trace_id', detail: 'trace_id must match /^[a-zA-Z0-9_-]{6,128}$/' },
			{ status: 400 }
		);
	}

	try {
		const result = await killWorker(traceId);
		return json(result);
	} catch (e) {
		if (e instanceof DispatchListenerError) {
			// 404 from the listener (no_lease_for_trace_id) means the worker
			// already exited or was never live. UI should treat that as
			// "fine, nothing to kill" — surface as 404 with body so the
			// client can show a non-scary message.
			console.error('killWorker failed:', e.status, e.message, e.body);
			return json(
				{ error: e.message, listener_body: e.body },
				{ status: e.status }
			);
		}
		console.error('killWorker unexpected error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};
