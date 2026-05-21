import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';
import type { Run } from '$lib/types/run';
import { coerceRunStatus } from '$lib/types/run';
import { dedupeRuns } from '$lib/utils/runs';

function parseRun(comp: any): Run {
	return {
		timestamp: comp.timestamp || comp.completed_at || '',
		ticket_id: comp.ticket_id || null,
		status: coerceRunStatus(comp.status),
		summary: comp.summary || '',
		// Real workers log the worktree-slot id as `worker_id`; older rows used
		// `worker`. Fall back so the run carries an identity instead of 'unknown'.
		worker: comp.worker || comp.worker_id || 'unknown',
		trace_id: comp.trace_id || null,
		duration_ms: comp.duration_ms ?? null,
		pr_number: comp.pr_number ?? null,
		branch: comp.branch || null,
		files_touched: comp.files_touched || [],
		project_id: comp.project_id || null
	};
}

// Test heartbeats and synthetic stale-cleanup backfill rows are not real runs.
// Left in, they inflate the status board's failure / review counts. Drop them
// at the source so every downstream consumer sees a clean feed.
function isTestArtifact(run: Run): boolean {
	const ticket = run.ticket_id ?? '';
	const trace = run.trace_id ?? '';
	return ticket.startsWith('TEST-') || trace.startsWith('backfill-');
}

export const GET: RequestHandler = async ({ url }) => {
	const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
	const limit =
		Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : serverConfig.feedLimit;
	const traceIdFilter = url.searchParams.get('trace_id');

	// Live polling path: read the dispatch listener's primary output directly.
	// /api/v1/completion-log is a downstream mirror with async ingestion lag, so
	// it's the wrong source for "did this dispatch finish yet" — the inbox
	// result.json is authoritative.
	if (traceIdFilter) {
		try {
			const resp = await fetch(
				`${serverConfig.gatewayUrl}/api/v1/dispatch-result?trace_id=${encodeURIComponent(traceIdFilter)}`
			);
			if (!resp.ok) {
				return json({ runs: [], total_in_log: 0, truncated: false });
			}
			const data = await resp.json();
			if (!data.found || !data.result) {
				return json({ runs: [], total_in_log: 0, truncated: false });
			}
			return json({ runs: [parseRun(data.result)], total_in_log: 1, truncated: false });
		} catch (e: unknown) {
			console.error('Runs API trace lookup error:', e);
			return json({ error: 'internal_server_error' }, { status: 500 });
		}
	}

	try {
		const response = await fetch(`${serverConfig.gatewayUrl}/api/v1/completion-log`);
		if (!response.ok) {
			throw new Error(`Gateway returned ${response.status}`);
		}
		const data = await response.json();
		const rawCompletions = data.completions || [];

		const parsedRuns: Run[] = rawCompletions.map(parseRun).filter((r: Run) => !isTestArtifact(r));
		const dedupedRuns = dedupeRuns(parsedRuns);

		const runs = dedupedRuns.slice(-limit).reverse();
		const total_in_log = rawCompletions.length;
		const truncated = dedupedRuns.length > limit;

		return json({ runs, total_in_log, truncated });
	} catch (e: unknown) {
		console.error('Runs API Error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};
