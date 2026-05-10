<script lang="ts">
	import RunDetail from '$lib/components/RunDetail.svelte';
	import { AlertCircle, ChevronLeft, Search } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	// CodeRabbit Major fix: server-side load via +page.server.ts means there
	// is no client-side reactive fetch to mis-track in $effect. Direct URL
	// nav (operator pasting /runs/<trace_id>) renders the data on first
	// paint instead of showing a loading spinner. Spec-aligned for LOS-3.
	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.run ? `Run ${data.run.trace_id || data.run.timestamp}` : 'Run not found'} | LogueOS Console</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-4">
		<a
			href={resolve('/')}
			class="flex items-center gap-1 font-sans text-sm text-[#8A8A9A] transition-colors hover:text-[#F0F0F0]"
		>
			<ChevronLeft size={16} />
			Back to Runs
		</a>
	</div>

	{#if data.errorMsg}
		<div
			class="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400"
		>
			<AlertCircle size={18} class="shrink-0" />
			<div class="flex flex-col">
				<span class="font-bold">Fetch Error</span>
				<span class="font-mono text-xs opacity-80">{data.errorMsg}</span>
			</div>
		</div>
	{:else if data.notFoundTraceId}
		<div
			class="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#21262D] p-12 text-center"
		>
			<Search size={32} class="mb-3 text-[#6B7280]" />
			<p class="font-sans text-lg font-semibold text-[#8A8A9A]">Run not found</p>
			<p class="mt-1 font-mono text-xs text-[#6B7280]">
				No run with trace_id <code class="rounded bg-[#0D1117] px-1.5 py-0.5">{data.notFoundTraceId}</code> in the completion log.
				The run may have happened before the log started, or the URL may have a typo.
			</p>
			<a
				href={resolve('/')}
				class="mt-6 inline-flex items-center gap-1 rounded-md bg-[#A3E635] px-3 py-1.5 text-xs font-semibold text-[#0D1117] transition-all hover:shadow-[0_0_12px_rgba(163,230,53,0.4)]"
			>
				<ChevronLeft size={12} />
				Back to Runs
			</a>
		</div>
	{:else if data.run}
		<RunDetail run={data.run} />
	{/if}
</div>
