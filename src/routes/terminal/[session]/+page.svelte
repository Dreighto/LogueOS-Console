<script lang="ts">
	import { Terminal } from 'lucide-svelte';
	import { base } from '$app/paths';
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
</script>

<svelte:head>
	<link rel="manifest" href={manifestHref} />
	<meta name="apple-mobile-web-app-title" content={appTitle} />
	<title>{appTitle} — LogueOS</title>
</svelte:head>

<!-- Terminal page is full-bleed — the layout already drops padding and hides
     header/nav on /terminal routes, so we just need to fill 100% height here. -->
<div class="flex h-full flex-col">
	<!-- Session label strip -->
	<div
		class="flex shrink-0 items-center gap-1.5 border-b border-border bg-surface px-3 py-1.5 font-mono text-xs"
	>
		<Terminal size={12} class="shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="text-muted-foreground">terminal /</span>
		<span class="font-semibold text-foreground">{data.session}</span>
	</div>

	<!-- ttyd iframe — fills remaining height, no border -->
	<iframe
		src={data.ttydUrl}
		title="{data.session} terminal"
		class="min-h-0 flex-1 border-none"
		style="width: 100%;"
		allow="clipboard-read; clipboard-write"
	></iframe>
</div>
