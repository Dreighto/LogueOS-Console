import type { PageServerLoad } from './$types';
import { clientSafeConfig } from '$lib/server/config';
import { resolve } from '$app/paths';

export const load: PageServerLoad = async ({ fetch }) => {
	// resolve() honors kit.paths.base ('/console'). Without it, fetch('/api/workers')
	// hits the SITE root (https://room.taila28611.ts.net/api/workers → n8n) instead
	// of the app's mounted path. Server-side fetch in SvelteKit IS supposed to
	// dispatch internally for relative URLs, but base-path mismatches cause it to
	// fall through to the network fetch which then fails with TLS / undici errors.
	// Same root cause as the Runs tab fix from 2026-05-10 (canon adopted-lessons).
	try {
		const response = await fetch(resolve('/api/workers'));
		if (!response.ok) {
			throw new Error(`workers API returned ${response.status}`);
		}
		const { workers } = await response.json();
		return { workers, config: clientSafeConfig, errorMsg: null };
	} catch (e: unknown) {
		const errorMsg = e instanceof Error ? e.message : 'Unknown error fetching workers';
		console.error('Workers load error:', e);
		return { workers: [], config: clientSafeConfig, errorMsg };
	}
};
