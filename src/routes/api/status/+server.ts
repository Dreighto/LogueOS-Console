import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolve } from '$app/paths';

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
	completions: { today: number; items: Run[] };
}

const EMPTY: StatusBoardData = {
	killSwitch: { active: false },
	failures: { count: 0, items: [] },
	reviews: { count: 0, items: [] },
	workers: { active: 0, total: 0, items: [] },
	usage: { todayCost: 0, recentDispatches: 0 },
	completions: { today: 0, items: [] }
};

let cachedStatus: StatusBoardData | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 1500; // 1.5 second cache window to prevent CPU/Network thrashing

export const GET: RequestHandler = async ({ fetch }) => {
	const currentTime = Date.now();
	if (cachedStatus && currentTime - lastCacheTime < CACHE_TTL_MS) {
		return json({ status: cachedStatus });
	}

	try {
		const [runsResp, workersResp, usageResp, killResp, activityResp] = await Promise.all([
			fetch(resolve('/api/runs')),
			fetch(resolve('/api/workers')),
			fetch(resolve('/api/usage')),
			fetch(resolve('/api/kill-switch')),
			fetch(resolve('/api/activity'))
		]);

		const runsData = runsResp.ok ? await runsResp.json() : { runs: [] };
		const workersData = workersResp.ok ? await workersResp.json() : { workers: [] };
		const usageData = usageResp.ok ? await usageResp.json() : {};
		const kill = killResp.ok ? await killResp.json() : {};
		const activityData = activityResp.ok ? await activityResp.json() : { events: [] };

		const allRuns: Run[] = runsData.runs || [];
		const workers: WorkerState[] = workersData.workers || [];

		// Completion-log rows written by real workers carry no timestamp, but the
		// dispatch activity log does. Backfill an empty run timestamp from its
		// matching worker_exit event so date-based filtering ("today") works —
		// otherwise genuine completions silently drop out of the count.
		const exitTsByTrace = new Map<string, string>();
		for (const ev of activityData.events ?? []) {
			if (ev.msg === 'worker_exit' && ev.trace_id && ev.ts && !exitTsByTrace.has(ev.trace_id)) {
				exitTsByTrace.set(ev.trace_id, ev.ts);
			}
		}
		for (const r of allRuns) {
			if (!r.timestamp && r.trace_id && exitTsByTrace.has(r.trace_id)) {
				r.timestamp = exitTsByTrace.get(r.trace_id) as string;
			}
		}

		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
		const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

		const completionsToday = allRuns
			.filter(
				(r) =>
					r.status === 'CONFIRMED_WORKING' && r.timestamp >= todayStart && r.timestamp < todayEnd
			)
			.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

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
				active: workers.filter((w) => w.state === 'busy').length,
				total: workers.length,
				items: workers
			},
			usage: {
				todayCost: Number(usageData.metrics?.totalPredictedCost ?? 0),
				recentDispatches: Number(usageData.metrics?.recentDispatches ?? 0)
			},
			completions: {
				today: completionsToday.length,
				items: completionsToday.slice(0, 10)
			}
		};

		// Save successful response to cache
		cachedStatus = status;
		lastCacheTime = Date.now();

		return json({ status });
	} catch {
		// Fallback to cached state if backend goes offline to maintain operational visibility
		if (cachedStatus) {
			return json({ status: cachedStatus });
		}
		return json({ status: EMPTY });
	}
};
