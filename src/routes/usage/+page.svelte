<script lang="ts">
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import type { DailyUsage, HourlyBucket, TicketCost } from '$lib/types/usage';
	import {
		getDispatchWorkers,
		resolveWorker,
		workerColor,
		workerShortLabel
	} from '$lib/config/workers';

	let { data }: { data: PageData } = $props();

	// Registry-driven worker roster — every per-worker card, bar, sparkline and
	// table column below is generated from this list. Add/swap a worker in
	// workers.json and this page adapts with no code change.
	const workers = getDispatchWorkers();

	function workerCost(day: DailyUsage, worker: string): number {
		return day.workers.find((w) => w.worker === worker)?.cost ?? 0;
	}
	function workerTokens(day: DailyUsage, worker: string): number {
		return day.workers.find((w) => w.worker === worker)?.tokens ?? 0;
	}
	function workerDispatches(day: DailyUsage, worker: string): number {
		return day.workers.find((w) => w.worker === worker)?.dispatches ?? 0;
	}

	let maxDailyCost = $derived(
		data.history.days.reduce((m: number, d: DailyUsage) => Math.max(m, d.totalCost), 0)
	);

	function barHeight(cost: number, maxCost: number): number {
		if (maxCost === 0) return 1;
		return Math.max(1, Math.round((cost / maxCost) * 48));
	}

	function projColor(cost: number): string {
		if (cost < 50) return 'text-status-green';
		if (cost < 80) return 'text-status-amber';
		return 'text-status-red';
	}

	function fmtDate(dateStr: string): string {
		const d = new Date(dateStr + 'T00:00:00');
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function fmtTokens(n: number): string {
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
		if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
		return String(n);
	}

	// --- Worker sparklines (SVG polyline over selected period) ---
	type SparkPoint = { date: string; cost: number };

	function buildSparkline(worker: string): SparkPoint[] {
		return [...data.history.days]
			.reverse()
			.map((d) => ({ date: d.date, cost: workerCost(d, worker) }));
	}

	function sparklinePath(points: SparkPoint[], w = 72, h = 20): string {
		if (points.length < 2) return '';
		const maxV = Math.max(...points.map((p) => p.cost), 0.001);
		const coords = points.map((p, i) => {
			const x = (i / (points.length - 1)) * w;
			const y = h - Math.max(1, (p.cost / maxV) * h);
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});
		return coords.join(' ');
	}

	// Total tokens for a worker across the selected period.
	function workerTokenTotal(workerId: string): number {
		let sum = 0;
		for (const day of data.history.days) sum += workerTokens(day, workerId);
		return sum;
	}

	// Tooltip for a daily-cost bar group — one segment per worker.
	function dayTooltip(day: DailyUsage): string {
		const parts = workers.map((w) => `${w.shortLabel} $${workerCost(day, w.id).toFixed(3)}`);
		return `${fmtDate(day.date)}: ${parts.join(' ')}`;
	}

	// --- Heatmap helpers ---
	// Group hourly buckets by date for the heatmap grid
	let heatmapDates = $derived(
		[...new Set(data.hourlyActivity.map((b: HourlyBucket) => b.date))].sort()
	);

	let heatmapByDateHour = $derived(() => {
		const map = new Map<string, Map<number, HourlyBucket>>();
		for (const b of data.hourlyActivity) {
			if (!map.has(b.date)) map.set(b.date, new Map());
			map.get(b.date)!.set(b.hour, b);
		}
		return map;
	});

	let heatmapMax = $derived(
		Math.max(1, ...data.hourlyActivity.map((b: HourlyBucket) => b.dispatches))
	);

	function heatCell(date: string, hour: number): HourlyBucket | undefined {
		return heatmapByDateHour().get(date)?.get(hour);
	}

	function heatOpacity(dispatches: number): string {
		const ratio = dispatches / heatmapMax;
		if (ratio === 0) return '0.06';
		if (ratio < 0.25) return '0.25';
		if (ratio < 0.5) return '0.5';
		if (ratio < 0.75) return '0.75';
		return '1';
	}

	// Hours displayed (0-23 split into blocks for compact rendering)
	const HOURS = Array.from({ length: 24 }, (_, i) => i);

	// --- Ticket leaderboard ---
	// Group by ticket_id, summing across workers. Worker names are normalized to
	// registry ids so variants (claude-code / claude-code-1) collapse into one.
	let leaderboard = $derived(() => {
		const map = new Map<
			string,
			{ cost: number; tokens: number; dispatches: number; workers: string[] }
		>();
		for (const row of data.ticketLeaderboard as TicketCost[]) {
			const workerId = resolveWorker(row.worker)?.id ?? row.worker;
			const existing = map.get(row.ticket_id);
			if (existing) {
				existing.cost = Math.round((existing.cost + row.cost) * 10000) / 10000;
				existing.tokens += row.tokens;
				existing.dispatches += row.dispatches;
				if (!existing.workers.includes(workerId)) existing.workers.push(workerId);
			} else {
				map.set(row.ticket_id, {
					cost: row.cost,
					tokens: row.tokens,
					dispatches: row.dispatches,
					workers: [workerId]
				});
			}
		}
		return [...map.entries()]
			.map(([ticket_id, v]) => ({ ticket_id, ...v }))
			.sort((a, b) => b.cost - a.cost)
			.slice(0, 10);
	});
</script>

<svelte:head>
	<title>API Usage | LogueOS Console</title>
</svelte:head>

<div class="flex flex-col gap-4">
	<PageHeader
		title="API Usage"
		subtitle="Spend and dispatch volume across the team."
	>
		<div class="flex items-center gap-1 rounded border border-border bg-surface/30 p-0.5">
			<button
				class="min-h-[44px] rounded px-2 py-0.5 font-mono text-xs tracking-wider uppercase transition-colors {data.days ===
				7
					? 'bg-cta text-background'
					: 'text-muted-foreground'}"
				onclick={() => goto(resolve('/usage') + '?days=7')}>7d</button
			>
			<button
				class="min-h-[44px] rounded px-2 py-0.5 font-mono text-xs tracking-wider uppercase transition-colors {data.days ===
				30
					? 'bg-cta text-background'
					: 'text-muted-foreground'}"
				onclick={() => goto(resolve('/usage') + '?days=30')}>30d</button
			>
		</div>
	</PageHeader>

	<!-- Cost summary cards -->
	<div class="grid grid-cols-2 gap-2">
		<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
			<div class="text-muted-foreground text-xs font-bold tracking-widest uppercase">MTD Cost</div>
			<div class="text-base font-bold text-foreground tabular-nums">
				${data.history.projection.monthToDate.toFixed(2)}
			</div>
		</div>
		<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
			<div class="text-muted-foreground text-xs font-bold tracking-widest uppercase">Proj. EOMonth</div>
			<div
				class="text-base font-bold tabular-nums {projColor(data.history.projection.projectedEOM)}"
			>
				${data.history.projection.projectedEOM.toFixed(2)}
			</div>
		</div>
	</div>

	<!-- Per-worker sparkline cards — one per worker in the registry -->
	<div class="grid grid-cols-2 gap-2">
		{#each workers as w (w.id)}
			{@const spark = buildSparkline(w.id)}
			<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
				<div
					class="text-muted-foreground flex items-center gap-1.5 text-xs font-bold tracking-widest uppercase"
				>
					<span class="h-1.5 w-1.5 rounded-full" style="background-color: {w.color}"></span>
					{w.shortLabel}
				</div>
				<div class="flex items-end justify-between gap-2">
					<div>
						<div class="text-sm font-bold text-foreground tabular-nums">
							${(data.history.projection.byWorker[w.id] ?? 0).toFixed(2)}
						</div>
						<div class="text-muted-foreground text-xs tabular-nums">
							{fmtTokens(workerTokenTotal(w.id))} tok
						</div>
					</div>
					{#if spark.length >= 2}
						<svg width="72" height="20" class="shrink-0 opacity-70">
							<polyline
								points={sparklinePath(spark)}
								fill="none"
								stroke={w.color}
								stroke-width="1.5"
								stroke-linejoin="round"
								stroke-linecap="round"
							/>
						</svg>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<!-- Daily cost chart (stacked bars) -->
	{#if data.history.days.length > 0}
		<div class="rounded-lg border border-border bg-surface/30 p-3">
			<div class="text-muted-foreground mb-2 text-xs font-bold tracking-widest uppercase">Daily Cost</div>
			<div class="no-scrollbar flex items-end gap-1 overflow-x-auto pb-2" style="height: 64px;">
				{#each [...data.history.days].reverse() as day (day.date)}
					<div class="flex shrink-0 flex-col items-center gap-0.5" title={dayTooltip(day)}>
						<div class="flex items-end gap-px">
							{#each workers as w (w.id)}
								<div
									class="w-2 rounded-t opacity-80"
									style="background-color: {w.color}; height: {barHeight(
										workerCost(day, w.id),
										maxDailyCost
									)}px;"
								></div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
			<div class="mt-1 flex flex-wrap gap-3">
				{#each workers as w (w.id)}
					<div class="flex items-center gap-1">
						<span class="h-2 w-2 rounded opacity-80" style="background-color: {w.color}"></span>
						<span class="text-muted-foreground font-mono text-xs">{w.shortLabel}</span>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<div class="rounded-lg border border-dashed border-border p-6 text-center">
			<p class="text-muted-foreground font-mono text-xs">No usage data in this period</p>
		</div>
	{/if}

	<!-- Hourly activity heatmap -->
	{#if data.hourlyActivity.length > 0}
		<div class="rounded-lg border border-border bg-surface/30 p-3">
			<div class="text-muted-foreground mb-2 text-xs font-bold tracking-widest uppercase">
				Hourly Activity (UTC)
			</div>
			<div class="no-scrollbar overflow-x-auto">
				<div class="min-w-max">
					<!-- Hour axis labels (every 3h) -->
					<div class="mb-1 flex">
						<div class="w-10 shrink-0"></div>
						{#each HOURS as h (h)}
							<div class="text-muted-foreground w-4 shrink-0 text-center font-mono text-[11px]">
								{h % 6 === 0 ? String(h).padStart(2, '0') : ''}
							</div>
						{/each}
					</div>
					<!-- Rows: one per date, most recent last -->
					{#each heatmapDates as date (date)}
						<div class="mb-0.5 flex items-center">
							<div class="text-muted-foreground w-10 shrink-0 font-mono text-[11px]">{fmtDate(date)}</div>
							{#each HOURS as h (h)}
								{@const cell = heatCell(date, h)}
								<div
									class="h-3.5 w-4 shrink-0 rounded-[1px] bg-cta"
									style="opacity: {cell ? heatOpacity(cell.dispatches) : '0.05'};"
									title={cell
										? `${String(h).padStart(2, '0')}:00 UTC — ${cell.dispatches} dispatches, $${cell.cost.toFixed(3)}`
										: `${String(h).padStart(2, '0')}:00 UTC — idle`}
								></div>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- Ticket leaderboard -->
	{#if leaderboard().length > 0}
		<div class="rounded-lg border border-border bg-surface/30 p-3">
			<div class="text-muted-foreground mb-2 text-xs font-bold tracking-widest uppercase">
				Ticket Leaderboard
			</div>
			<div class="flex flex-col gap-1">
				{#each leaderboard() as ticket, i (ticket.ticket_id)}
					<div
						class="flex items-center gap-2 rounded border border-border/30 bg-surface/20 px-2 py-1.5"
					>
						<span class="text-muted-foreground w-5 shrink-0 font-mono text-xs tabular-nums">#{i + 1}</span>
						<span class="min-w-0 flex-1 truncate font-mono text-xs font-bold text-foreground"
							>{ticket.ticket_id}</span
						>
						<div class="flex shrink-0 gap-1">
							{#each ticket.workers as w (w)}
								<span class="font-mono text-xs" style="color: {workerColor(w)}"
									>{workerShortLabel(w)}</span
								>
							{/each}
						</div>
						<div class="flex shrink-0 flex-col items-end">
							<span class="font-mono text-xs font-bold text-foreground tabular-nums"
								>${ticket.cost.toFixed(2)}</span
							>
							<span class="text-muted-foreground font-mono text-[11px] tabular-nums"
								>{ticket.dispatches}d · {fmtTokens(ticket.tokens)}</span
							>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{:else if data.ticketLeaderboard.length === 0}
		<div class="rounded-lg border border-dashed border-border p-4 text-center">
			<p class="text-muted-foreground font-mono text-xs">No ticket-attributed costs in this period</p>
		</div>
	{/if}

	<!-- Burn rate card -->
	<div class="flex flex-col gap-2 rounded-lg border border-border bg-surface/30 p-3">
		<div class="text-muted-foreground text-xs font-bold tracking-widest uppercase">Burn Rate</div>
		<div class="flex justify-between font-mono text-xs">
			<span class="text-muted-foreground">Daily avg</span>
			<span class="text-foreground tabular-nums"
				>${data.history.projection.dailyAvg.toFixed(3)}/day</span
			>
		</div>
		<div class="flex justify-between font-mono text-xs">
			<span class="text-muted-foreground">Days elapsed</span>
			<span class="text-foreground tabular-nums"
				>{data.history.projection.daysElapsed} / {data.history.projection.daysInMonth}</span
			>
		</div>
		<div class="relative h-2 overflow-hidden rounded-full border border-border/50 bg-surface">
			<div
				class="absolute top-0 left-0 h-full rounded-full bg-foreground/20"
				style="width: {Math.min(
					100,
					(data.history.projection.daysElapsed / data.history.projection.daysInMonth) * 100
				).toFixed(1)}%"
			></div>
		</div>
		<div class="flex justify-between font-mono text-xs">
			<span class="text-muted-foreground">MTD ${data.history.projection.monthToDate.toFixed(2)}</span>
			<span class={projColor(data.history.projection.projectedEOM)}
				>Proj. ${data.history.projection.projectedEOM.toFixed(2)}</span
			>
		</div>
	</div>

	<!-- Daily breakdown table -->
	<div class="rounded-lg border border-border bg-surface/30 p-3">
		<div class="text-muted-foreground mb-2 text-xs font-bold tracking-widest uppercase">Daily Breakdown</div>
		<table class="w-full font-mono text-xs tabular-nums">
			<thead>
				<tr class="text-muted-foreground border-b border-border/50 text-xs tracking-wider uppercase">
					<th class="pb-1 text-left font-bold">Date</th>
					{#each workers as w (w.id)}
						<th class="pb-1 text-right font-bold">{w.shortLabel}</th>
					{/each}
					<th class="pb-1 text-right font-bold">Total</th>
				</tr>
			</thead>
			<tbody>
				{#each data.history.days as day (day.date)}
					<tr class="border-b border-border/20 hover:bg-surface/50">
						<td class="py-1 pr-2 text-foreground">{fmtDate(day.date)}</td>
						{#each workers as w (w.id)}
							{@const cost = workerCost(day, w.id)}
							{@const d = workerDispatches(day, w.id)}
							<td class="py-1 pr-2 text-right" style="color: {w.color}">
								{cost > 0 ? `$${cost.toFixed(3)} (${d})` : '—'}
							</td>
						{/each}
						<td class="py-1 text-right text-foreground">${day.totalCost.toFixed(3)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if data.history.days.length === 0}
			<p class="text-muted-foreground py-4 text-center font-mono text-xs">No data</p>
		{/if}
	</div>

	<p class="text-muted-foreground pb-2 text-center font-mono text-xs">
		{data.history.totalEvents} total dispatch events tracked
	</p>
</div>

<style>
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.no-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>
