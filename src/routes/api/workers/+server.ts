import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';
import type { WorkerStatus } from '$lib/types/worker';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const GET: RequestHandler = async () => {
	// Base roster
	const workers: Record<string, WorkerStatus> = {
		'claude-code': { id: 'claude-code', state: 'idle' },
		gemini: { id: 'gemini', state: 'idle' }
	};

	try {
		// 1. Read DEFINITIVE active leases from worktree_leases.json
		// This replaces the unreliable log-trailing logic.
		const leasesPath = path.resolve('D:\\dev\\LogueOS-Orchestrator\\data\\worktree_leases.json');
		if (fs.existsSync(leasesPath)) {
			const leases = JSON.parse(fs.readFileSync(leasesPath, 'utf-8'));
			for (const slotPath in leases) {
				const lease = leases[slotPath];
				if (lease && lease.worker) {
					// Normalize worker name (e.g., 'claude-code-1' -> 'claude-code')
					let workerId = lease.worker;
					if (workerId.startsWith('claude-code')) workerId = 'claude-code';
					if (workerId.startsWith('gemini')) workerId = 'gemini';

					workers[workerId] = {
						id: workerId,
						state: 'busy',
						trace_id: lease.trace_id,
						ticket_id: lease.ticket_id,
						since: lease.leased_at,
						branch: lease.branch
					};
				}
			}
		}

		// 2. Enrich busy workers with real-time progress from cc_heartbeat_log.jsonl
		const resolvedHeartbeatPath = path.resolve(serverConfig.heartbeatsLogPath);
		if (fs.existsSync(resolvedHeartbeatPath)) {
			const hbStream = fs.createReadStream(resolvedHeartbeatPath);
			const rlHb = readline.createInterface({
				input: hbStream,
				crlfDelay: Infinity
			});

			for await (const line of rlHb) {
				if (!line.trim()) continue;
				try {
					const hb = JSON.parse(line);
					const rawId = hb.worker_id || hb.worker;
					if (!rawId) continue;

					let normalizedId = rawId;
					if (rawId.startsWith('claude-code')) normalizedId = 'claude-code';
					if (rawId.startsWith('gemini')) normalizedId = 'gemini';

					const worker = workers[normalizedId];
					// Only enrich if the worker is known to be busy per the lease file
					// OR if it's currently active in the heartbeat log (heartbeats are recent)
					if (worker && worker.state === 'busy') {
						worker.ticket_id = hb.ticket_id || worker.ticket_id;
						worker.step = hb.step || worker.step;
						worker.branch = hb.branch || worker.branch;
						worker.last_file_written = hb.last_file_written || worker.last_file_written;
						if (hb.trace_id) worker.trace_id = hb.trace_id;
					}
				} catch (e) {
					// Ignore
				}
			}
		}

		// 3. Get last exit status for idle workers from cc_completion_log.jsonl
		const resolvedCompletionPath = path.resolve(serverConfig.completionLogPath);
		if (fs.existsSync(resolvedCompletionPath)) {
			const compStream = fs.createReadStream(resolvedCompletionPath);
			const rlComp = readline.createInterface({
				input: compStream,
				crlfDelay: Infinity
			});

			for await (const line of rlComp) {
				if (!line.trim()) continue;
				try {
					const comp = JSON.parse(line);
					const workerId = comp.worker;
					if (workerId && workers[workerId] && workers[workerId].state === 'idle') {
						workers[workerId].last_exit_status = comp.status;
					}
				} catch (e) {
					// Ignore
				}
			}
		}

	} catch (error) {
		console.error('Error reading worker states:', error);
	}

	return json({
		workers: Object.values(workers)
	});
};
