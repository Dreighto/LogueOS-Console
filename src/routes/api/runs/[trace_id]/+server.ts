import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { deriveWorkerFromTraceId } from '$lib/utils/format';
import type { Run } from '$lib/types/run';
import { coerceRunStatus } from '$lib/types/run';

// Per-spec trace_id format: prefix-shape worker tags + hex hashes. Allowing
// alphanumeric + hyphen + underscore. 6-char floor rules out trivially-short
// inputs that couldn't be a real trace; 128-char ceiling rules out URL-bomb
// abuse. Validated BEFORE filesystem access to fail fast on malformed paths.
// (CodeRabbit Major on PR #3.)
const TRACE_ID_PATTERN = /^[a-zA-Z0-9_-]{6,128}$/;

export const GET: RequestHandler = async ({ params }) => {
	const { trace_id } = params;
	if (!trace_id || !TRACE_ID_PATTERN.test(trace_id)) {
		return json(
			{ error: 'invalid_trace_id', trace_id: trace_id ?? null },
			{ status: 400 }
		);
	}
	const logPath = serverConfig.completionLogPath;

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

		// Search from newest to oldest for better performance on recent runs
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i];
			try {
				const data = JSON.parse(line);
				if (data.trace_id === trace_id) {
					const run: Run = {
						timestamp: data.timestamp || '',
						ticket_id: data.ticket_id || null,
						status: coerceRunStatus(data.status),
						summary: data.summary || '',
						worker: data.worker || deriveWorkerFromTraceId(data.trace_id),
						trace_id: data.trace_id || null,
						duration_ms: data.duration_ms ?? null,
						pr_number: data.pr_number ?? null,
						branch: data.branch || null,
						files_touched: data.files_touched || []
					};
					return json({ run });
				}
			} catch (err) {
				// Skip malformed line
			}
		}

		return json({ error: 'run_not_found', trace_id }, { status: 404 });
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException;
		if (err.code === 'ENOENT') {
			return json({ error: 'completion_log_not_found', path: resolvedPath }, { status: 503 });
		}
		console.error('API Error:', err);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};
