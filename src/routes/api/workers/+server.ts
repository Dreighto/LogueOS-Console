import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';
import type { WorkerStatus } from '$lib/types/worker';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const GET: RequestHandler = async () => {
	const workers: Record<string, WorkerStatus> = {
		'claude-code': { id: 'claude-code', state: 'idle' },
		gemini: { id: 'gemini', state: 'idle' }
	};

	try {
		const resolvedPath = path.resolve(serverConfig.workerLogPath);
		const dataDir = path.resolve(path.dirname(serverConfig.workerLogPath));
		const relative = path.relative(dataDir, resolvedPath);
		const isSafe =
			relative !== '' &&
			!relative.startsWith('..') &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative);
		if (!isSafe) {
			return json({ error: 'path_traversal_blocked' }, { status: 403 });
		}

		if (fs.existsSync(resolvedPath)) {
			const fileStream = fs.createReadStream(resolvedPath);
			const rl = readline.createInterface({
				input: fileStream,
				crlfDelay: Infinity
			});

			for await (const line of rl) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line);
					if (event.msg === 'worker_spawned' || event.msg === 'worker_exit') {
						let workerId = event.worker;
						if (!workerId && event.msg === 'worker_spawned') {
							// fallback if worker is missing but trace_id suggests it
							if (event.trace_id?.startsWith('cc-')) workerId = 'claude-code';
						}
						
						if (workerId) {
							if (!workers[workerId]) {
								workers[workerId] = { id: workerId, state: 'idle' };
							}
							
							if (event.msg === 'worker_spawned') {
								workers[workerId] = {
									id: workerId,
									state: 'busy',
									trace_id: event.trace_id,
									pid: event.pid,
									since: event.ts
								};
							} else {
								workers[workerId] = {
									id: workerId,
									state: 'idle',
									trace_id: event.trace_id,
									pid: event.pid,
									since: event.ts,
									last_exit_status: event.status
								};
							}
						}
					}
				} catch (e) {
					// Ignore malformed JSON lines
				}
			}
		}
	} catch (error) {
		console.error('Error reading worker log:', error);
	}

	return json({
		workers: Object.values(workers)
	});
};
