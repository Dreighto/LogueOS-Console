<script lang="ts">
	import type { Run } from '$lib/types/run';
	import RunCard from '$lib/components/RunCard.svelte';
	import { ChevronRight, ChevronDown } from 'lucide-svelte';

	interface Props {
		title: string;
		runs: Run[];
		defaultOpen?: boolean;
		color?: string;
	}

	let { title, runs, defaultOpen = true, color = 'text-slate-300' }: Props = $props();
	let isOpen = $state(defaultOpen);

	function toggle() {
		isOpen = !isOpen;
	}
</script>

<div class="flex flex-col overflow-hidden rounded-lg border border-[#21262D] bg-surface/5">
	<button
		class="flex items-center justify-between bg-[#161B22] px-3 py-2 text-left transition-colors hover:bg-[#1C2128]"
		onclick={toggle}
		aria-expanded={isOpen}
	>
		<div class="flex items-center gap-2">
			{#if isOpen}
				<ChevronDown size={14} class="text-[#8A8A9A]" />
			{:else}
				<ChevronRight size={14} class="text-[#8A8A9A]" />
			{/if}
			<span class="font-mono text-xs font-bold tracking-wider uppercase {color}">
				{title}
			</span>
			<span class="rounded bg-[#21262D] px-1.5 py-0.5 font-mono text-[10px] text-[#8A8A9A]">
				{runs.length}
			</span>
		</div>
	</button>

	{#if isOpen}
		<div class="flex flex-col gap-2 bg-[#050505] p-2">
			{#each runs as run, i (`${run.trace_id ?? ''}|${run.timestamp}|${run.ticket_id ?? ''}|${i}`)}
				<RunCard {run} />
			{/each}
		</div>
	{/if}
</div>
