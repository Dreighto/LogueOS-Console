import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';

// LOS-92: shape of the body the Console UI POSTs us. Track-in-Linear is the
// new optional path — when on, we file a Linear ticket FIRST, get back a
// ticket_id, and stamp it onto the dispatch so the worker runs against a
// real ticket. When off, behavior is identical to the prior endpoint: just
// proxy through to the gateway.
interface DispatchBody {
	worker?: string;
	target_repo?: string;
	ticket_id?: string | null;
	prompt?: string;
	thinking_level?: string | null;
	track_in_linear?: boolean;
	linear_title?: string;
	linear_description?: string;
	linear_team?: string;
	linear_project?: string;
	linear_priority?: number;
}

interface LinearFileResponse {
	ticket_id?: string;
	ticket_url?: string;
	error?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as DispatchBody;

		let filedTicketId: string | undefined;
		let filedTicketUrl: string | undefined;

		// Step 1: file the Linear ticket FIRST if requested. We do this before
		// dispatch so the worker's prompt + result lands on a real ticket
		// without needing a separate cross-ref step.
		if (body.track_in_linear) {
			if (!body.linear_title || !body.linear_title.trim()) {
				return json(
					{ error: 'linear_title is required when track_in_linear is true' },
					{ status: 400 }
				);
			}

			const linearResp = await fetch(`${serverConfig.gatewayUrl}/api/v1/linear/file`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: body.linear_title.trim(),
					description: body.linear_description ?? body.prompt ?? '',
					team: body.linear_team ?? 'LogueOS',
					project: body.linear_project || undefined,
					priority: body.linear_priority ?? 2,
					source: 'console.dispatch_center'
				})
			});

			// Fail-closed: any non-2xx OR a 2xx that doesn't carry a real
			// ticket_id back means the Linear filing didn't actually happen.
			// CR finding on PR #43: a silent "filed but no ID" return would
			// have us dispatch the worker without ever linking the ticket.
			if (!linearResp.ok) {
				let detail = `Gateway returned ${linearResp.status}`;
				try {
					const errBody = (await linearResp.json()) as LinearFileResponse;
					detail = errBody.error ?? detail;
				} catch {
					/* body wasn't JSON — keep the status code */
				}
				return json(
					{ error: `Linear file failed: ${detail}` },
					{ status: linearResp.status >= 500 ? 502 : linearResp.status }
				);
			}

			const linearData = (await linearResp.json()) as LinearFileResponse;
			if (!linearData.ticket_id) {
				return json(
					{ error: 'Linear file returned no ticket_id — refusing to dispatch unlinked' },
					{ status: 502 }
				);
			}

			filedTicketId = linearData.ticket_id;
			filedTicketUrl = linearData.ticket_url;
		}

		// Step 2: dispatch. If we just filed a ticket, that wins over whatever
		// the user typed in the Ticket ID field — they explicitly asked us to
		// track this as a fresh ticket.
		const dispatchTicketId = filedTicketId ?? body.ticket_id ?? null;
		const response = await fetch(`${serverConfig.gatewayUrl}/api/v1/dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				tool_profile: 'standard_worker',
				worker: body.worker,
				target_repo: body.target_repo,
				ticket_id: dispatchTicketId,
				prompt: body.prompt,
				thinking_level: body.thinking_level
			})
		});

		if (!response.ok) {
			const errorData = (await response.json()) as { error?: string };
			return json(
				{ error: errorData.error || 'Gateway dispatch failed' },
				{ status: response.status }
			);
		}

		const data = (await response.json()) as Record<string, unknown>;

		// Surface the filed ticket back to the client so the UI can show a
		// clickable link in the status strip.
		return json({
			...data,
			ticket_id: filedTicketId ?? data.ticket_id ?? null,
			ticket_url: filedTicketUrl ?? data.ticket_url ?? null
		});
	} catch (error) {
		console.error('Dispatch API error:', error);
		return json({ error: String(error) }, { status: 500 });
	}
};
