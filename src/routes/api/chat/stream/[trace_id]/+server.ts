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

			interval = setInterval(() => {
				if (closed) return;

				// Lifetime cap
				if (Date.now() - openedAt > MAX_STREAM_LIFETIME_MS) {
					close('max_lifetime');
					return;
				}

				let stat: fs.Stats;
				try {
					stat = fs.statSync(filePath);
				} catch {
					// File doesn't exist yet — wait through the grace window.
					if (Date.now() - openedAt > STARTUP_GRACE_MS && bytesSent === 0) {
						close('not_found');
					}
					return;
				}

				if (stat.size <= position) return; // no new bytes

				// Read only the new tail. Cap each read so a worker that dumps
				// 50MB at once doesn't pin the event loop.
				const want = Math.min(stat.size - position, 64 * 1024);
				const allowed = Math.max(0, MAX_BYTES_PER_STREAM - bytesSent);
				const readSize = Math.min(want, allowed);
				if (readSize <= 0) {
					if (bytesSent >= MAX_BYTES_PER_STREAM) {
						close('truncated');
					}
					return;
				}

				const buf = Buffer.alloc(readSize);
				let fd: number;
				try {
					fd = fs.openSync(filePath, 'r');
				} catch {
					return;
				}
				try {
					fs.readSync(fd, buf, 0, readSize, position);
				} catch {
					return;
				} finally {
					fs.closeSync(fd);
				}

				position += readSize;
				bytesSent += readSize;

				// Send as a single chunk. SSE clients receive the data verbatim;
				// newlines inside the data are preserved if we wrap with the
				// "data: " convention per logical event. For free-form stdout we
				// chunk and let the client split lines.
				const text = buf.toString('utf-8');
				// SSE requires escaping embedded newlines into multiple data: lines.
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
