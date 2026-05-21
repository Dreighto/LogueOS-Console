import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';
import type { Run } from '$lib/types/run';
import { coerceRunStatus } from '$lib/types/run';
import { dedupeRuns } from '$lib/utils/runs';
import fs from 'node:fs';

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
// Drop them at the source so downstream consumers see a clean feed.
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

	// Live single-dispatch poll: the gateway's dispatch-result is authoritative
	// for "did this trace finish yet". Left unchanged.
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

	// List path: read the authoritative completion log on disk directly. The
	// gateway's /api/v1/completion-log mirror has async ingestion lag (it had
	// been weeks-stale) — the on-disk log is the fresh, accurate source. LOS-128.
	try {
		const raw = fs.existsSync(serverConfig.completionLogPath)
			? fs.readFileSync(serverConfig.completionLogPath, 'utf-8')
			: '';
		const rawCompletions: any[] = [];
		for (const line of raw.split('\n')) {
			if (!line.trim()) continue;
			try {
				rawCompletions.push(JSON.parse(line));
			} catch {
				// skip malformed line
			}
		}

		const parsedRuns: Run[] = rawCompletions.map(parseRun).filter((r) => !isTestArtifact(r));
		const dedupedRuns = dedupeRuns(parsedRuns);

		const runs = dedupedRuns.slice(-limit).reverse();
		return json({
			runs,
			total_in_log: rawCompletions.length,
			truncated: dedupedRuns.length > limit
		});
	} catch (e: unknown) {
		console.error('Runs API Error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};
