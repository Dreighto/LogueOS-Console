import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readKillSwitchState, activateKillSwitch, clearKillSwitch } from '$lib/server/kill-switch';
import type { KillSwitchToggleRequest, KillSwitchToggleResponse } from '$lib/types/kill-switch';

export const GET: RequestHandler = async () => {
	try {
		const state = await readKillSwitchState();
		return json(state);
	} catch (e) {
		console.error('kill-switch read failed:', e);
		return json({ error: 'kill_switch_read_failed' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	let body: KillSwitchToggleRequest;
	try {
		body = (await request.json()) as KillSwitchToggleRequest;
	} catch {
		return json({ error: 'invalid_json_body' }, { status: 400 });
	}

	if (body.action !== 'activate' && body.action !== 'clear') {
		return json(
			{ error: 'invalid_action', detail: 'action must be "activate" or "clear"' },
			{ status: 400 }
		);
	}

	// Optional note — bounded so we don't store unbounded text in the halt
	// file or audit log.
	let note: string | null = null;
	if (body.note !== undefined) {
		if (typeof body.note !== 'string') {
			return json({ error: 'invalid_note', detail: 'note must be a string' }, { status: 400 });
		}
		const trimmed = body.note.trim();
		if (trimmed.length > 500) {
			return json(
				{ error: 'note_too_long', detail: 'note must be 500 characters or fewer' },
				{ status: 400 }
			);
		}
		note = trimmed || null;
	}

	try {
		const state =
			body.action === 'activate' ? await activateKillSwitch(note) : await clearKillSwitch(note);
		const response: KillSwitchToggleResponse = { ok: true, state };
		return json(response);
	} catch (e) {
		console.error('kill-switch toggle failed:', e);
		return json({ error: 'kill_switch_toggle_failed' }, { status: 500 });
	}
};
