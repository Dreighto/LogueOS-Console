import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listChatThreads } from '$lib/server/chat';

export const GET: RequestHandler = async () => {
	try {
		// Always include 'default' even if empty so the UI can render it as a
		// landing option for fresh installs.
		const threads = listChatThreads();
		if (!threads.some((t) => t.thread_id === 'default')) {
			threads.push({ thread_id: 'default', message_count: 0, latest_ts: '' });
		}
		return json({ threads });
	} catch (e: unknown) {
		console.error('GET /api/chat/threads error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};
