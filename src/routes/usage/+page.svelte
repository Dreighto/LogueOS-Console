<script lang="ts">
  import { ChevronLeft } from 'lucide-svelte';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import type { DailyUsage } from '$lib/types/usage';

  let { data }: { data: PageData } = $props();

  function workerCost(day: DailyUsage, worker: string): number {
    return day.workers.find(w => w.worker === worker)?.cost ?? 0;
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
        class="rounded px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase transition-colors {data.days === 7 ? 'bg-cta text-background' : 'text-muted-foreground'}"
        onclick={() => goto(resolve('/usage') + '?days=7')}
      >7d</button>
      <button
        class="rounded px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase transition-colors {data.days === 30 ? 'bg-cta text-background' : 'text-muted-foreground'}"
        onclick={() => goto(resolve('/usage') + '?days=30')}
      >30d</button>
    </div>
  </div>

  <!-- Summary bar -->
  <div class="grid grid-cols-2 gap-2">
    <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
      <div class="text-[9px] font-bold tracking-widest text-dim uppercase">MTD Cost</div>
      <div class="text-base font-bold tabular-nums text-foreground">${data.history.projection.monthToDate.toFixed(2)}</div>
    </div>
    <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
      <div class="flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-dim uppercase">
        <span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span> CC
      </div>
      <div class="text-base font-bold tabular-nums text-foreground">${data.history.projection.ccMtd.toFixed(2)}</div>
    </div>
    <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
      <div class="flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-dim uppercase">
        <span class="h-1.5 w-1.5 rounded-full bg-blue-400"></span> GMI
      </div>
      <div class="text-base font-bold tabular-nums text-foreground">${data.history.projection.gmiMtd.toFixed(2)}</div>
    </div>
    <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
      <div class="text-[9px] font-bold tracking-widest text-dim uppercase">Proj. EOMonth</div>
      <div class="text-base font-bold tabular-nums {projColor(data.history.projection.projectedEOM)}">${data.history.projection.projectedEOM.toFixed(2)}</div>
    </div>
  </div>

  <!-- Daily cost chart (CSS bars) -->
  {#if data.history.days.length > 0}
    <div class="rounded-lg border border-border bg-surface/30 p-3">
      <div class="mb-2 text-[9px] font-bold tracking-widest text-dim uppercase">Daily Cost</div>
      <div class="flex items-end gap-1 overflow-x-auto pb-2 no-scrollbar" style="height: 64px;">
        {#each [...data.history.days].reverse() as day}
          {@const cc = workerCost(day, 'claude-code')}
          {@const gmi = workerCost(day, 'gemini')}
          <div class="flex shrink-0 flex-col items-center gap-0.5" title="{fmtDate(day.date)}: CC ${cc.toFixed(3)} GMI ${gmi.toFixed(3)}">
            <div class="flex items-end gap-px">
              <div class="w-2 rounded-t bg-amber-400/80" style="height: {barHeight(cc, maxDailyCost)}px;"></div>
              <div class="w-2 rounded-t bg-blue-400/80" style="height: {barHeight(gmi, maxDailyCost)}px;"></div>
            </div>
          </div>
        {/each}
      </div>
      <div class="mt-1 flex gap-3">
        <div class="flex items-center gap-1"><span class="h-2 w-2 rounded bg-amber-400/80"></span><span class="text-[9px] text-dim font-mono">CC</span></div>
        <div class="flex items-center gap-1"><span class="h-2 w-2 rounded bg-blue-400/80"></span><span class="text-[9px] text-dim font-mono">GMI</span></div>
      </div>
    </div>
  {:else}
    <div class="rounded-lg border border-dashed border-border p-6 text-center">
      <p class="font-mono text-[10px] text-dim">No usage data in this period</p>
    </div>
  {/if}

  <!-- Provider breakdown table -->
  <div class="rounded-lg border border-border bg-surface/30 p-3">
    <div class="mb-2 text-[9px] font-bold tracking-widest text-dim uppercase">Daily Breakdown</div>
    <table class="w-full font-mono text-[10px] tabular-nums">
      <thead>
        <tr class="border-b border-border/50 text-[9px] uppercase tracking-wider text-dim">
          <th class="pb-1 text-left font-bold">Date</th>
          <th class="pb-1 text-right font-bold">CC</th>
          <th class="pb-1 text-right font-bold">GMI</th>
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
            <td class="py-1 pr-2 text-right text-amber-400">{cc > 0 ? `$${cc.toFixed(3)} (${ccD})` : '—'}</td>
            <td class="py-1 pr-2 text-right text-blue-400">{gmi > 0 ? `$${gmi.toFixed(3)} (${gmiD})` : '—'}</td>
            <td class="py-1 text-right text-foreground">${day.totalCost.toFixed(3)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if data.history.days.length === 0}
      <p class="py-4 text-center font-mono text-[10px] text-dim">No data</p>
    {/if}
  </div>

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
        class="absolute left-0 top-0 h-full rounded-full bg-cta/60"
        style="width: {Math.min(100, (data.history.projection.daysElapsed / data.history.projection.daysInMonth) * 100).toFixed(1)}%"
      ></div>
    </div>
    <div class="flex justify-between font-mono text-[10px]">
      <span class="text-dim">MTD ${data.history.projection.monthToDate.toFixed(2)}</span>
      <span class="{projColor(data.history.projection.projectedEOM)}">Proj. ${data.history.projection.projectedEOM.toFixed(2)}</span>
    </div>
  </div>

  <p class="pb-2 text-center font-mono text-[10px] text-dim">{data.history.totalEvents} total dispatch events tracked</p>
</div>

<style>
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
