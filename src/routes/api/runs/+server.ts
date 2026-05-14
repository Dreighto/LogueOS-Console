import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';
import type { Run } from '$lib/types/run';
import { coerceRunStatus } from '$lib/types/run';
import { dedupeRuns } from '$lib/utils/runs';

export const GET: RequestHandler = async ({ url }) => {
	const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
	const limit =
		Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : serverConfig.feedLimit;

	try {
		const response = await fetch(`${serverConfig.gatewayUrl}/api/v1/completion-log`);
		if (!response.ok) {
			throw new Error(`Gateway returned ${response.status}`);
		}
		const data = await response.json();
		const rawCompletions = data.completions || [];

		const parsedRuns: Run[] = rawCompletions.map((comp: any) => ({
			timestamp: comp.timestamp || '',
			ticket_id: comp.ticket_id || null,
			status: coerceRunStatus(comp.status),
			summary: comp.summary || '',
			worker: comp.worker || 'unknown',
			trace_id: comp.trace_id || null,
			duration_ms: comp.duration_ms ?? null,
			pr_number: comp.pr_number ?? null,
			branch: comp.branch || null,
			files_touched: comp.files_touched || [],
			project_id: comp.project_id || null
		}));

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
