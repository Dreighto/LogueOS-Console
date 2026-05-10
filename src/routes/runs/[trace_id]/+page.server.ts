// Server-side load: fetches the single-run detail via the /api/runs/[trace_id]
// endpoint and hands the result to +page.svelte as $props().data. Doing the
// fetch server-side means direct URL navigation (e.g. an operator pasting a
// /runs/<trace_id> link) renders the data on first paint instead of showing a
// client-side loading spinner. Also fixes the Svelte 5 $effect dependency-
// tracking bug CodeRabbit flagged on PR #3 — there's no client-side reactive
// fetch to mis-track.
//
// The spec for LOS-3 explicitly required this pattern; the original gemini
// implementation used client-side fetch in +page.svelte. Switching to server-
// side load aligns with the spec and eliminates the symptom.
import type { PageServerLoad } from './$types';
import type { Run } from '$lib/types/run';

interface RunDetailData {
	run: Run | null;
	notFoundTraceId: string | null;
	errorMsg: string | null;
}

export const load: PageServerLoad = async ({ params, fetch }): Promise<RunDetailData> => {
	const traceId = params.trace_id;
	if (!traceId) {
		return { run: null, notFoundTraceId: null, errorMsg: 'No trace_id supplied' };
	}

	const resp = await fetch(`/api/runs/${traceId}`);

	// 404 → friendly empty state (RunNotFound rendered by +page.svelte).
	// Don't `error()` throw here — that would render the global error page;
	// we want an in-app empty card with a Back-to-Runs CTA.
	if (resp.status === 404) {
		return { run: null, notFoundTraceId: traceId, errorMsg: null };
	}

	// 400 (invalid trace_id pattern) and 5xx → render an error banner with
	// the message from the endpoint. Same not-throwing rationale.
	if (!resp.ok) {
		let errorMsg = `HTTP ${resp.status}`;
		try {
			const errData = await resp.json();
			errorMsg = errData.error || errorMsg;
		} catch {
			// Endpoint returned non-JSON; keep the HTTP status as the message.
		}
		return { run: null, notFoundTraceId: null, errorMsg };
	}

	const data = await resp.json();
	return { run: data.run as Run, notFoundTraceId: null, errorMsg: null };
};
