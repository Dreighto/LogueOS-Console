// Server-side load for the status-board landing page.
// Reduces full data feeds to the at-a-glance counts the landing page renders.
// Detail pages (/workers, /runs, /usage, /memory) load the full payloads
// when the operator taps a row.
//
// Why we need this file: $lib/server/config can't be imported into
// +page.svelte (client). The right SvelteKit pattern is to read the
// config in a server hook (this file) and pass only the safe fields
// to the page via load(). See PR #2 review (CodeRabbit Critical on
// $env/dynamic/private leak into client code).

import type { PageServerLoad } from './$types';
import { clientSafeConfig } from '$lib/server/config';
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

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		const [runsResp, workersResp, usageResp, killResp] = await Promise.all([
			fetch(resolve('/api/runs')),
			fetch(resolve('/api/workers')),
			fetch(resolve('/api/usage')),
			fetch(resolve('/api/kill-switch'))
		]);

		const runsData = runsResp.ok ? await runsResp.json() : { runs: [] };
		const workersData = workersResp.ok ? await workersResp.json() : { workers: [] };
		const usageData = usageResp.ok ? await usageResp.json() : {};
		const kill = killResp.ok ? await killResp.json() : {};

		const allRuns: Run[] = runsData.runs || [];
		const workers: WorkerState[] = workersData.workers || [];

		// Today's boundaries
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

		return { status, ...clientSafeConfig };
	} catch (error) {
		console.error('SSR status-board fetch error:', error);
		return { status: EMPTY, loadError: true, ...clientSafeConfig };
	}
};
