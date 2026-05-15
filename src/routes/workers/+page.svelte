<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import WorkerCard from '$lib/components/WorkerCard.svelte';
	import type { WorkerStatus } from '$lib/types/worker';
	import { AlertCircle } from 'lucide-svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	function getInitial() { return data.workers; }
	let workers = $state<WorkerStatus[]>(getInitial());

	$effect(() => {
		workers = data.workers;
	});

	async function refreshWorkers() {
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
			}
		} catch (error) {
			console.error('Failed to refresh workers:', error);
		}
	}

	onMount(() => {
		const interval = setInterval(refreshWorkers, data.config.pollIntervalMs);
		return () => clearInterval(interval);
	});

	// Detection for "Operational notes only shown when there is an actual issue"
	let hasIssues = $derived(
		data.errorMsg || workers.some(w => w.last_exit_status && !['CONFIRMED_WORKING', 'INCONCLUSIVE'].includes(w.last_exit_status))
	);
</script>

<div class="flex flex-col gap-6">
	<header class="flex items-center justify-between">
		<div>
			<h1 class="font-sans text-2xl font-bold text-[#F0F6FC]">Team</h1>
			<p class="mt-1 text-sm text-[#8B949E]">
				Live status and control for LogueOS dispatch workers.
			</p>
		</div>
		<div class="flex items-center gap-2 rounded-full bg-[#161B22] px-3 py-1 border border-[#30363D]">
			<div class="h-1.5 w-1.5 animate-pulse rounded-full bg-[#3FB950]"></div>
			<span class="text-[10px] font-bold text-[#8B949E] uppercase tracking-widest">Live</span>
		</div>
	</header>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
		{#each workers as worker (worker.id)}
			<WorkerCard {worker} />
		{:else}
			<div class="col-span-full flex h-32 items-center justify-center rounded-lg border border-dashed border-[#30363D] text-[#8B949E] font-mono text-xs">
				NO ACTIVE WORKERS DETECTED
			</div>
		{/each}
	</div>

	{#if hasIssues}
		<section class="mt-4 rounded-lg border border-red-900/20 bg-red-900/5 p-4">
			<h2 class="text-xs font-bold text-red-400 uppercase tracking-widest flex items-center gap-2">
				<AlertCircle size={14} />
				Operational Notes
			</h2>
			<ul class="mt-3 list-inside list-disc space-y-2 text-xs text-red-400/80 font-mono">
				{#if data.errorMsg}
					<li>SYSTEM: {data.errorMsg}</li>
				{/if}
				{#each workers.filter(w => w.last_exit_status && !['CONFIRMED_WORKING', 'INCONCLUSIVE'].includes(w.last_exit_status)) as w}
					<li>WORKER {w.id}: Last session ended with {w.last_exit_status}</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
