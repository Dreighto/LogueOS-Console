<script lang="ts">
	/**
	 * LogueOS "Today" Screen (Redesign LOS-75)
	 *
	 * High-density dashboard answering 5 key questions in 30s:
	 * 1. Is the team running? (Kill switch + Active Workers)
	 * 2. Is work moving? (Worker progress + recent dispatches)
	 * 3. Is anything stuck? (Failures + Inconclusive items)
	 * 4. What just got done? (Today's completions list)
	 * 5. How much did this cost? (Today's spend metrics)
	 */
	import { resolve } from '$app/paths';
	import {
		AlertTriangle,
		CheckCircle2,
		Plus,
		ChevronRight,
		Power,
		Activity,
		Clock,
		ExternalLink
	} from 'lucide-svelte';
	import type { PageData } from './$types';
	import { formatRelativeTime } from '$lib/utils/format';

	let { data }: { data: PageData } = $props();

	// $state instead of $derived so poll updates touch only changed nodes.
	// $derived(data.status) would re-bind the entire object on every SSR
	// invalidation, causing the whole page to flicker. With $state we
	// fetch /api/status and assign in-place; Svelte 5 diffs field-by-field.
	let s = $state(data.status);
	import { fade, scale } from 'svelte/transition';

	// Keep in sync if SvelteKit navigates and re-runs the server load.
	$effect(() => {
		s = data.status;
	});

	async function refresh() {
		try {
			const resp = await fetch(resolve('/api/status'));
			if (!resp.ok) return;
			const body = await resp.json();
			s = body.status;
		} catch {
			// silent — stale data is fine for one cycle
		}
	}

	$effect(() => {
		const interval = setInterval(() => {
			if (document.visibilityState === 'visible') void refresh();
		}, data.pollIntervalMs);
		const onVis = () => {
			if (document.visibilityState === 'visible') void refresh();
		};
		document.addEventListener('visibilitychange', onVis);
		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVis);
		};
	});

	let attentionItems = $derived(
		[...s.failures.items, ...s.reviews.items].sort((a, b) =>
			b.timestamp.localeCompare(a.timestamp)
		)
	);

	function sanitizeTicketId(id?: string | null): string {
		if (!id) return 'unassigned';
		return id.replace(/[-#][a-f0-9]{6,}$/i, '').trim() || 'unassigned';
	}

	function humanizeStep(step?: string): string {
		if (!step) return 'Initializing';
		return step
			.toLowerCase()
			.replace(/_/g, ' ')
			.replace(/\b\w/g, (c) => c.toUpperCase());
	}

	function formatBranch(branch?: string): string {
		if (!branch) return '';
		const parts = branch.split('/');
		return parts[parts.length - 1];
	}
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-4 p-2 font-mono text-slate-200 md:p-4">
	<!-- Q1: Is the team running? -->
	<header class="flex items-center justify-between border-b border-border pb-2">
		<div class="flex items-center gap-2">
			<Activity size={16} class="text-blue-400" />
			<h1 class="text-[10px] font-bold tracking-widest text-slate-400 uppercase">Team Heartbeat</h1>
		</div>
		<a
			href={resolve('/settings')}
			data-testid="system-mode-banner"
			class="flex items-center gap-2 rounded-sm border px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase transition-colors {s
				.killSwitch.active
				? 'border-status-red/40 bg-status-red/10 text-status-red hover:bg-status-red/20'
				: 'border-status-green/20 bg-status-green/5 text-status-green hover:bg-status-green/10'}"
		>
			<Power size={10} />
			Kill: {s.killSwitch.active ? 'ACTIVE' : 'clear'}
		</a>
	</header>

	{#if data.loadError}
		<div
			class="rounded-sm border border-status-amber/30 bg-status-amber/5 px-3 py-2 text-[10px] text-status-amber"
		>
			Status board data unavailable — last known state shown.
		</div>
	{/if}

	<!-- Q3: Is anything stuck? (MOVED TO TOP FOR TRIAGE VISIBILITY) -->
	<section class="flex flex-col gap-2">
		<div class="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
			<span>Blockers & Reviews</span>
			<span class="flex gap-2">
				<span class={s.failures.count > 0 ? 'text-status-red' : ''}>Failures: {s.failures.count}</span>
				<span class={s.reviews.count > 0 ? 'text-status-amber' : ''}>Review: {s.reviews.count}</span>
			</span>
		</div>
		<div class="flex flex-col gap-1">
			{#each attentionItems as item, i (item.timestamp + i)}
				<a
					href={resolve('/activity')}
					class="group flex items-center gap-3 rounded-sm border border-border bg-surface p-2 transition-colors hover:border-slate-600"
				>
					{#if item.status === 'FAILED' || item.status === 'ESCALATE'}
						<AlertTriangle size={14} class="shrink-0 text-status-red" />
					{:else}
						<Clock size={14} class="shrink-0 text-status-amber" />
					{/if}
					<div class="flex min-w-0 flex-1 flex-col">
						<div class="flex items-center gap-2">
							<span class="text-[10px] font-bold text-slate-200">{item.ticket_id || 'unknown'}</span>
							<span class="text-[9px] text-slate-500">{formatRelativeTime(item.timestamp)}</span>
						</div>
						<div class="truncate text-[10px] text-slate-400">{item.summary}</div>
					</div>
					<ChevronRight size={12} class="text-slate-600 group-hover:text-slate-400" />
				</a>
			{:else}
				<div class="rounded-sm border border-dashed border-border p-2 text-center">
					<span class="text-[10px] text-slate-600 uppercase italic">No stuck work detected</span>
				</div>
			{/each}
		</div>
	</section>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
		<!-- Workers Section -->
		<section class="flex flex-col gap-2">
			<div class="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
				<span>Workers</span>
				<span>{s.workers.active} / {s.workers.total} active</span>
			</div>
			<div class="flex flex-col gap-1">
				{#each s.workers.items as w (w.id)}
					<a
						href={resolve('/workers')}
						class="group flex flex-col gap-1 rounded-sm border border-border bg-surface p-2 transition-colors hover:border-blue-500/40"
					>
						<div class="flex items-center justify-between">
							<span
								class="text-[11px] font-bold uppercase tracking-tight {w.state === 'busy'
									? 'text-blue-400'
									: w.state === 'idle'
										? 'text-slate-400'
										: 'text-slate-600'}">{w.id === 'gemini' ? 'Antigravity' : w.id}</span
							>
							<span class="text-[9px] uppercase text-slate-500"
								>{w.since ? formatRelativeTime(w.since) : w.state}</span
							>
						</div>
						{#if w.state === 'busy'}
							<div class="truncate text-[10px] uppercase tracking-tight text-slate-300">
								<span class="text-blue-400">{sanitizeTicketId(w.ticket_id)}</span> • {humanizeStep(w.step)}
							</div>
							{#if w.branch}
								<div class="truncate text-[9px] text-slate-500 italic">
									{formatBranch(w.branch)}
								</div>
							{/if}
						{:else}
							<div class="text-[10px] font-bold tracking-widest text-slate-600 uppercase">
								{w.state === 'idle' ? '[ IDLE ]' : '[ OFFLINE ]'}
							</div>
						{/if}
					</a>
				{:else}
					<div class="rounded-sm border border-dashed border-border p-2 text-center">
						<span class="text-[10px] text-slate-600 uppercase italic">No workers</span>
					</div>
				{/each}
			</div>
		</section>

		<!-- Work Summary -->
		<section class="flex flex-col gap-2">
			<div class="text-[10px] font-bold text-slate-500 uppercase">Work Today</div>
			<div class="flex flex-col gap-2">
				<div class="flex flex-col gap-1 rounded-sm border border-border bg-surface p-2">
					<span class="text-[9px] tracking-widest text-slate-500 uppercase">Shipped</span>
					<span class="text-lg font-bold text-status-green">{s.completions.today}</span>
				</div>
				<div class="flex flex-col gap-1 rounded-sm border border-border bg-surface p-2">
					<span class="text-[9px] tracking-widest text-slate-500 uppercase">Attention</span>
					<span
						class="text-lg font-bold {s.failures.count + s.reviews.count > 0
							? 'text-status-amber'
							: 'text-slate-500'}">{s.failures.count + s.reviews.count}</span
					>
				</div>
			</div>
		</section>

		<!-- Q5: How much did this cost? -->
		<section class="flex flex-col gap-2">
			<div class="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
				<span>Today's Spend</span>
				<a
					href={resolve('/usage')}
					class="flex items-center gap-1 transition-colors hover:text-blue-400"
				>
					Details <ExternalLink size={8} />
				</a>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div class="flex flex-col gap-1 rounded-sm border border-border bg-surface p-2">
					<span class="text-[9px] tracking-widest text-slate-500 uppercase">Cost (USD)</span>
					<span class="text-lg font-bold text-status-green">${s.usage.todayCost.toFixed(2)}</span>
				</div>
				<div class="flex flex-col gap-1 rounded-sm border border-border bg-surface p-2">
					<span class="text-[9px] tracking-widest text-slate-500 uppercase">Dispatches</span>
					<span class="text-lg font-bold text-blue-400">{s.usage.recentDispatches}</span>
				</div>
			</div>
		</section>
	</div>

	<!-- Q4: What just got done? -->
	<section class="flex flex-col gap-2">
		<div class="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
			<span>Today's Shipments</span>
			<span>{s.completions.today} total</span>
		</div>
		<div class="flex flex-col gap-1">
			{#each s.completions.items as item, i (item.timestamp + i)}
				<div class="flex items-center gap-3 rounded-sm border border-border bg-surface p-2">
					<CheckCircle2 size={14} class="shrink-0 text-status-green" />
					<div class="flex min-w-0 flex-col">
						<div class="flex items-center gap-2">
							<span class="text-[10px] font-bold text-status-green"
								>{item.ticket_id || 'shipped'}</span
							>
							<span class="text-[9px] text-slate-500">{formatRelativeTime(item.timestamp)}</span>
						</div>
						<div class="truncate text-[10px] text-slate-400">{item.summary}</div>
					</div>
				</div>
			{:else}
				<div class="rounded-sm border border-dashed border-border p-2 text-center">
					<span class="text-[10px] text-slate-600 uppercase italic">Nothing shipped yet today</span>
				</div>
			{/each}
		</div>
	</section>

	<!-- Action: Dispatch -->
	<a
		data-testid="row-dispatch"
		href={resolve('/ask')}
		class="mt-2 flex items-center justify-center gap-2 rounded-sm border border-blue-500/50 bg-blue-600/10 px-4 py-2 text-[11px] font-bold tracking-[0.2em] text-blue-400 uppercase transition-colors hover:bg-blue-600/20 active:bg-blue-600/30 active:scale-[0.99]"
	>
		<Plus size={14} />
		Give the team a job
	</a>
</div>
