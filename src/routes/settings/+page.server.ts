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
import { getPendingDeadSubs, getSubscriptionCount } from '$lib/server/web_push';

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

	type VoiceStatus = {
		chars_used: number;
		char_cap: number;
		minutes_used: number;
		minute_cap: number;
	};
	let voiceStatus: VoiceStatus | null = null;
	try {
		const voiceRes = await fetch('/api/chat/speak/status');
		if (voiceRes.ok) {
			voiceStatus = await voiceRes.json();
		}
	} catch (e) {
		console.error('Settings: /api/chat/speak/status load failed', e);
	}

	// Web Push status (PR 6). Dead subs surface as a re-subscribe banner.
	let pushDeadSubs: Array<{ device_id: string; endpoint: string; detected_at: string }> = [];
	let pushSubCount = 0;
	try {
		pushDeadSubs = getPendingDeadSubs();
		pushSubCount = getSubscriptionCount();
	} catch (e) {
		console.error('Settings: push status load failed', e);
	}

	return {
		...clientSafeConfig,
		killSwitch: await readKillSwitchStateSafe(),
		services,
		spendProviders,
		voiceStatus,
		pushDeadSubs,
		pushSubCount
	};
};
