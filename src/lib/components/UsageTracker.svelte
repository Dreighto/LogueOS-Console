<script lang="ts">
	import { Coins, Zap, Hash, BarChart3 } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import type { UsageMetrics } from '../../routes/api/usage/+server';

	let { metrics }: { metrics: UsageMetrics } = $props();

	function formatTokens(n: number) {
		if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
		if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
		return n.toString();
	}
</script>

<a href={resolve('/usage')} class="block no-underline hover:no-underline">
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
			<div class="flex items-center gap-1.5 text-dim uppercase tracking-widest text-[9px] font-bold">
				<Coins size={10} class="text-amber-400" />
				Est. 24h Burn
			</div>
			<div class="text-lg font-bold tabular-nums text-foreground">
				${metrics.totalPredictedCost.toFixed(2)}
			</div>
		</div>
		<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
			<div class="flex items-center gap-1.5 text-dim uppercase tracking-widest text-[9px] font-bold">
				<Zap size={10} class="text-blue-400" />
				Tokens
			</div>
			<div class="text-lg font-bold tabular-nums text-foreground">
				{formatTokens(metrics.totalPredictedTokens)}
			</div>
		</div>
		<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
			<div class="flex items-center gap-1.5 text-dim uppercase tracking-widest text-[9px] font-bold">
				<Hash size={10} class="text-emerald-400" />
				Dispatches
			</div>
			<div class="text-lg font-bold tabular-nums text-foreground">
				{metrics.recentDispatches}
			</div>
		</div>
		<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
			<div class="flex items-center gap-1.5 text-dim uppercase tracking-widest text-[9px] font-bold">
				<BarChart3 size={10} class="text-purple-400" />
				Avg/Ticket
			</div>
			<div class="text-lg font-bold tabular-nums text-foreground">
				${metrics.recentDispatches > 0 ? (metrics.totalPredictedCost / metrics.recentDispatches).toFixed(2) : '0.00'}
			</div>
		</div>
	</div>
	{#if Object.keys(metrics.workerBreakdown).length > 0}
		<div class="mt-2 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
			{#each Object.entries(metrics.workerBreakdown) as [worker, data]}
				<div class="flex shrink-0 items-center gap-2 rounded border border-border/50 bg-background/50 px-2 py-1">
					<span class="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{worker}</span>
					<span class="text-[10px] font-mono font-medium text-foreground">${data.cost.toFixed(2)}</span>
				</div>
			{/each}
		</div>
	{/if}
	<div class="mt-1 text-right">
		<span class="text-[9px] text-dim tracking-wider font-mono">View details →</span>
	</div>
</a>

<style>
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.no-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>
