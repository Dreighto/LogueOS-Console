import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';
import fs from 'node:fs';
import readline from 'node:readline';
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
		return json({ error: 'invalid_trace_id', trace_id: trace_id ?? null }, { status: 400 });
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
		// CodeRabbit R2 Major: do not leak the resolved server-side path
		// in the response body — that's filesystem-structure disclosure.
		// Log it server-side instead so operators can debug from logs.
		console.error('path_traversal_blocked: resolvedPath outside dataDir', { resolvedPath, dataDir });
		return json({ error: 'path_traversal_blocked' }, { status: 403 });
	}

	// CodeRabbit R2 Major: stream the JSONL log line-by-line via readline
	// instead of fs.readFile-then-split. Constant memory regardless of log
	// size. Tracks the most-recent matching row (newest wins on the rare
	// trace_id collision) by reading forward and overwriting `match` until
	// the stream ends.
	//
	// CodeRabbit R3 fix: fs.createReadStream does NOT throw synchronously
	// on a missing file — the ENOENT surfaces asynchronously via the
	// stream's 'error' event, which propagates as a thrown exception in
	// the for-await loop below. So the ENOENT branch lives in the for-await
	// catch, not at stream-construction time.
	const stream = fs.createReadStream(resolvedPath, { encoding: 'utf-8' });
	const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
	let match: Run | null = null;

	try {
		for await (const line of rl) {
			if (!line.trim()) continue;
			try {
				const data = JSON.parse(line);
				if (data.trace_id !== trace_id) continue;
				match = {
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
			} catch {
				// Skip malformed JSONL line. CodeRabbit R2 lint: drop unused err binding.
			}
		}
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException;
		if (err.code === 'ENOENT') {
			console.error('completion_log_not_found', { resolvedPath });
			return json({ error: 'completion_log_not_found' }, { status: 503 });
		}
		console.error('API Error during stream read:', err);
		return json({ error: 'internal_server_error' }, { status: 500 });
	} finally {
		rl.close();
		stream.close();
	}

	if (match === null) {
		return json({ error: 'run_not_found', trace_id }, { status: 404 });
	}
	return json({ run: match });
};
