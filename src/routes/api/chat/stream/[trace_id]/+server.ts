import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs';
import path from 'node:path';
import { serverConfig } from '$lib/server/config';

// trace_ids are emitted by spawn.js with this exact shape:
//   <worker-prefix>-<8hex>-<8hex>
// e.g. cc-176dff87-16930491. Lock to that so a misbehaving caller can't
// path-traverse out of traceLogDir.
const TRACE_ID_RE = /^[a-z0-9]+-[a-f0-9]{8}-[a-f0-9]{8}$/i;

// Cap total bytes the SSE stream can send for a single trace. Workers can
// emit megabytes; we want to surface progress, not flood the browser. Once
// the cap is reached, the stream closes with a "truncated" event.
const MAX_BYTES_PER_STREAM = 512 * 1024; // 512 KB

// Poll the underlying file every N ms for new bytes. SSE responses are
// long-lived; this is the only cost while a worker runs silently. 500ms is
// snappy enough for terminal-like feel without thrashing the disk.
const POLL_INTERVAL_MS = 500;

// Hard cap on stream lifetime in case the client forgets to close. Workers
// have a 1200s timeout cap; we hold a bit longer to catch the synthetic
// completion marker.
const MAX_STREAM_LIFETIME_MS = 1500 * 1000;

// If the file is missing for this long after the stream opens, give up —
// the trace was either rejected by the listener or has already been cleaned.
const STARTUP_GRACE_MS = 30 * 1000;

// After we've seen bytes, if no NEW bytes arrive for this long, treat the
// worker as finished. The completion-log check below is the canonical
// signal, but this is the safety net for workers that died without writing
// a completion row.
const IDLE_AFTER_BYTES_MS = 90 * 1000;

// Cap on the bytes we tail-scan from cc_completion_log.jsonl each poll
// tick. Append-only JSONL so the most recent rows are at the end; 64 KB
// covers the last ~100 dispatches without scanning the whole file every
// 500 ms.
const COMPLETION_TAIL_BYTES = 64 * 1024;

function isTraceCompleted(completionLogPath: string, traceId: string): null | string {
	// Returns null if not yet completed, or the status string (e.g.
	// 'CONFIRMED_WORKING' / 'FAILED' / 'INCONCLUSIVE') if it is.
	let stat: fs.Stats;
	try {
		stat = fs.statSync(completionLogPath);
	} catch {
		return null;
	}
	const start = Math.max(0, stat.size - COMPLETION_TAIL_BYTES);
	const len = stat.size - start;
	if (len <= 0) return null;
	const buf = Buffer.alloc(len);
	let fd: number;
	try {
		fd = fs.openSync(completionLogPath, 'r');
	} catch {
		return null;
	}
	try {
		fs.readSync(fd, buf, 0, len, start);
	} catch {
		return null;
	} finally {
		fs.closeSync(fd);
	}
	const text = buf.toString('utf-8');
	// Fast prefilter: skip the regex if the trace_id isn't even mentioned.
	if (!text.includes(traceId)) return null;
	// Walk the lines from newest to oldest looking for our trace_id.
	const lines = text.split('\n');
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (!line || !line.includes(traceId)) continue;
		try {
			const row = JSON.parse(line);
			if (row && row.trace_id === traceId && typeof row.status === 'string') {
				return row.status;
			}
		} catch {
			// truncated trailing line is normal on a live file
		}
	}
	return null;
}

