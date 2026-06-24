import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';
import type { ActiveJob, WorkerNote, Lane } from '$lib/types/worker';
import { getDispatchWorkers, resolveWorker } from '$lib/config/workers';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

// worktree_leases.json is keyed by slot path. Reading it per-slot (not per
// worker) is what lets the console show concurrent dispatches — see LOS-125.
// Linux path post-migration (the old `D:\dev\...` literal was missed when
// config.ts was migrated, so this endpoint silently returned no live jobs).
// Override with LOGUEOS_LEASES_PATH if the data dir ever moves.
const LEASES_PATH =
	process.env.LOGUEOS_LEASES_PATH ??
	'/home/dreighto/dev/LogueOS-Orchestrator/data/worktree_leases.json';
const HEARTBEAT_RECENCY_MS = 30 * 60 * 1000;

interface Lease {
	worker?: string;
	trace_id?: string;
	ticket_id?: string;
	leased_at?: string;
	branch?: string;
	/** Set by the orchestrator (LOS-126); the true lane of the work. */
	lane?: string;
}

export const GET: RequestHandler = async () => {
	const jobs: ActiveJob[] = [];
	const notes: WorkerNote[] = [];

	try {
		// 1. Active leases — ONE job per non-null slot. The file is keyed by slot,
		//    so concurrent leases for the same worker are all preserved. The old
		//    per-worker-id map kept only the last lease — the collapse bug.
		const busyWorkerIds = new Set<string>();
		if (fs.existsSync(LEASES_PATH)) {
			const leases = JSON.parse(fs.readFileSync(LEASES_PATH, 'utf-8')) as Record<
				string,
				Lease | null
			>;
			for (const slotPath of Object.keys(leases)) {
				const lease = leases[slotPath];
				if (!lease || !lease.worker) continue;
				const def = resolveWorker(lease.worker);
				if (!def || def.role === 'operator') continue;
				busyWorkerIds.add(def.id);
				// Lane: the orchestrator-recorded lane wins (LOS-126); until that
				// lands, fall back to the worker's home role.
				const lane: Lane =
					lease.lane === 'frontend' || lease.lane === 'backend' ? lease.lane : (def.role as Lane);
				jobs.push({
					slot: slotPath.split(/[\\/]/).slice(-2).join('/'),
					trace_id: lease.trace_id,
					worker_id: def.id,
					lane,
					ticket_id: lease.ticket_id,
					branch: lease.branch,
					since: lease.leased_at
				});
			}
		}

		// 2. Enrich each job with live progress from the heartbeat log. Match on
		//    the job's own trace_id / ticket_id; recent heartbeats only (the log
		//    is append-only and dominated by stale entries).
		const hbPath = path.resolve(serverConfig.heartbeatsLogPath);
		if (jobs.length > 0 && fs.existsSync(hbPath)) {
			const now = Date.now();
			const rl = readline.createInterface({
				input: fs.createReadStream(hbPath),
				crlfDelay: Infinity
			});
			for await (const line of rl) {
				if (!line.trim()) continue;
				try {
					const hb = JSON.parse(line);
					const hbTs = Date.parse(hb.ts ?? hb.timestamp ?? '');
					if (!Number.isFinite(hbTs) || now - hbTs > HEARTBEAT_RECENCY_MS) continue;
					for (const job of jobs) {
						const matches =
							(hb.trace_id && job.trace_id && hb.trace_id === job.trace_id) ||
							(hb.ticket_id && job.ticket_id && hb.ticket_id === job.ticket_id);
						if (!matches) continue;
						if (hb.step) job.step = hb.step;
						if (hb.branch) job.branch = hb.branch;
						if (hb.last_file_written) job.last_file_written = hb.last_file_written;
					}
				} catch {
					// skip malformed line
				}
			}
		}

		// 3. Operational notes — a dispatch worker with no active job whose last
		//    recorded exit was not clean. Sourced from the listener's worker_exit
		//    events (chronological; the last one wins).
		const lastExit: Record<string, string> = {};
		const wlPath = path.resolve(serverConfig.workerLogPath);
		if (fs.existsSync(wlPath)) {
			const rl = readline.createInterface({
				input: fs.createReadStream(wlPath),
				crlfDelay: Infinity
			});
			for await (const line of rl) {
				if (!line.trim()) continue;
				try {
					const evt = JSON.parse(line);
					if (evt.msg !== 'worker_exit') continue;
					const def = resolveWorker(evt.worker);
					if (def) lastExit[def.id] = evt.status;
				} catch {
					// skip malformed line
				}
			}
		}
		for (const def of getDispatchWorkers()) {
			if (busyWorkerIds.has(def.id)) continue;
			const status = lastExit[def.id];
			if (status && !['CONFIRMED_WORKING', 'INCONCLUSIVE'].includes(status)) {
				notes.push({ worker_id: def.id, last_exit_status: status });
			}
		}
	} catch (error) {
		console.error('Error reading worker states:', error);
	}

	return json({ jobs, notes });
};
