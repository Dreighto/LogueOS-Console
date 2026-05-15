import type { PageServerLoad } from './$types';
import { clientSafeConfig } from '$lib/server/config';
import { resolve } from '$app/paths';

export const load: PageServerLoad = async ({ fetch }) => {
	// resolve() honors kit.paths.base ('/console'). See workers/+page.server.ts
	// for why bare '/api/activity' fails behind a base path. Returning
	// `clientSafeConfig` (matches the prior shipped key name `clientSafeConfig`,
	// kept for compatibility with the +page.svelte that reads
	// data.clientSafeConfig.pollIntervalMs).
	try {
		const response = await fetch(resolve('/api/activity'));
		if (!response.ok) {
			throw new Error(`activity API returned ${response.status}`);
		}
		const { events } = await response.json();
		return { events, clientSafeConfig, errorMsg: null };
	} catch (e: unknown) {
		const errorMsg = e instanceof Error ? e.message : 'Unknown error fetching activity';
		console.error('Activity load error:', e);
		return { events: [], clientSafeConfig, errorMsg };
	}
};
