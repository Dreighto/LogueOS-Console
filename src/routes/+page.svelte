<script lang="ts">
	import RunCardSkeleton from '$lib/components/RunCardSkeleton.svelte';
	import RunGroup from '$lib/components/RunGroup.svelte';
	import WorkerCard from '$lib/components/WorkerCard.svelte';
	import UsageTracker from '$lib/components/UsageTracker.svelte';
	import MemoryFeed from '$lib/components/MemoryFeed.svelte';
	import type { Run, RunsResponse } from '$lib/types/run';
	import type { WorkerStatus } from '$lib/types/worker';
	import type { ProvisionalLesson, AdoptedLesson, Observation } from '$lib/types/memory';
	import type { UsageMetrics } from './api/usage/+server';
	import { resolve } from '$app/paths';
	import {
		AlertCircle, RefreshCcw, ListFilter,
		Users, Terminal, Activity, Brain
	} from 'lucide-svelte';
	import type { PageData } from './$types';

	// CodeRabbit Critical fix: client-side display config (poll interval,
	// feed limit) is supplied via +page.server.ts load() instead of
	// importing $lib/config — which used $env/dynamic/private and broke
	// SvelteKit's server-only-module rule. Don't move config reads back
	// into the client without re-checking that rule.
	let { data }: { data: PageData } = $props();

	let runs = $state<Run[]>(data.runs || []);
	let workers = $state<WorkerStatus[]>(data.workers || []);
	let usage = $state<UsageMetrics | null>(data.usage || null);
	let provisional = $state<ProvisionalLesson[]>(data.memory?.provisional || []);
	let adopted = $state<AdoptedLesson[]>(data.memory?.adopted || []);
	let raw = $state<Observation[]>(data.memory?.raw || []);
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);

	// No slice limits: if 30 runs failed, the operator should see all 30.
	// RunGroup handles its own collapse / scroll if the list gets long.
	let failedRuns = $derived(runs.filter((r) => r.status === 'FAILED' || r.status === 'ESCALATE'));
	let reviewRuns = $derived(
		runs.filter((r) => r.status === 'INCONCLUSIVE' || r.status === 'unknown')
	);
	let completedRuns = $derived(runs.filter((r) => r.status === 'CONFIRMED_WORKING'));

	async function fetchDashboard() {
		loading = true;
		try {
			// Use resolve() so the URL respects kit.paths.base. Without it,
			// the bare '/api/runs' resolves to the SITE root not the app's
			// base — when served behind Tailscale at /console, that request
			// goes to the proxy at root and returns HTML, breaking JSON.parse.
			const [runsResp, workersResp, usageResp, memoryResp] = await Promise.all([
				fetch(resolve('/api/runs')),
				fetch(resolve('/api/workers')),
				fetch(resolve('/api/usage')),
				fetch(resolve('/api/memory'))
			]);

			// /api/runs is the primary data source — surface its failure loudly.
			// Silent skip would leave the UI showing stale data without any
			// indication something's wrong; that's how outages get missed.
			if (!runsResp.ok) {
				const errData = await runsResp.json().catch(() => ({}));
				throw new Error(errData.error || `Runs HTTP ${runsResp.status}`);
			}
			const runsData: RunsResponse = await runsResp.json();
			runs = runsData.runs;

			// Secondary feeds: tolerate failure (worker / usage / memory can
			// be partially unavailable without the dashboard being broken).
			if (workersResp.ok) {
				const workersData = await workersResp.json();
				workers = workersData.workers;
			}
			if (usageResp.ok) {
				const usageData = await usageResp.json();
				usage = usageData.metrics;
			}
			if (memoryResp.ok) {
				const memoryData = await memoryResp.json();
				provisional = memoryData.provisional || [];
				adopted = memoryData.adopted || [];
				raw = memoryData.raw || [];
			}

			errorMsg = null;
		} catch (e: unknown) {
			// CodeRabbit Major: catch (e: any) violates strict TS. Use unknown + narrow.
			errorMsg = e instanceof Error ? e.message : 'Unknown error';
			console.error('Dashboard fetch error:', e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		// Two refresh paths: (1) interval poll while tab is visible,
		// (2) refetch immediately when tab becomes visible after being
		// hidden — so returning to the tab shows fresh data right away
		// instead of waiting up to one full poll interval.
		const interval = setInterval(() => {
			if (document.visibilityState === 'visible') fetchDashboard();
		}, data.pollIntervalMs);

		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') fetchDashboard();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);

		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	});
</script>

<div class="mx-auto max-w-[1400px] flex flex-col gap-6 py-2 px-4 md:py-6 md:px-6">
	<!-- TOP HUD: System Usage -->
	{#if usage}
		<div class="flex flex-col gap-2">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<Activity size={18} class="text-blue-400" />
					<h2 class="font-mono text-sm font-bold tracking-widest text-slate-200 uppercase">System Usage</h2>
				</div>
				<a href={resolve('/usage')} class="text-[10px] font-mono text-blue-500 hover:text-blue-400 transition-colors uppercase font-bold tracking-tighter">View Detailed Analytics &rarr;</a>
			</div>
			<UsageTracker metrics={usage} />
		</div>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mt-2">
		<!-- LEFT: Fleet Overwatch + Team Memory + Mission Control -->
		<div class="lg:col-span-4 flex flex-col gap-6 sticky top-6">
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between px-1">
					<div class="flex items-center gap-2">
						<Users size={18} class="text-blue-400" />
						<h2 class="font-mono text-xs font-bold tracking-widest text-slate-200 uppercase">Fleet Overwatch</h2>
					</div>
					<a href={resolve('/workers')} class="text-[10px] font-mono text-blue-500 hover:text-blue-400 transition-colors uppercase font-bold tracking-tighter">Manage Fleet</a>
				</div>

				<div class="flex flex-col gap-3">
					{#each workers as worker (worker.id)}
						<WorkerCard {worker} />
					{/each}
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<div class="flex items-center gap-2 px-1">
					<Brain size={18} class="text-blue-400" />
					<h2 class="font-mono text-xs font-bold tracking-widest text-slate-200 uppercase">
						Team Memory
					</h2>
				</div>
				<MemoryFeed {provisional} {adopted} {raw} />
			</div>

			<div>
				<a
					href={resolve('/ask')}
					class="group flex flex-col gap-4 p-5 bg-blue-600/10 border border-blue-500/30 rounded-xl hover:bg-blue-600/20 transition-all active:scale-95"
				>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-blue-400 font-mono text-xs font-bold uppercase tracking-widest">
							<Terminal size={16} />
							Mission Control
						</div>
						<RefreshCcw size={14} class="text-blue-500 group-hover:rotate-180 transition-transform duration-500" />
					</div>
					<p class="text-xs text-blue-200/60 font-sans leading-relaxed">
						Ready to initiate remote worker dispatch. Enter new mission parameters to begin.
					</p>
					<span class="text-[10px] font-mono font-bold text-blue-400 uppercase tracking-widest underline decoration-2 underline-offset-4">Open Interface &rarr;</span>
				</a>
			</div>
		</div>

		<!-- RIGHT: Mission Intel (The Log) -->
		<div class="lg:col-span-8 flex flex-col gap-4">
			<div class="flex items-center justify-between px-1">
				<div class="flex items-center gap-2">
					<ListFilter size={18} class="text-slate-500" />
					<h2 class="font-mono text-xs font-bold tracking-widest text-slate-200 uppercase">Mission Intelligence (Recent)</h2>
				</div>
				<button
					onclick={fetchDashboard}
					class="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/50 hover:bg-slate-700 text-slate-400 text-[10px] font-mono font-bold uppercase tracking-tighter transition-all"
				>
					<RefreshCcw size={10} class={loading ? 'animate-spin' : ''} />
					Sync Intel
				</button>
			</div>

			{#if errorMsg}
				<div class="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-mono">
					<AlertCircle size={16} />
					<span>INTEL FETCH FAILED: {errorMsg}</span>
				</div>
			{/if}

			<div class="flex flex-col gap-5 bg-slate-900/20 p-4 rounded-xl border border-slate-800/50">
				{#if loading && runs.length === 0}
					<RunCardSkeleton />
					<RunCardSkeleton />
				{:else if runs.length === 0}
					<div class="flex flex-col items-center justify-center p-12 border border-dashed border-slate-800 rounded-xl text-center">
						<p class="font-mono text-xs text-slate-500 uppercase tracking-widest">No active logs</p>
					</div>
				{:else}
					{#if failedRuns.length > 0}
						<RunGroup title="Critical Failures" runs={failedRuns} defaultOpen={true} color="text-red-400" />
					{/if}
					{#if reviewRuns.length > 0}
						<RunGroup title="Pending Review" runs={reviewRuns} defaultOpen={true} color="text-amber-400" />
					{/if}
					{#if completedRuns.length > 0}
						<RunGroup title="Archived Success" runs={completedRuns} defaultOpen={false} color="text-slate-500" />
					{/if}
				{/if}
			</div>
		</div>
	</div>
</div>
