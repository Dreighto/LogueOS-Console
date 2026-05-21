<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import WorkerCard from '$lib/components/WorkerCard.svelte';
	import type { WorkerStatus } from '$lib/types/worker';
	import { workerLabel } from '$lib/config/workers';
	import { AlertCircle } from 'lucide-svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	function getInitial() {
		return data.workers;
	}
	let workers = $state<WorkerStatus[]>(getInitial());
	let refreshError = $state<string | null>(null);

	$effect(() => {
		workers = data.workers;
	});

	async function refreshWorkers() {
		// Background poll — refresh silently. The worker cards update in place
		// and the header "Live" dot is the ambient freshness signal; a per-poll
		// banner just flickers and shifts the layout every few seconds.
		refreshError = null;
		try {
			// resolve() honors kit.paths.base ('/console'). Bare fetch('/api/workers')
			// hits the SITE root (n8n on the operator's tailscale serve) and gets
			// back HTML 404, which the JSON parser then chokes on with "Unexpected
			// token '<'". Same base-path-bug pattern as the server-side load fix
			// shipped earlier today (see canon adopted-lessons.md).
			const response = await fetch(resolve('/api/workers'));
			if (response.ok) {
				const result = await response.json();
				workers = result.workers;
			} else {
				refreshError = `Status ${response.status}`;
			}
		} catch (error) {
			refreshError = error instanceof Error ? error.message : 'Refresh failed';
		}
	}

	onMount(() => {
		const interval = setInterval(refreshWorkers, data.config.pollIntervalMs);
		return () => clearInterval(interval);
	});

	// Detection for "Operational notes only shown when there is an actual issue"
	let hasIssues = $derived(
		data.errorMsg ||
			workers.some(
				(w) =>
					w.last_exit_status && !['CONFIRMED_WORKING', 'INCONCLUSIVE'].includes(w.last_exit_status)
			)
	);
</script>

<div class="flex flex-col gap-6">
	<header class="flex items-center justify-between">
		<div>
			<h1 class="font-mono text-lg leading-none font-bold tracking-tight text-[#F0F6FC]">Team</h1>
			<p class="mt-1 text-sm text-[#8B949E]">
				Live status and control for LogueOS dispatch workers.
			</p>
		</div>
		<div
			class="flex items-center gap-2 rounded-full border border-[#30363D] bg-[#161B22] px-3 py-1"
		>
			<div class="h-1.5 w-1.5 animate-pulse rounded-full bg-[#3FB950]"></div>
			<span class="text-[10px] font-bold tracking-widest text-[#8B949E] uppercase">Live</span>
		</div>
	</header>

	{#if refreshError}
		<div
			class="rounded border border-red-900/30 bg-red-900/10 px-3 py-2 font-mono text-[10px] text-red-400"
		>
			Refresh error: {refreshError}
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-4">
		{#each workers as worker (worker.id)}
			<WorkerCard {worker} />
		{:else}
			<div
				class="col-span-full flex h-32 items-center justify-center rounded-lg border border-dashed border-[#30363D] text-[#8B949E] font-mono text-xs"
			>
				NO ACTIVE WORKERS DETECTED
			</div>
		{/each}
	</div>

	{#if hasIssues}
		<section class="mt-4 rounded-lg border border-red-900/20 bg-red-900/5 p-4">
			<h2 class="flex items-center gap-2 text-xs font-bold tracking-widest text-red-400 uppercase">
				<AlertCircle size={14} />
				Operational Notes
			</h2>
			<ul class="mt-3 list-inside list-disc space-y-2 font-mono text-xs text-red-400/80">
				{#if data.errorMsg}
					<li>SYSTEM: {data.errorMsg}</li>
				{/if}
				{#each workers.filter((w) => w.last_exit_status && !['CONFIRMED_WORKING', 'INCONCLUSIVE'].includes(w.last_exit_status)) as w (w.id)}
					<li>WORKER {workerLabel(w.id)}: Last session ended with {w.last_exit_status}</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
