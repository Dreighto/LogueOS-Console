// Server-side load for Settings. Reads kill-switch state via the shared
// helper so SSR renders the correct ACTIVE/CLEAR state on first paint.
// pollIntervalMs flows through clientSafeConfig so the page can refresh.

import type { PageServerLoad } from './$types';
import { clientSafeConfig } from '$lib/server/config';
import { readKillSwitchStateSafe } from '$lib/server/kill-switch';

export const load: PageServerLoad = async () => ({
	...clientSafeConfig,
	killSwitch: await readKillSwitchStateSafe()
});
