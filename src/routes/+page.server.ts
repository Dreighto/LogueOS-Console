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

export const load: PageServerLoad = () => ({
	// Spread the client-safe subset (pollIntervalMs, feedLimit). Do
	// NOT include completionLogPath — that stays server-only.
	...clientSafeConfig
});
