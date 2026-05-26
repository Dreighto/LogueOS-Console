// Server-side load for Settings.
// Combines:
//   - Kill-switch state (PR #21) — read via shared helper so SSR renders the
//     correct ACTIVE/CLEAR state on first paint.
//   - Connection-status services (LOS-70) — fetched from /api/system, returned
//     as `services` for the Connectivity section.
// pollIntervalMs flows through clientSafeConfig so the page can refresh.

import type { PageServerLoad } from './$types';
import { clientSafeConfig } from '$lib/server/config';
import { readKillSwitchStateSafe } from '$lib/server/kill-switch';

export const load: PageServerLoad = async ({ fetch }) => {
	let services: Array<{ id: string; name: string; status: 'online' | 'offline' }> = [];
	try {
		const sysRes = await fetch('/api/system');
		if (sysRes.ok) {
			const data = await sysRes.json();
			services = Array.isArray(data.services) ? data.services : [];
		}
	} catch (e) {
		console.error('Settings: /api/system load failed', e);
	}

	type SpendEntry = { provider: string; tokens_used: number; cap: number; pct: number };
	let spendProviders: SpendEntry[] = [];
	try {
		const usageRes = await fetch('/api/chat/usage');
		if (usageRes.ok) {
			const data = await usageRes.json();
			spendProviders = Array.isArray(data.providers) ? data.providers : [];
		}
	} catch (e) {
		console.error('Settings: /api/chat/usage load failed', e);
	}

	return {
		...clientSafeConfig,
		killSwitch: await readKillSwitchStateSafe(),
		services,
		spendProviders
	};
};
