import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';
import { fetchFleet } from '$lib/server/dispatch-listener';

const TRACE_ID_PATTERN = /^[a-zA-Z0-9_-]{6,128}$/;
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
	let body: { trace_id?: unknown };
	try {
		body = (await request.json()) as { trace_id?: unknown };
	} catch {
		return json({ error: 'invalid_json_body' }, { status: 400 });
	}

	const trace_id = body.trace_id;
	if (typeof trace_id !== 'string' || !TRACE_ID_PATTERN.test(trace_id)) {
		return json({ error: 'invalid_trace_id' }, { status: 400 });
	}

	// Look up target_repo and ticket_id from the fleet so the dispatch has the
	// right routing context. If the fleet is unavailable we still dispatch —
	// the worker can find context from the trace logs directly.
	const fleet = await fetchFleet();
	const fleetRun = fleet.runs.find((r) => r.trace_id === trace_id);
	const target_repo = fleetRun?.target_repo ?? null;
	const ticket_id = fleetRun?.ticket_id || null;

	const prompt = [
		`Diagnose and repair the stalled run with trace_id=${trace_id}.`,
		'Investigate why the worker stalled (check heartbeats, completion log, trace stdout/stderr).',
		'Identify the root cause and propose a fix or recovery action.',
		'Emit STATUS: CONFIRMED_WORKING or STATUS: ESCALATE: HUMAN-REQUIRED with a full diagnostic block.'
	].join(' ');

	let response: Response;
	try {
		response = await fetchWithTimeout(
			`${serverConfig.gatewayUrl}/api/v1/dispatch`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tool_profile: 'standard_worker',
					target_repo,
					ticket_id,
					prompt
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
		return json({ error: `Dispatch returned non-JSON: ${String(err)}` }, { status: 502 });
	}

	return json({ ok: true, dispatched_trace_id: data.trace_id ?? null });
};
