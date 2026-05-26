import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	setPin,
	setArchived,
	setTitle,
	setRememberFlag,
	deleteThread
} from '$lib/server/thread_meta';

/**
 * PATCH /api/chat/threads/[thread_id]
 * Body: { title?, pinned?, archived?, remember_flag? }
 * Applies only the fields present in the body.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const { thread_id } = params;
	if (!thread_id) return json({ error: 'missing thread_id' }, { status: 400 });

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}

	try {
		if (typeof body.title === 'string') {
			setTitle(thread_id, body.title);
		}
		if (typeof body.pinned === 'boolean') {
			setPin(thread_id, body.pinned);
		}
		if (typeof body.archived === 'boolean') {
			setArchived(thread_id, body.archived);
		}
		if (typeof body.remember_flag === 'boolean') {
			setRememberFlag(thread_id, body.remember_flag);
		}
		return json({ ok: true });
	} catch (e) {
		console.error('PATCH /api/chat/threads/:id error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};

/**
 * DELETE /api/chat/threads/[thread_id]
 * Only allowed when the thread is already archived. Returns 409 otherwise.
 * Cascade-deletes chat_messages, chat_drafts, chat_thread_state, chat_thread_meta.
 */
export const DELETE: RequestHandler = async ({ params }) => {
	const { thread_id } = params;
	if (!thread_id) return json({ error: 'missing thread_id' }, { status: 400 });

	const result = deleteThread(thread_id);
	if (!result.ok) {
		if (result.reason === 'not_archived') {
			return json(
				{ error: 'thread_not_archived', message: 'Archive the thread before deleting it.' },
				{ status: 409 }
			);
		}
		if (result.reason === 'thread_not_found') {
			return json({ error: 'thread_not_found' }, { status: 404 });
		}
		return json({ error: result.reason }, { status: 500 });
	}

	return json({ ok: true });
};