export const GET: RequestHandler = async ({ params }) => {
	const { trace_id: traceId } = params;
	if (!traceId || !TRACE_ID_RE.test(traceId)) {
		return error(400, 'invalid trace_id');
	}

	const filePath = path.join(serverConfig.traceLogDir, `${traceId}.stdout.log`);

	// Defense-in-depth: path-resolve check, in case the regex ever loosens.
	const resolved = path.resolve(filePath);
	const root = path.resolve(serverConfig.traceLogDir);
	if (!resolved.startsWith(root + path.sep)) {
		return error(400, 'invalid path');
	}

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder();
			let position = 0;
			let bytesSent = 0;
			let openedAt = Date.now();
			let lastByteAt = openedAt;
			let closed = false;
			let interval: ReturnType<typeof setInterval> | null = null;

			const send = (event: string, data: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
				} catch {
					// Controller already closed (client disconnected). Stop polling.
					closed = true;
					if (interval !== null) clearInterval(interval);
				}
			};

			const close = (reason: string) => {
				if (closed) return;
				closed = true;
				if (interval !== null) clearInterval(interval);
				try {
					controller.enqueue(encoder.encode(`event: end\ndata: ${JSON.stringify({ reason })}\n\n`));
					controller.close();
				} catch {
					// already closed
				}
			};

			// Initial "open" event so the client knows the stream is live even
			// before any bytes flow.
			send('open', JSON.stringify({ trace_id: traceId }));

			// Read any new bytes from the stdout log and emit them as a chunk.
			// Returns true if it pulled bytes (used to update lastByteAt + bail
			// loop branches early).
			const tickReadStdout = (): boolean => {
				let stat: fs.Stats;
				try {
					stat = fs.statSync(filePath);
				} catch {
					return false;
				}
				if (stat.size <= position) return false;

				const want = Math.min(stat.size - position, 64 * 1024);
				const allowed = Math.max(0, MAX_BYTES_PER_STREAM - bytesSent);
				const readSize = Math.min(want, allowed);
				if (readSize <= 0) return false;

				const buf = Buffer.alloc(readSize);
				let fd: number;
				try {
					fd = fs.openSync(filePath, 'r');
				} catch {
					return false;
				}
				try {
					fs.readSync(fd, buf, 0, readSize, position);
				} catch {
					return false;
				} finally {
					fs.closeSync(fd);
				}

				position += readSize;
				bytesSent += readSize;
				lastByteAt = Date.now();

				const text = buf.toString('utf-8');
				const sseSafe = text
					.split('\n')
					.map((line) => `data: ${line}`)
					.join('\n');
				try {
					controller.enqueue(encoder.encode(`event: chunk\n${sseSafe}\n\n`));
				} catch {
					closed = true;
					if (interval !== null) clearInterval(interval);
				}
				return true;
			};

			interval = setInterval(() => {
				if (closed) return;

				// Lifetime cap
				if (Date.now() - openedAt > MAX_STREAM_LIFETIME_MS) {
					close('max_lifetime');
					return;
				}

				// Canonical completion signal #1: the per-trace ".done" marker
				// file the dispatch_listener writes on worker_terminal (see
				// spawn.js writeTraceDoneMarker). Fires for every dispatch
				// regardless of ticket_id, so chat-dispatched workers (which
				// don't write cc_completion_log rows) still surface as done.
				try {
					const doneMarker = path.join(
						serverConfig.traceLogDir,
						`${traceId}.done`
					);
					if (fs.existsSync(doneMarker)) {
						let status = 'TERMINAL';
						try {
							const body = JSON.parse(fs.readFileSync(doneMarker, 'utf-8'));
							if (body && typeof body.status === 'string') status = body.status;
						} catch {
							/* malformed marker — close anyway, status unknown */
						}
						tickReadStdout();
						close(`completed:${status}`);
						return;
					}
				} catch {
					// stat/read error — fall through to other signals
				}

				// Canonical completion signal #2: the worker's row in
				// cc_completion_log.jsonl. Used by ticket-tied dispatches that
				// emit_completion themselves. Slower-path check (tail-scan of
				// a larger file) so we keep it after the .done marker check.
				const completionStatus = isTraceCompleted(
					serverConfig.completionLogPath,
					traceId
				);
				if (completionStatus) {
					tickReadStdout();
					close(`completed:${completionStatus}`);
					return;
				}

				// Idle safety net: bytes flowed at some point but nothing new
				// for a while → worker likely died without a completion row.
				if (bytesSent > 0 && Date.now() - lastByteAt > IDLE_AFTER_BYTES_MS) {
					close('idle_timeout');
					return;
				}

				// File-not-found path: wait through the grace window, then
				// give up if we never saw any bytes.
				try {
					fs.statSync(filePath);
				} catch {
					if (Date.now() - openedAt > STARTUP_GRACE_MS && bytesSent === 0) {
						close('not_found');
					}
					return;
				}

				tickReadStdout();

				if (bytesSent >= MAX_BYTES_PER_STREAM) {
					close('truncated');
				}
			}, POLL_INTERVAL_MS);
		},

		cancel() {
			// Client disconnected (closed EventSource). Interval already cleared
			// in send() / next tick via closed flag.
		}
	});

	return new Response(stream, {
		status: 200,
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			'x-accel-buffering': 'no', // disable proxy buffering
			connection: 'keep-alive'
		}
	});
};
