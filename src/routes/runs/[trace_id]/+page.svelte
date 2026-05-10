<script lang="ts">
	import { page } from '$app/state';
	import RunDetail from '$lib/components/RunDetail.svelte';
	import type { Run } from '$lib/types/run';
	import { AlertCircle, ChevronLeft } from 'lucide-svelte';

	let run = $state<Run | null>(null);
	let loading = $state(true);
	let errorMsg = $state<string | null>(null);

	const trace_id = $derived(page.params.trace_id);

	async function fetchRunDetail() {
		if (!trace_id) return;
		loading = true;
		errorMsg = null;
		try {
			const resp = await fetch(`/api/runs/${trace_id}`);
			if (!resp.ok) {
				const errData = await resp.json();
				throw new Error(errData.error || `HTTP ${resp.status}`);
			}
			const data = await resp.json();
			run = data.run;
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : 'Unknown error';
			console.error('Run detail fetch error:', e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		fetchRunDetail();
	});
</script>

<svelte:head>
	<title>Run Details | {trace_id}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-4">
		<a
			href="/"
			class="flex items-center gap-1 text-sm text-[#8A8A9A] hover:text-[#F0F0F0] transition-colors font-sans"
		>
			<ChevronLeft size={16} />
			Back to Runs
		</a>
	</div>

	{#if loading}
		<div class="animate-pulse flex flex-col gap-6">
			<div class="h-64 bg-[#161B22] rounded-lg border border-[#21262D]"></div>
		</div>
	{:else if errorMsg}
		<div
			class="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400"
		>
			<AlertCircle size={18} class="shrink-0" />
			<div class="flex flex-col">
				<span class="font-bold">Fetch Error</span>
				<span class="font-mono text-xs opacity-80">{errorMsg}</span>
			</div>
		</div>
	{:else if run}
		<RunDetail {run} />
	{:else}
		<div class="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#21262D] p-12 text-center">
			<p class="font-sans text-lg font-semibold text-[#8A8A9A]">Run not found</p>
			<p class="mt-1 font-mono text-xs text-[#6B7280]">The trace ID {trace_id} does not exist in the logs.</p>
		</div>
	{/if}
</div>
