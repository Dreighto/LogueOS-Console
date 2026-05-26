// Chat Surface V2 — server load. Reuses the same data shape as /chat.
// Visual rewrite only; backend contracts unchanged.

import type { PageServerLoad } from './$types';
import { getChatMessages, listChatThreads, getActiveThread } from '$lib/server/chat';
import { serverConfig } from '$lib/server/config';

export type Workspace = {
	name: string;
	display_name: string;
	group: string;
	emoji: string;
	default_branch: string;
	pool_size: number;
	is_archived: boolean;
};

const FALLBACK_WORKSPACES: Workspace[] = [
	{
		name: 'LogueOS-Console',
		display_name: 'Console',
		group: 'LogueOS Kernel',
		emoji: '💻',
		default_branch: 'main',
		pool_size: 1,
		is_archived: false
	},
	{
		name: 'LogueOS-Orchestrator',
		display_name: 'Orchestrator',
		group: 'LogueOS Kernel',
		emoji: '⚙️',
		default_branch: 'main',
		pool_size: 1,
		is_archived: false
	},
	{
		name: 'project-miru',
		display_name: 'Miru',
		group: 'Miru Cluster',
		emoji: '👁️',
		default_branch: 'main',
		pool_size: 4,
		is_archived: false
	},
	{
		name: 'NASDOOM',
		display_name: 'NASDOOM',
		group: 'Side Projects',
		emoji: '🎮',
		default_branch: 'main',
		pool_size: 3,
		is_archived: false
	}
];

export const load: PageServerLoad = async ({ url }) => {
	const queryThread = url.searchParams.get('thread');
	const thread = (queryThread || getActiveThread() || 'default').trim() || 'default';
	const messages = getChatMessages(100, thread);
	const threads = listChatThreads();
	if (!threads.some((t) => t.thread_id === 'default')) {
		threads.push({ thread_id: 'default', message_count: 0, latest_ts: '' });
	}

	let allWorkspaces: Workspace[] = FALLBACK_WORKSPACES;
	try {
		const resp = await fetch(`${serverConfig.gatewayUrl}/api/v1/workspaces`, {
			signal: AbortSignal.timeout(3000)
		});
		if (resp.ok) {
			const body = (await resp.json()) as { workspaces?: unknown[] };
			if (Array.isArray(body.workspaces)) {
				allWorkspaces = body.workspaces as Workspace[];
			}
		}
	} catch {
		/* fall back silently */
	}

	const workspaces = allWorkspaces.filter((w) => !w.is_archived);

	return {
		messages,
		threads,
		activeThread: thread,
		workspaces
	};
};
