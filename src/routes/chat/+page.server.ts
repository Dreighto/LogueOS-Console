import type { PageServerLoad } from './$types';
import { getChatMessages, listChatThreads } from '$lib/server/chat';

export const load: PageServerLoad = async ({ url }) => {
	const thread = (url.searchParams.get('thread') || 'default').trim() || 'default';
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
