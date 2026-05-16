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

// Hard timeout for gateway calls. The gateway is local-tailnet only; anything
// past ~10s means it's wedged. Without this, fetch() can hang indefinitely
// and tie up server resources / leave the UI spinning. (CR finding on PR #44.)
const GATEWAY_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

// Read an error body that may or may not be JSON. Avoids the original failure
// mode where `await response.json()` threw on a non-JSON gateway error (e.g.
// HTML 502 page) and turned a clean 502 into a generic 500. (CR finding.)
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
	const text = await response.text();
	if (!text) return fallback;
	try {
		const parsed = JSON.parse(text) as { error?: string };
		return parsed.error || text.slice(0, 300) || fallback;
	} catch {
		return text.slice(0, 300) || fallback;
	}
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

			let linearResp: Response;
			try {
				linearResp = await fetchWithTimeout(
					`${serverConfig.gatewayUrl}/api/v1/linear/file`,
					{
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
					},
					GATEWAY_TIMEOUT_MS
				);
			} catch (err) {
				const isAbort = err instanceof Error && err.name === 'AbortError';
				return json(
					{
						error: isAbort
							? `Linear file timed out after ${GATEWAY_TIMEOUT_MS}ms`
							: `Linear file failed: ${String(err)}`
					},
					{ status: 504 }
				);
			}

			// Fail-closed: any non-2xx OR a 2xx that doesn't carry a real
			// ticket_id back means the Linear filing didn't actually happen.
			// CR finding on PR #43: a silent "filed but no ID" return would
			// have us dispatch the worker without ever linking the ticket.
			if (!linearResp.ok) {
				const detail = await readErrorMessage(
					linearResp,
					`Gateway returned ${linearResp.status}`
				);
				return json(
					{ error: `Linear file failed: ${detail}` },
					{ status: linearResp.status >= 500 ? 502 : linearResp.status }
				);
			}

			let linearData: LinearFileResponse;
			try {
				linearData = (await linearResp.json()) as LinearFileResponse;
			} catch (err) {
				return json(
					{ error: `Linear file returned non-JSON: ${String(err)}` },
					{ status: 502 }
				);
			}
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
		let response: Response;
		try {
			response = await fetchWithTimeout(
				`${serverConfig.gatewayUrl}/api/v1/dispatch`,
				{
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
				},
				GATEWAY_TIMEOUT_MS
			);
		} catch (err) {
			const isAbort = err instanceof Error && err.name === 'AbortError';
			return json(
				{
					error: isAbort
						? `Dispatch timed out after ${GATEWAY_TIMEOUT_MS}ms`
						: `Dispatch failed: ${String(err)}`
				},
				{ status: 504 }
			);
		}

		if (!response.ok) {
			const detail = await readErrorMessage(response, 'Gateway dispatch failed');
			return json({ error: detail }, { status: response.status });
		}

		let data: Record<string, unknown>;
		try {
			data = (await response.json()) as Record<string, unknown>;
		} catch (err) {
			return json(
				{ error: `Dispatch returned non-JSON: ${String(err)}` },
				{ status: 502 }
			);
		}

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
