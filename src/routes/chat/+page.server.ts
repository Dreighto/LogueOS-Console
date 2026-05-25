import type { PageServerLoad } from './$types';
import { getChatMessages } from '$lib/server/chat';

export const load: PageServerLoad = async () => {
	const messages = getChatMessages(100);
	return {
		messages
	};
};
