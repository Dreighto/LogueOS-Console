<script lang="ts">
	import RunCard from '$lib/components/RunCard.svelte';
	import RunCardSkeleton from '$lib/components/RunCardSkeleton.svelte';
	import type { Run, RunsResponse } from '$lib/types/run';
	import { config } from '$lib/config';
	import { AlertCircle, RefreshCcw } from 'lucide-svelte';

	let runs = $state<Run[]>([]);
	let loading = $state(true);
	let errorMsg = $state<string | null>(null);

	async function fetchRuns() {
		try {
			const resp = await fetch('/api/runs');
			if (!resp.ok) {
				const data = await resp.json();
				throw new Error(data.error || `HTTP ${resp.status}`);
			}
			const data: RunsResponse = await resp.json();
			runs = data.runs;
			errorMsg = null;
		} catch (e: any) {
			errorMsg = e.message;
			console.error('Runs fetch error:', e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		fetchRuns();
		const interval = setInterval(() => {
			if (document.visibilityState === 'visible') {
				fetchRuns();
			}
		}, config.pollIntervalMs);

		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				fetchRuns();
			}
		};
		document.addEventListener('visibilitychange', onVisibilityChange);

		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	});
</script>

<div class="flex flex-col gap-4">
	<div class="flex items-center justify-between">
		<h2 class="font-sans text-xl font-bold tracking-tight">Recent Runs</h2>
		<button
			onclick={fetchRuns}
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
			<div class="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center">
				<p class="font-sans text-lg font-semibold text-muted-foreground">No runs yet</p>
				<p class="mt-1 font-mono text-xs text-dim">Dispatch a worker to see it appear here.</p>
			</div>
		{:else}
			{#each runs as run (run.trace_id || run.timestamp)}
				<RunCard {run} />
			{/each}
		{/if}
	</div>
</div>
