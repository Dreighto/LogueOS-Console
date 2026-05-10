import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { deriveWorkerFromTraceId } from '$lib/utils/format';
import type { Run } from '$lib/types/run';
import { coerceRunStatus } from '$lib/types/run';

export const GET: RequestHandler = async ({ url }) => {
	// CodeRabbit Major: parseInt(...) accepts 0, negatives, and "1foo".
	// `slice(-0)` returns the entire array; negatives shift the window
	// in surprising ways. Coerce invalid input back to the configured default.
	const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
	const limit =
		Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : serverConfig.feedLimit;

	const logPath = serverConfig.completionLogPath;

	// CodeRabbit Major: startsWith() is unsafe as a path-boundary check
	// (e.g. ".../data" matches ".../data-other") AND too strict (only
	// permits one parent dir). Compare via path.relative() instead —
	// the documented pattern for "is this path inside that dir."
	const resolvedPath = path.resolve(logPath);
	const dataDir = path.resolve(path.dirname(logPath));
	const relative = path.relative(dataDir, resolvedPath);
	const isInsideDataDir =
		relative !== '' &&
		!relative.startsWith('..') &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative);

	if (!isInsideDataDir) {
		return json({ error: 'path_traversal_blocked', path: resolvedPath }, { status: 403 });
	}

	try {
		const content = await fs.readFile(resolvedPath, 'utf-8');
		const lines = content.split('\n').filter((line) => line.trim() !== '');
		const total_in_log = lines.length;

		// CodeRabbit Major: previously sliced -limit raw lines BEFORE
		// parsing, so any malformed trailing rows reduced the response
		// count. Now: parse + filter all rows, then slice the last
		// `limit` valid runs, then reverse to newest-first. This keeps
		// `?limit=N` accurate even if some rows are corrupt.
		const parsedRuns: Run[] = [];
		for (const line of lines) {
			try {
				const data = JSON.parse(line);
				parsedRuns.push({
					timestamp: data.timestamp || '',
					ticket_id: data.ticket_id || null,
					status: coerceRunStatus(data.status),
					summary: data.summary || '',
					worker: data.worker || deriveWorkerFromTraceId(data.trace_id),
					trace_id: data.trace_id || null,
					// ?? not ||: a legitimate 0 ms duration or PR #0 is meaningful
					// data; falsy coercion would silently drop them. CodeRabbit
					// Round 2 minor.
					duration_ms: data.duration_ms ?? null,
					pr_number: data.pr_number ?? null,
					branch: data.branch || null,
					files_touched: data.files_touched || []
				});
			} catch (err) {
				console.error(`Failed to parse run-log line: ${line}`, err);
				// Skip malformed line; do not 500 the whole response.
			}
		}

		const runs = parsedRuns.slice(-limit).reverse();
		const truncated = parsedRuns.length > limit;

		return json({ runs, total_in_log, truncated });
	} catch (e: unknown) {
		// CodeRabbit Major: catch (e: any) defeats strict TS. Narrow to
		// NodeJS.ErrnoException for the .code lookup, then handle the
		// known ENOENT case explicitly; everything else is a 500.
		const err = e as NodeJS.ErrnoException;
		if (err.code === 'ENOENT') {
			return json({ error: 'completion_log_not_found', path: resolvedPath }, { status: 503 });
		}
		console.error('API Error:', err);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};
