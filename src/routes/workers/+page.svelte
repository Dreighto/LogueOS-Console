<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import WorkerCard from '$lib/components/WorkerCard.svelte';
	import type { WorkerStatus } from '$lib/types/worker';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	let workers = $state<WorkerStatus[]>(data.workers);

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
</script>

<div class="flex flex-col gap-6">
	<header class="flex items-center justify-between">
		<div>
			<h1 class="font-sans text-2xl font-bold text-[#F0F6FC]">Workers</h1>
			<p class="mt-1 text-sm text-[#8B949E]">
				Live status and control for LogueOS dispatch workers.
			</p>
		</div>
		<div class="flex items-center gap-2 rounded-full bg-[#161B22] px-3 py-1 border border-[#30363D]">
			<div class="h-2 w-2 animate-pulse rounded-full bg-[#3FB950]"></div>
			<span class="text-[11px] font-medium text-[#8B949E] uppercase tracking-wider">Live</span>
		</div>
	</header>

	<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
		{#each workers as worker (worker.id)}
			<WorkerCard {worker} />
		{:else}
			<div class="col-span-full flex h-32 items-center justify-center rounded-lg border border-dashed border-[#30363D] text-[#8B949E]">
				No workers detected in log.
			</div>
		{/each}
	</div>

	<section class="mt-4 rounded-lg border border-[#30363D] bg-[#161B22] p-4">
		<h2 class="text-sm font-semibold text-[#F0F6FC]">Operational Notes</h2>
		<ul class="mt-2 list-inside list-disc space-y-1 text-xs text-[#8B949E]">
			<li>Worker status is derived from <code>dispatch_listener_stdout.log</code> events.</li>
			<li>Busy state indicates a worker is currently executing a task (spawned but not yet exited).</li>
			<li>Kill and Restart actions are placeholders for Phase 2 and will be enabled in Phase 5.</li>
		</ul>
	</section>
</div>
