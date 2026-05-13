<script lang="ts">
	import RunCardSkeleton from '$lib/components/RunCardSkeleton.svelte';
	import MemoryFeed from '$lib/components/MemoryFeed.svelte';
	import UsageTracker from '$lib/components/UsageTracker.svelte';
	import RunGroup from '$lib/components/RunGroup.svelte';
	import type { Run, RunsResponse } from '$lib/types/run';
	import type { ProvisionalLesson, AdoptedLesson, Observation } from '$lib/types/memory';
	import type { UsageMetrics } from './api/usage/+server';
	import { resolve } from '$app/paths';
	import { AlertCircle, RefreshCcw, Brain, Activity, ListFilter } from 'lucide-svelte';
	import type { PageData } from './$types';

	// CodeRabbit Critical fix: client-side display config (poll interval,
	// feed limit) is supplied via +page.server.ts load() instead of
	// importing $lib/config — which used $env/dynamic/private and broke
	// SvelteKit's server-only-module rule.
	let { data }: { data: PageData } = $props();

	function getInitialRuns() {
		return data.runs || [];
	}
	function getInitialProvisional() {
		return data.memory?.provisional || [];
	}
	function getInitialAdopted() {
		return data.memory?.adopted || [];
	}
	function getInitialRaw() {
		return data.memory?.raw || [];
	}
	function getInitialUsage() {
		return data.usage || null;
	}

	let runs = $state<Run[]>(getInitialRuns());
	let provisional = $state<ProvisionalLesson[]>(getInitialProvisional());
	let adopted = $state<AdoptedLesson[]>(getInitialAdopted());
	let raw = $state<Observation[]>(getInitialRaw());
	let usage = $state<UsageMetrics | null>(getInitialUsage());
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);

	// Grouping derived state
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
			// goes to n8n at root and returns HTML, breaking JSON.parse.
			const [runsResp, memoryResp, usageResp] = await Promise.all([
				fetch(resolve('/api/runs')),
				fetch(resolve('/api/memory')),
				fetch(resolve('/api/usage'))
			]);

			if (!runsResp.ok) {
				const errData = await runsResp.json();
				throw new Error(errData.error || `Runs HTTP ${runsResp.status}`);
			}
			const runsData: RunsResponse = await runsResp.json();
			runs = runsData.runs;

			if (memoryResp.ok) {
				const memoryData = await memoryResp.json();
				provisional = memoryData.provisional || [];
				adopted = memoryData.adopted || [];
				raw = memoryData.raw || [];
			}

			if (usageResp.ok) {
				const usageData = await usageResp.json();
				usage = usageData.metrics;
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
		// fetchDashboard() is no longer called immediately on mount since SSR handles it.
		const interval = setInterval(() => {
			if (document.visibilityState === 'visible') {
				fetchDashboard();
			}
		}, data.pollIntervalMs);

		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				fetchDashboard();
			}
		};
		document.addEventListener('visibilitychange', onVisibilityChange);

		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	});
</script>

<div class="mx-auto grid max-w-[1400px] grid-cols-1 gap-6 lg:grid-cols-12">
	<!-- Top/Sidebar: Team Memory & Usage (Prominent on Mobile) -->
	<div class="order-1 flex flex-col gap-4 lg:order-2 lg:col-span-4">
		<div class="mb-2 flex items-center gap-2">
			<Brain size={18} class="text-blue-400" />
			<h2 class="font-mono text-sm font-bold tracking-widest text-[#F0F0F0] uppercase">
				Team Memory
			</h2>
		</div>

		{#if usage}
			<div class="flex flex-col gap-2 rounded-lg border border-[#21262D] bg-[#0A0A0A] p-3">
				<div class="mb-1 flex items-center gap-2">
					<Activity size={12} class="text-blue-400" />
					<span class="text-[10px] font-bold tracking-widest text-[#8A8A9A] uppercase"
						>System Usage</span
					>
				</div>
				<UsageTracker metrics={usage} />
			</div>
		{/if}

		<div class="sticky top-6">
			<MemoryFeed {provisional} {adopted} {raw} />
		</div>
	</div>

	<!-- Main Feed: Organized Runs -->
	<div class="order-2 flex flex-col gap-4 lg:order-1 lg:col-span-8">
		<div class="mb-2 flex items-center justify-between">
			<div class="flex items-center gap-2">
				<ListFilter size={18} class="text-[#8A8A9A]" />
				<h2 class="font-mono text-sm font-bold tracking-widest text-[#F0F0F0] uppercase">
					Active & Recent Runs
				</h2>
			</div>
			<button
				onclick={fetchDashboard}
				class="flex items-center gap-1.5 rounded-md border border-[#21262D] bg-[#161B22] px-2 py-1 font-mono text-[10px] tracking-wider text-[#8A8A9A] uppercase transition-colors hover:bg-[#1C2128] hover:text-[#F0F0F0]"
			>
				<RefreshCcw size={12} class={loading && runs.length > 0 ? 'animate-spin' : ''} />
				Sync
			</button>
		</div>

		{#if errorMsg}
			<div
				class="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
			>
				<AlertCircle size={16} class="shrink-0" />
				<div class="flex flex-col">
					<span class="text-xs font-bold tracking-wider uppercase">Fetch Error</span>
					<span class="font-mono text-[11px] opacity-80">{errorMsg}</span>
				</div>
			</div>
		{/if}

		<div class="flex flex-col gap-4">
			{#if loading && runs.length === 0}
				<div class="flex flex-col gap-2">
					<RunCardSkeleton />
					<RunCardSkeleton />
				</div>
			{:else if runs.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#21262D] bg-[#0A0A0A] p-10 text-center"
				>
					<p class="font-mono text-xs font-semibold tracking-wider text-[#8A8A9A] uppercase">
						No runs yet
					</p>
					<p class="mt-2 font-mono text-[10px] text-[#6B7280]">
						Dispatch a worker to see it appear here.
					</p>
				</div>
			{:else}
				{#if failedRuns.length > 0}
					<RunGroup
						title="Failed / Blocked"
						runs={failedRuns}
						defaultOpen={true}
						color="text-red-400"
					/>
				{/if}
				{#if reviewRuns.length > 0}
					<RunGroup
						title="Inconclusive / Review"
						runs={reviewRuns}
						defaultOpen={true}
						color="text-amber-400"
					/>
				{/if}
				{#if completedRuns.length > 0}
					<RunGroup
						title="Confirmed Working"
						runs={completedRuns}
						defaultOpen={false}
						color="text-emerald-400"
					/>
				{/if}
			{/if}
		</div>
	</div>
</div>
