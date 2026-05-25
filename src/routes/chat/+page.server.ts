import type { PageServerLoad } from './$types';
import { getChatMessages, listChatThreads, getActiveThread } from '$lib/server/chat';

export const load: PageServerLoad = async ({ url }) => {
	// URL query param wins (so deep-linking still works), otherwise fall back
	// to the persistent active-thread state so leaving the app and coming
	// back lands you where you were. Phone and desktop share the same state
	// since it lives in SQLite, not localStorage.
	const queryThread = url.searchParams.get('thread');
	const thread = (queryThread || getActiveThread() || 'default').trim() || 'default';
	const messages = getChatMessages(100, thread);
	const threads = listChatThreads();
	if (!threads.some((t) => t.thread_id === 'default')) {
		threads.push({ thread_id: 'default', message_count: 0, latest_ts: '' });
	}
	return {
		messages,
		threads,
		activeThread: thread
	};
};
