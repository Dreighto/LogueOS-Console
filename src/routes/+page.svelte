<script lang="ts">
	import RunCard from '$lib/components/RunCard.svelte';
	import RunCardSkeleton from '$lib/components/RunCardSkeleton.svelte';
	import MemoryFeed from '$lib/components/MemoryFeed.svelte';
	import type { Run, RunsResponse } from '$lib/types/run';
	import type { ProvisionalLesson } from '$lib/types/memory';
	import { resolve } from '$app/paths';
	import { AlertCircle, RefreshCcw, Brain } from 'lucide-svelte';
	import type { PageData } from './$types';

	// CodeRabbit Critical fix: client-side display config (poll interval,
	// feed limit) is supplied via +page.server.ts load() instead of
	// importing $lib/config — which used $env/dynamic/private and broke
	// SvelteKit's server-only-module rule.
	let { data }: { data: PageData } = $props();

	let runs = $state<Run[]>([]);
	let lessons = $state<ProvisionalLesson[]>([]);
	let loading = $state(true);
	let errorMsg = $state<string | null>(null);

	async function fetchDashboard() {
		try {
			// Use resolve() so the URL respects kit.paths.base. Without it,
			// the bare '/api/runs' resolves to the SITE root not the app's
			// base — when served behind Tailscale at /console, that request
			// goes to n8n at root and returns HTML, breaking JSON.parse.
			const [runsResp, memoryResp] = await Promise.all([
				fetch(resolve('/api/runs')),
				fetch(resolve('/api/memory'))
			]);

			if (!runsResp.ok) {
				const errData = await runsResp.json();
				throw new Error(errData.error || `Runs HTTP ${runsResp.status}`);
			}
			const runsData: RunsResponse = await runsResp.json();
			runs = runsData.runs;

			if (memoryResp.ok) {
				const memoryData = await memoryResp.json();
				lessons = memoryData.lessons;
			}

			errorMsg = null;
		} catch (e: unknown) {
			// CodeRabbit Major: catch (e: any) violates strict TS. Use unknown + narrow.
			errorMsg = e instanceof Error ? e.message : 'Unknown error';
			console.error('Dashboard fetch error:', e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		fetchDashboard();
		const interval = setInterval(() => {
			if (document.visibilityState === 'visible') {
				fetchDashboard();
			}
		}, data.pollIntervalMs);

		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				fetchDashboard();
			}
		};
		document.addEventListener('visibilitychange', onVisibilityChange);

		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	});
</script>

<div class="grid grid-cols-1 gap-8 lg:grid-cols-12">
	<!-- Main Feed: Recent Runs -->
	<div class="lg:col-span-8 flex flex-col gap-4">
		<div class="flex items-center justify-between">
			<h2 class="font-sans text-xl font-bold tracking-tight">Recent Runs</h2>
			<button
				onclick={fetchDashboard}
				class="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
			>
				<RefreshCcw size={12} class={loading && runs.length > 0 ? 'animate-spin' : ''} />
				Sync
			</button>
		</div>

		{#if errorMsg}
			<div
				class="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400"
			>
				<AlertCircle size={18} class="shrink-0" />
				<div class="flex flex-col">
					<span class="font-bold">Fetch Error</span>
					<span class="font-mono text-xs opacity-80">{errorMsg}</span>
				</div>
			</div>
		{/if}

		<div class="flex flex-col gap-3">
			{#if loading && runs.length === 0}
				<RunCardSkeleton />
				<RunCardSkeleton />
				<RunCardSkeleton />
			{:else if runs.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center"
				>
					<p class="font-sans text-lg font-semibold text-muted-foreground">No runs yet</p>
					<p class="mt-1 font-mono text-xs text-dim">Dispatch a worker to see it appear here.</p>
				</div>
			{:else}
				{#each runs as run, i (`${run.trace_id ?? ''}|${run.timestamp}|${run.ticket_id ?? ''}|${i}`)}
					<RunCard {run} />
				{/each}
			{/if}
		</div>
	</div>

	<!-- Sidebar: Team Memory -->
	<div class="lg:col-span-4 flex flex-col gap-4">
		<div class="flex items-center gap-2">
			<Brain size={20} class="text-blue-400" />
			<h2 class="font-sans text-xl font-bold tracking-tight">Team Memory</h2>
		</div>

		<div class="sticky top-24">
			<MemoryFeed {lessons} />
		</div>
	</div>
</div>
