<script lang="ts">
	import SessionSwitcher from '$lib/components/SessionSwitcher.svelte';
	import { Terminal } from 'lucide-svelte';
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import XTerm from '$lib/components/XTerm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Per-session PWA manifest so iOS "Add to Home Screen" lands on the right
	// terminal session instead of /console (the root manifest's start_url).
	const manifestHref = $derived(
		data.session === 'cc-con'
			? `${base}/manifest-cc.webmanifest`
			: data.session === 'gmi-con'
				? `${base}/manifest-gmi.webmanifest`
				: `${base}/manifest.webmanifest`
	);
	const appTitle = $derived(data.session === 'cc-con' ? 'cc-con' : 'gmi-con');

	// Convert the ttyd HTTP URL (data.ttydUrl, e.g.
	// https://room.taila28611.ts.net:18768/cc/) into the corresponding
	// WebSocket URL on the same origin/path. wss:// for HTTPS pages, ws://
	// for HTTP. xterm.js speaks ttyd's protocol directly — no iframe,
	// keyboard works on iOS.
	const wsUrl = $derived.by(() => {
		try {
			const u = new URL(data.ttydUrl);
			u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
			// Drop trailing slash to land at /<session>, ttyd accepts /ws appended.
			u.pathname = u.pathname.replace(/\/$/, '') + '/ws';
			return u.toString();
		} catch {
			return '';
		}
	});
</script>

<svelte:head>
	<link rel="manifest" href={manifestHref} />
	<meta name="apple-mobile-web-app-title" content={appTitle} />
	<title>{appTitle} — LogueOS</title>
</svelte:head>

<!-- Terminal page is full-bleed — the layout already drops padding and hides
     header/nav on /terminal routes, so we just need to fill 100% height here. -->
<div class="flex h-full flex-col">
	<SessionSwitcher />
	<!-- Session label strip -->
	<div
		class="flex shrink-0 items-center gap-1.5 border-b border-border bg-surface px-3 py-1.5 font-mono text-xs"
	>
		<Terminal size={12} class="shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="text-muted-foreground">terminal /</span>
		<span class="font-semibold text-foreground">{data.session}</span>
	</div>

	<!-- Native xterm.js mounted directly — connects to ttyd's WS via the
	     Console's HTTPS proxy on the same origin. Browser-only (xterm.js
	     touches `document` at module load, so SSR would crash). -->
	<div class="min-h-0 flex-1">
		{#if !browser}
			<div class="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
				loading terminal...
			</div>
		{:else if wsUrl}
			<XTerm {wsUrl} />
		{:else}
			<div class="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
				terminal endpoint not configured
			</div>
		{/if}
	</div>
</div>
