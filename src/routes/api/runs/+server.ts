import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { deriveWorkerFromTraceId } from '$lib/utils/format';
import type { Run } from '$lib/types/run';

export const GET: RequestHandler = async ({ url }) => {
	const limit = parseInt(url.searchParams.get('limit') || config.feedLimit.toString());
	const logPath = config.completionLogPath;

	// Defensive check: ensure the path is within project-miru/data
	// This is a bit tricky with absolute paths on Windows, but we'll do a basic check.
	const resolvedPath = path.resolve(logPath);
	const dataDir = path.resolve('D:\\dev\\miru\\data');
	
	if (!resolvedPath.startsWith(dataDir)) {
		return json({ error: 'path_traversal_blocked' }, { status: 403 });
	}

	try {
		const content = await fs.readFile(resolvedPath, 'utf-8');
		const lines = content.split('\n').filter((line) => line.trim() !== '');
		
		const total_in_log = lines.length;
		const truncated = total_in_log > limit;

		const runs: Run[] = lines
			.slice(-limit) // Get the last 'limit' lines
			.reverse()    // Reverse to get newest first
			.map((line) => {
				try {
					const data = JSON.parse(line);
					return {
						timestamp: data.timestamp || '',
						ticket_id: data.ticket_id || null,
						status: data.status || 'unknown',
						summary: data.summary || '',
						worker: data.worker || deriveWorkerFromTraceId(data.trace_id),
						trace_id: data.trace_id || null,
						duration_ms: data.duration_ms || null,
						pr_number: data.pr_number || null,
						branch: data.branch || null,
						files_touched: data.files_touched || []
					};
				} catch (e) {
					console.error(`Failed to parse line: ${line}`, e);
					return null;
				}
			})
			.filter((run): run is Run => run !== null);

		return json({ runs, total_in_log, truncated });
	} catch (e: any) {
		if (e.code === 'ENOENT') {
			return json({ error: 'completion_log_not_found', path: resolvedPath }, { status: 503 });
		}
		console.error('API Error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};
