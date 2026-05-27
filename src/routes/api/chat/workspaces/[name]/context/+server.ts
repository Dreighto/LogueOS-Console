// GET  /api/chat/workspaces/[name]/context — returns the per-workspace
//                                              system-prompt addendum
// PUT  /api/chat/workspaces/[name]/context — body: { addendum: string }
//                                              empty string clears the entry
//
// Task #22 — Projects-light. Per-workspace context that auto-injects into
// every chat send's system prompt. Stored in workspace_context table.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWorkspaceContext, setWorkspaceContext } from '$lib/server/workspace_context';

const MAX_ADDENDUM_CHARS = 4000;

export const GET: RequestHandler = async ({ params }) => {
	const { name } = params;
	if (!name) return json({ error: 'missing workspace' }, { status: 400 });
	try {
		const addendum = getWorkspaceContext(name);
		return json({ workspace: name, addendum });
	} catch (e: unknown) {
		console.error('GET workspace context error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const { name } = params;
	if (!name) return json({ error: 'missing workspace' }, { status: 400 });

	let body: { addendum?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}

	const addendum = typeof body.addendum === 'string' ? body.addendum : '';
	if (addendum.length > MAX_ADDENDUM_CHARS) {
		return json(
			{ error: 'addendum_too_long', limit: MAX_ADDENDUM_CHARS },
			{ status: 413 }
		);
	}

	try {
		setWorkspaceContext(name, addendum);
		return json({ workspace: name, addendum: addendum.trim() });
	} catch (e: unknown) {
		console.error('PUT workspace context error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};
