// Server-side load: hands client-safe config values to +page.svelte
// without exposing server-only modules. The page's $props().data is
// typed via App.PageData (auto-inferred from this load's return type).
//
// Why we need this file: $lib/server/config can't be imported into
// +page.svelte (client). The right SvelteKit pattern is to read the
// config in a server hook (this file) and pass only the safe fields
// to the page via load(). See PR #2 review (CodeRabbit Critical on
// $env/dynamic/private leak into client code).

import type { PageServerLoad } from './$types';
import { clientSafeConfig } from '$lib/server/config';
import { resolve } from '$app/paths';

export const load: PageServerLoad = async ({ fetch }) => {
	// Server-side load: hands initial dashboard data to the client
	// so we don't render an empty skeleton on first paint.
	try {
		const [runsResp, memoryResp, usageResp, workersResp] = await Promise.all([
			fetch(resolve('/api/runs')),
			fetch(resolve('/api/memory')),
			fetch(resolve('/api/usage')),
			fetch(resolve('/api/workers'))
		]);

		const runsData = runsResp.ok ? await runsResp.json() : { runs: [] };
		const memoryData = memoryResp.ok
			? await memoryResp.json()
			: { provisional: [], adopted: [], raw: [] };
		const usageData = usageResp.ok ? await usageResp.json() : { metrics: null };
		const workersData = workersResp.ok ? await workersResp.json() : { workers: [] };

		return {
			runs: runsData.runs,
			memory: memoryData,
			usage: usageData.metrics,
			workers: workersData.workers,
			...clientSafeConfig
		};
	} catch (error) {
		console.error('SSR fetch error for dashboard:', error);
		return {
			runs: [],
			memory: { provisional: [], adopted: [], raw: [] },
			usage: null,
			workers: [],
			...clientSafeConfig
		};
	}
};
