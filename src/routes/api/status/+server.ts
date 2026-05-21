import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolve } from '$app/paths';
import { getTodayShipments, type Shipment } from '$lib/server/shipments';
import { getDispatchWorkers } from '$lib/config/workers';
import type { ActiveJob } from '$lib/types/worker';

interface WorkerState {
	id: string;
	state: 'idle' | 'busy' | 'offline';
	ticket_id?: string;
	step?: string;
	branch?: string;
	since?: string;
}

interface Run {
	timestamp: string;
	ticket_id: string | null;
	status: string;
	summary: string;
	worker: string;
	trace_id: string | null;
}

interface StatusBoardData {
	killSwitch: { active: boolean };
	failures: { count: number; items: Run[] };
	reviews: { count: number; items: Run[] };
	workers: { active: number; total: number; items: WorkerState[] };
	usage: { todayCost: number; recentDispatches: number };
	completions: { today: number; items: Shipment[] };
}

const EMPTY: StatusBoardData = {
	killSwitch: { active: false },
	failures: { count: 0, items: [] },
	reviews: { count: 0, items: [] },
	workers: { active: 0, total: 0, items: [] },
	usage: { todayCost: 0, recentDispatches: 0 },
	completions: { today: 0, items: [] }
};

// Collapse the per-slot job feed (/api/workers returns one entry per active
// lease since LOS-125) to one entry per worker for the landing page roster.
function rosterFromJobs(jobs: ActiveJob[]): WorkerState[] {
	return getDispatchWorkers().map((def) => {
		const job = jobs.find((j) => j && j.worker_id === def.id);
		return job
			? {
					id: def.id,
					state: 'busy' as const,
					ticket_id: job.ticket_id,
					step: job.step,
					branch: job.branch,
					since: job.since
				}
			: { id: def.id, state: 'idle' as const };
	});
}

let cachedStatus: StatusBoardData | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 1500; // 1.5s window to prevent CPU/network thrashing

export const GET: RequestHandler = async ({ fetch }) => {
	const currentTime = Date.now();
	if (cachedStatus && currentTime - lastCacheTime < CACHE_TTL_MS) {
		return json({ status: cachedStatus });
	}

	try {
		const [runsResp, workersResp, usageResp, killResp] = await Promise.all([
			fetch(resolve('/api/runs')),
			fetch(resolve('/api/workers')),
			fetch(resolve('/api/usage')),
			fetch(resolve('/api/kill-switch'))
		]);

		const runsData = runsResp.ok ? await runsResp.json() : { runs: [] };
		const workersData = workersResp.ok ? await workersResp.json() : { jobs: [] };
		const usageData = usageResp.ok ? await usageResp.json() : {};
		const kill = killResp.ok ? await killResp.json() : {};

		const allRuns: Run[] = runsData.runs || [];
		const roster = rosterFromJobs(workersData.jobs || []);

		const status: StatusBoardData = {
			killSwitch: { active: kill.active === true },
			failures: {
				count: allRuns.filter((r) => r.status === 'FAILED' || r.status === 'ESCALATE').length,
				items: allRuns.filter((r) => r.status === 'FAILED' || r.status === 'ESCALATE').slice(0, 3)
			},
			reviews: {
				count: allRuns.filter((r) => r.status === 'INCONCLUSIVE' || r.status === 'unknown').length,
				items: allRuns
					.filter((r) => r.status === 'INCONCLUSIVE' || r.status === 'unknown')
					.slice(0, 3)
			},
			workers: {
				active: roster.filter((w) => w.state === 'busy').length,
				total: roster.length,
				items: roster
			},
			usage: {
				todayCost: Number(usageData.metrics?.totalPredictedCost ?? 0),
				recentDispatches: Number(usageData.metrics?.recentDispatches ?? 0)
			},
			// Today's shipments = PRs merged in the local day, across repos (LOS-127).
			completions: await getTodayShipments()
		};

		cachedStatus = status;
		lastCacheTime = Date.now();
		return json({ status });
	} catch {
		// Fallback to cached state if a backend goes offline, to keep the
		// landing page operationally useful.
		if (cachedStatus) {
			return json({ status: cachedStatus });
		}
		return json({ status: EMPTY });
	}
};
