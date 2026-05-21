import type { PageServerLoad } from './$types';
import { clientSafeConfig } from '$lib/server/config';
import { resolve } from '$app/paths';

export const load: PageServerLoad = async ({ fetch }) => {
	// resolve() honors kit.paths.base ('/console'). A bare fetch('/api/workers')
	// hits the SITE root behind the tailscale serve subpath and 404s.
	try {
		const response = await fetch(resolve('/api/workers'));
		if (!response.ok) {
			throw new Error(`workers API returned ${response.status}`);
		}
		const { jobs, notes } = await response.json();
		return { jobs, notes, config: clientSafeConfig, errorMsg: null };
	} catch (e: unknown) {
		const errorMsg = e instanceof Error ? e.message : 'Unknown error fetching workers';
		console.error('Workers load error:', e);
		return { jobs: [], notes: [], config: clientSafeConfig, errorMsg };
	}
};
