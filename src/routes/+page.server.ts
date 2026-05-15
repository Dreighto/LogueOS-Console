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

interface StatusBoardData {
	killSwitch: { active: boolean };
	failures: { count: number };
	reviews: { count: number };
	workers: { active: number; total: number };
	usage: { todayCost: number };
	memory: { totalLessons: number };
}

const EMPTY: StatusBoardData = {
	killSwitch: { active: false },
	failures: { count: 0 },
	reviews: { count: 0 },
	workers: { active: 0, total: 0 },
	usage: { todayCost: 0 },
	memory: { totalLessons: 0 }
};

interface RunRow {
	status?: string;
}
interface WorkerRow {
	state?: string;
}
interface MemoryPayload {
	provisional?: unknown[];
	adopted?: unknown[];
}
interface UsagePayload {
	metrics?: { totalPredictedCost?: number };
}
interface KillSwitchPayload {
	active?: boolean;
}

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		const [runsResp, workersResp, usageResp, memoryResp, killResp] = await Promise.all([
			fetch(resolve('/api/runs')),
			fetch(resolve('/api/workers')),
			fetch(resolve('/api/usage')),
			fetch(resolve('/api/memory')),
			fetch(resolve('/api/kill-switch'))
		]);

		const runs: RunRow[] = runsResp.ok ? ((await runsResp.json())?.runs ?? []) : [];
		const workers: WorkerRow[] = workersResp.ok
			? ((await workersResp.json())?.workers ?? [])
			: [];
		const usage: UsagePayload = usageResp.ok ? await usageResp.json() : {};
		const memory: MemoryPayload = memoryResp.ok ? await memoryResp.json() : {};
		const kill: KillSwitchPayload = killResp.ok ? await killResp.json() : {};

		const status: StatusBoardData = {
			killSwitch: { active: kill.active === true },
			failures: {
				count: runs.filter((r) => r.status === 'FAILED' || r.status === 'ESCALATE').length
			},
			reviews: {
				count: runs.filter((r) => r.status === 'INCONCLUSIVE' || r.status === 'unknown').length
			},
			workers: {
				// "active" = not in the 'idle' bucket. State enum varies by worker;
				// idle is the only state we know never means "doing something."
				active: workers.filter((w) => w.state && w.state !== 'idle').length,
				total: workers.length
			},
			usage: { todayCost: Number(usage.metrics?.totalPredictedCost ?? 0) },
			memory: {
				totalLessons: (memory.provisional?.length ?? 0) + (memory.adopted?.length ?? 0)
			}
		};

		return { status, ...clientSafeConfig };
	} catch (error) {
		console.error('SSR status-board fetch error:', error);
		return { status: EMPTY, ...clientSafeConfig };
	}
};
