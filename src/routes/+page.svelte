<script lang="ts">
	// LogueOS landing — status-board model.
	//
	// Single-screen check-in: 5 status rows + dispatch button. Each row is a
	// link to the existing detail page where the operator can drill in. The
	// landing page itself does NOT render lists or lesson text — that's why
	// we have /workers, /runs, /usage, /memory, /ask. Keeps the page small
	// (target: <10KB HTML), fast to redraw, and glanceable on phone.
	//
	// Polling: invalidateAll() reruns the SSR load to refresh the counts.
	// Pauses when the tab is hidden (visibilitychange) and refetches on
	// tab-return so the operator sees fresh data immediately when they
	// reopen the tab.
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import {
		AlertTriangle,
		ClipboardCheck,
		Users,
		DollarSign,
		Plus,
		ChevronRight,
		Power
	} from 'lucide-svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let s = $derived(data.status);

	// Tier the rows by severity so the eye finds problems first.
	let failureColor = $derived(
		s.failures.count > 0
			? 'text-red-400 bg-red-500/5 border-red-500/20 hover:bg-red-500/10'
			: 'text-slate-400 bg-slate-900/40 border-slate-800 hover:bg-slate-900'
	);
	let reviewColor = $derived(
		s.reviews.count > 0
			? 'text-amber-400 bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10'
			: 'text-slate-400 bg-slate-900/40 border-slate-800 hover:bg-slate-900'
	);
	let killColor = $derived(
		s.killSwitch.active
			? 'text-red-400 bg-red-500/10 border-red-500/40'
			: 'text-emerald-400 bg-emerald-500/5 border-emerald-500/20'
	);

	function refresh() {
		void invalidateAll();
	}

	$effect(() => {
		const interval = setInterval(() => {
			if (document.visibilityState === 'visible') refresh();
		}, data.pollIntervalMs);
		const onVis = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		document.addEventListener('visibilitychange', onVis);
		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVis);
		};
	});
</script>

<div class="mx-auto max-w-md flex flex-col gap-3 p-4 md:max-w-lg md:p-6">
	<!-- Kill switch badge — site header already provides the page title. -->
	<div class="flex justify-end mb-1">
		<div data-testid="kill-switch-badge" class="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-1 rounded-full border {killColor}">
			<Power size={12} />
			Kill: {s.killSwitch.active ? 'ACTIVE' : 'clear'}
		</div>
	</div>

	<a
		data-testid="row-failures"
		href={resolve('/activity')}
		class="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-colors {failureColor}"
	>
		<div class="flex items-center gap-3 min-w-0">
			<AlertTriangle size={18} class="shrink-0" />
			<span class="font-mono text-xs font-bold uppercase tracking-wider truncate">Recent failures</span>
		</div>
		<div class="flex items-center gap-2 shrink-0">
			<span class="font-mono text-base tabular-nums">{s.failures.count}</span>
			<ChevronRight size={16} class="opacity-50" />
		</div>
	</a>

	<a
		data-testid="row-reviews"
		href={resolve('/activity')}
		class="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-colors {reviewColor}"
	>
		<div class="flex items-center gap-3 min-w-0">
			<ClipboardCheck size={18} class="shrink-0" />
			<span class="font-mono text-xs font-bold uppercase tracking-wider truncate">Pending review</span>
		</div>
		<div class="flex items-center gap-2 shrink-0">
			<span class="font-mono text-base tabular-nums">{s.reviews.count}</span>
			<ChevronRight size={16} class="opacity-50" />
		</div>
	</a>

	<a
		data-testid="row-workers"
		href={resolve('/workers')}
		class="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border bg-slate-900/40 border-slate-800 text-slate-300 hover:bg-slate-900 transition-colors"
	>
		<div class="flex items-center gap-3 min-w-0">
			<Users size={18} class="text-blue-400 shrink-0" />
			<span class="font-mono text-xs font-bold uppercase tracking-wider truncate">Workers active</span>
		</div>
		<div class="flex items-center gap-2 shrink-0">
			<span class="font-mono text-base tabular-nums">
				{s.workers.active}<span class="text-slate-500"> / {s.workers.total}</span>
			</span>
			<ChevronRight size={16} class="opacity-50" />
		</div>
	</a>

	<a
		data-testid="row-usage"
		href={resolve('/usage')}
		class="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border bg-slate-900/40 border-slate-800 text-slate-300 hover:bg-slate-900 transition-colors"
	>
		<div class="flex items-center gap-3 min-w-0">
			<DollarSign size={18} class="text-blue-400 shrink-0" />
			<span class="font-mono text-xs font-bold uppercase tracking-wider truncate">Today's spend</span>
		</div>
		<div class="flex items-center gap-2 shrink-0">
			<span class="font-mono text-base tabular-nums">${s.usage.todayCost.toFixed(2)}</span>
			<ChevronRight size={16} class="opacity-50" />
		</div>
	</a>

	<a
		data-testid="row-dispatch"
		href={resolve('/ask')}
		class="mt-3 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-mono text-sm font-bold uppercase tracking-widest transition-colors"
	>
		<Plus size={18} />
		Dispatch worker
	</a>
</div>
