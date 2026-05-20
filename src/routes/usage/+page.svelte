<script lang="ts">
  import { ChevronLeft } from 'lucide-svelte';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import type { DailyUsage, HourlyBucket, TicketCost } from '$lib/types/usage';

  let { data }: { data: PageData } = $props();

  function workerCost(day: DailyUsage, worker: string): number {
    return day.workers.find(w => w.worker === worker)?.cost ?? 0;
  }
  function workerTokens(day: DailyUsage, worker: string): number {
    return day.workers.find(w => w.worker === worker)?.tokens ?? 0;
  }
  function workerDispatches(day: DailyUsage, worker: string): number {
    return day.workers.find(w => w.worker === worker)?.dispatches ?? 0;
  }

  let maxDailyCost = $derived(
    data.history.days.reduce((m: number, d: DailyUsage) => Math.max(m, d.totalCost), 0)
  );

  function barHeight(cost: number, maxCost: number): number {
    if (maxCost === 0) return 1;
    return Math.max(1, Math.round((cost / maxCost) * 48));
  }

  function projColor(cost: number): string {
    if (cost < 50) return 'text-emerald-400';
    if (cost < 80) return 'text-amber-400';
    return 'text-red-400';
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
      .map(d => ({ date: d.date, cost: workerCost(d, worker) }));
  }

  function sparklinePath(points: SparkPoint[], w = 72, h = 20): string {
    if (points.length < 2) return '';
    const maxV = Math.max(...points.map(p => p.cost), 0.001);
    const coords = points.map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - Math.max(1, (p.cost / maxV) * h);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return coords.join(' ');
  }

  let ccSpark = $derived(buildSparkline('claude-code'));
  let gmiSpark = $derived(buildSparkline('gemini'));

  // --- Token totals from full history ---
  let tokenTotals = $derived(() => {
    let cc = 0, gmi = 0;
    for (const day of data.history.days) {
      cc += workerTokens(day, 'claude-code');
      gmi += workerTokens(day, 'gemini');
    }
    return { cc, gmi, total: cc + gmi };
  });

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
  // Group by ticket_id, summing across workers
  let leaderboard = $derived(() => {
    const map = new Map<string, { cost: number; tokens: number; dispatches: number; workers: string[] }>();
    for (const row of data.ticketLeaderboard as TicketCost[]) {
      const existing = map.get(row.ticket_id);
      if (existing) {
        existing.cost = Math.round((existing.cost + row.cost) * 10000) / 10000;
        existing.tokens += row.tokens;
        existing.dispatches += row.dispatches;
        if (!existing.workers.includes(row.worker)) existing.workers.push(row.worker);
      } else {
        map.set(row.ticket_id, {
          cost: row.cost,
          tokens: row.tokens,
          dispatches: row.dispatches,
          workers: [row.worker]
        });
      }
    }
    return [...map.entries()]
      .map(([ticket_id, v]) => ({ ticket_id, ...v }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);
  });

  function workerPill(worker: string): string {
    return worker === 'claude-code' ? 'text-orange-400' : 'text-blue-400';
  }
  function workerLabel(worker: string): string {
    return worker === 'claude-code' ? 'CC' : 'AGY';
  }
</script>

<svelte:head>
  <title>API Usage | LogueOS Console</title>
</svelte:head>

<div class="flex flex-col gap-4">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <a href={resolve('/')} class="flex items-center gap-1 font-sans text-sm text-[#8A8A9A] transition-colors hover:text-[#F0F0F0]">
      <ChevronLeft size={16} /> Back
    </a>
    <h1 class="font-mono text-sm font-bold tracking-widest text-foreground uppercase">API Usage</h1>
    <div class="flex items-center gap-1 rounded border border-border bg-surface/30 p-0.5">
      <button
        class="min-h-[44px] rounded px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase transition-colors {data.days === 7 ? 'bg-cta text-background' : 'text-muted-foreground'}"
        onclick={() => goto(resolve('/usage') + '?days=7')}
      >7d</button>
      <button
        class="min-h-[44px] rounded px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase transition-colors {data.days === 30 ? 'bg-cta text-background' : 'text-muted-foreground'}"
        onclick={() => goto(resolve('/usage') + '?days=30')}
      >30d</button>
    </div>
  </div>

  <!-- Cost summary cards -->
  <div class="grid grid-cols-2 gap-2">
    <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
      <div class="text-[9px] font-bold tracking-widest text-dim uppercase">MTD Cost</div>
      <div class="text-base font-bold tabular-nums text-foreground">${data.history.projection.monthToDate.toFixed(2)}</div>
    </div>
    <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
      <div class="text-[9px] font-bold tracking-widest text-dim uppercase">Proj. EOMonth</div>
      <div class="text-base font-bold tabular-nums {projColor(data.history.projection.projectedEOM)}">${data.history.projection.projectedEOM.toFixed(2)}</div>
    </div>
  </div>

  <!-- Worker sparklines: CC + AGY side by side -->
  <div class="grid grid-cols-2 gap-2">
    <!-- CC card -->
    <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
      <div class="flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-dim uppercase">
        <span class="h-1.5 w-1.5 rounded-full bg-orange-400"></span> CC
      </div>
      <div class="flex items-end justify-between gap-2">
        <div>
          <div class="text-sm font-bold tabular-nums text-foreground">${data.history.projection.ccMtd.toFixed(2)}</div>
          <div class="text-[9px] text-dim tabular-nums">{fmtTokens(tokenTotals().cc)} tok</div>
        </div>
        {#if ccSpark.length >= 2}
          <svg width="72" height="20" class="shrink-0 opacity-70">
            <polyline
              points={sparklinePath(ccSpark)}
              fill="none"
              stroke="rgb(251,146,60)"
              stroke-width="1.5"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </svg>
        {/if}
      </div>
    </div>
    <!-- AGY card -->
    <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
      <div class="flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-dim uppercase">
        <span class="h-1.5 w-1.5 rounded-full bg-blue-500"></span> AGY
      </div>
      <div class="flex items-end justify-between gap-2">
        <div>
          <div class="text-sm font-bold tabular-nums text-foreground">${data.history.projection.gmiMtd.toFixed(2)}</div>
          <div class="text-[9px] text-dim tabular-nums">{fmtTokens(tokenTotals().gmi)} tok</div>
        </div>
        {#if gmiSpark.length >= 2}
          <svg width="72" height="20" class="shrink-0 opacity-70">
            <polyline
              points={sparklinePath(gmiSpark)}
              fill="none"
              stroke="rgb(59,130,246)"
              stroke-width="1.5"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </svg>
        {/if}
      </div>
    </div>
  </div>

  <!-- Daily cost chart (stacked bars) -->
  {#if data.history.days.length > 0}
    <div class="rounded-lg border border-border bg-surface/30 p-3">
      <div class="mb-2 text-[9px] font-bold tracking-widest text-dim uppercase">Daily Cost</div>
      <div class="flex items-end gap-1 overflow-x-auto pb-2 no-scrollbar" style="height: 64px;">
        {#each [...data.history.days].reverse() as day}
          {@const cc = workerCost(day, 'claude-code')}
          {@const gmi = workerCost(day, 'gemini')}
          <div class="flex shrink-0 flex-col items-center gap-0.5" title="{fmtDate(day.date)}: CC ${cc.toFixed(3)} AGY ${gmi.toFixed(3)}">
            <div class="flex items-end gap-px">
              <div class="w-2 rounded-t bg-orange-400/80" style="height: {barHeight(cc, maxDailyCost)}px;"></div>
              <div class="w-2 rounded-t bg-blue-500/80" style="height: {barHeight(gmi, maxDailyCost)}px;"></div>
            </div>
          </div>
        {/each}
      </div>
      <div class="mt-1 flex gap-3">
        <div class="flex items-center gap-1"><span class="h-2 w-2 rounded bg-orange-400/80"></span><span class="text-[9px] text-dim font-mono">CC</span></div>
        <div class="flex items-center gap-1"><span class="h-2 w-2 rounded bg-blue-500/80"></span><span class="text-[9px] text-dim font-mono">AGY</span></div>
      </div>
    </div>
  {:else}
    <div class="rounded-lg border border-dashed border-border p-6 text-center">
      <p class="font-mono text-[10px] text-dim">No usage data in this period</p>
    </div>
  {/if}

  <!-- Hourly activity heatmap -->
  {#if data.hourlyActivity.length > 0}
    <div class="rounded-lg border border-border bg-surface/30 p-3">
      <div class="mb-2 text-[9px] font-bold tracking-widest text-dim uppercase">Hourly Activity (UTC)</div>
      <div class="overflow-x-auto no-scrollbar">
        <div class="min-w-max">
          <!-- Hour axis labels (every 3h) -->
          <div class="mb-1 flex">
            <div class="w-10 shrink-0"></div>
            {#each HOURS as h}
              <div class="w-4 shrink-0 text-center font-mono text-[7px] text-dim">
                {h % 6 === 0 ? String(h).padStart(2, '0') : ''}
              </div>
            {/each}
          </div>
          <!-- Rows: one per date, most recent last -->
          {#each heatmapDates as date}
            <div class="mb-0.5 flex items-center">
              <div class="w-10 shrink-0 font-mono text-[7px] text-dim">{fmtDate(date)}</div>
              {#each HOURS as h}
                {@const cell = heatCell(date, h)}
                <div
                  class="h-3.5 w-4 shrink-0 rounded-[1px] bg-cta"
                  style="opacity: {cell ? heatOpacity(cell.dispatches) : '0.05'};"
                  title={cell ? `${String(h).padStart(2,'0')}:00 UTC — ${cell.dispatches} dispatches, $${cell.cost.toFixed(3)}` : `${String(h).padStart(2,'0')}:00 UTC — idle`}
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
      <div class="mb-2 text-[9px] font-bold tracking-widest text-dim uppercase">Ticket Leaderboard</div>
      <div class="flex flex-col gap-1">
        {#each leaderboard() as ticket, i}
          <div class="flex items-center gap-2 rounded border border-border/30 bg-surface/20 px-2 py-1.5">
            <span class="w-5 shrink-0 font-mono text-[9px] text-dim tabular-nums">#{i + 1}</span>
            <span class="min-w-0 flex-1 font-mono text-[10px] font-bold text-foreground truncate">{ticket.ticket_id}</span>
            <div class="flex shrink-0 gap-1">
              {#each ticket.workers as w}
                <span class="font-mono text-[9px] {workerPill(w)}">{workerLabel(w)}</span>
              {/each}
            </div>
            <div class="flex shrink-0 flex-col items-end">
              <span class="font-mono text-[10px] font-bold tabular-nums text-foreground">${ticket.cost.toFixed(2)}</span>
              <span class="font-mono text-[8px] text-dim tabular-nums">{ticket.dispatches}d · {fmtTokens(ticket.tokens)}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else if data.ticketLeaderboard.length === 0}
    <div class="rounded-lg border border-dashed border-border p-4 text-center">
      <p class="font-mono text-[10px] text-dim">No ticket-attributed costs in this period</p>
    </div>
  {/if}

  <!-- Burn rate card -->
  <div class="flex flex-col gap-2 rounded-lg border border-border bg-surface/30 p-3">
    <div class="text-[9px] font-bold tracking-widest text-dim uppercase">Burn Rate</div>
    <div class="flex justify-between font-mono text-[11px]">
      <span class="text-dim">Daily avg</span>
      <span class="tabular-nums text-foreground">${data.history.projection.dailyAvg.toFixed(3)}/day</span>
    </div>
    <div class="flex justify-between font-mono text-[11px]">
      <span class="text-dim">Days elapsed</span>
      <span class="tabular-nums text-foreground">{data.history.projection.daysElapsed} / {data.history.projection.daysInMonth}</span>
    </div>
    <div class="relative h-2 overflow-hidden rounded-full border border-border/50 bg-surface">
      <div
        class="absolute left-0 top-0 h-full rounded-full bg-foreground/20"
        style="width: {Math.min(100, (data.history.projection.daysElapsed / data.history.projection.daysInMonth) * 100).toFixed(1)}%"
      ></div>
    </div>
    <div class="flex justify-between font-mono text-[10px]">
      <span class="text-dim">MTD ${data.history.projection.monthToDate.toFixed(2)}</span>
      <span class="{projColor(data.history.projection.projectedEOM)}">Proj. ${data.history.projection.projectedEOM.toFixed(2)}</span>
    </div>
  </div>

  <!-- Daily breakdown table -->
  <div class="rounded-lg border border-border bg-surface/30 p-3">
    <div class="mb-2 text-[9px] font-bold tracking-widest text-dim uppercase">Daily Breakdown</div>
    <table class="w-full font-mono text-[10px] tabular-nums">
      <thead>
        <tr class="border-b border-border/50 text-[9px] uppercase tracking-wider text-dim">
          <th class="pb-1 text-left font-bold">Date</th>
          <th class="pb-1 text-right font-bold">CC</th>
          <th class="pb-1 text-right font-bold">AGY</th>
          <th class="pb-1 text-right font-bold">Total</th>
        </tr>
      </thead>
      <tbody>
        {#each data.history.days as day}
          {@const cc = workerCost(day, 'claude-code')}
          {@const gmi = workerCost(day, 'gemini')}
          {@const ccD = workerDispatches(day, 'claude-code')}
          {@const gmiD = workerDispatches(day, 'gemini')}
          <tr class="border-b border-border/20 hover:bg-surface/50">
            <td class="py-1 pr-2 text-foreground">{fmtDate(day.date)}</td>
            <td class="py-1 pr-2 text-right text-orange-400">{cc > 0 ? `$${cc.toFixed(3)} (${ccD})` : '—'}</td>
            <td class="py-1 pr-2 text-right text-blue-500">{gmi > 0 ? `$${gmi.toFixed(3)} (${gmiD})` : '—'}</td>
            <td class="py-1 text-right text-foreground">${day.totalCost.toFixed(3)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if data.history.days.length === 0}
      <p class="py-4 text-center font-mono text-[10px] text-dim">No data</p>
    {/if}
  </div>

  <p class="pb-2 text-center font-mono text-[10px] text-dim">{data.history.totalEvents} total dispatch events tracked</p>
</div>

<style>
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
