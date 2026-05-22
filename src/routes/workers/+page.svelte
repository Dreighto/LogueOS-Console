<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import type { ActiveJob, WorkerNote, Lane } from '$lib/types/worker';
	import { dispatchLanes, laneLabel, workerShortLabel } from '$lib/config/workers';
	import { AlertCircle } from 'lucide-svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import LivePill from '$lib/components/LivePill.svelte';
	import JobCard from '$lib/components/JobCard.svelte';
	import { slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	// Wrapped so svelte-check doesn't flag a captured-initial-value reference —
	// the $effect blocks below re-sync these from `data` on navigation.
	function initialJobs() {
		return data.jobs;
	}
	function initialNotes() {
		return data.notes;
	}
	let jobs = $state<ActiveJob[]>(initialJobs());
	let notes = $state<WorkerNote[]>(initialNotes());
	let refreshError = $state<string | null>(null);

	$effect(() => {
		jobs = data.jobs;
	});
	$effect(() => {
		notes = data.notes;
	});

	// The lanes to render, from the worker registry — backend, frontend.
	const lanes = dispatchLanes();

	// Jobs bucketed by lane. A job's lane is the nature of the WORK, so a
	// cross-functional worker simply appears under whichever lane its job is.
	let jobsByLane = $derived(
		Object.fromEntries(lanes.map((l) => [l, jobs.filter((j) => j.lane === l)])) as Record<
			Lane,
			ActiveJob[]
		>
	);

	async function refresh() {
		refreshError = null;
		try {
			const response = await fetch(resolve('/api/workers'));
			if (response.ok) {
				const result = await response.json();
				jobs = result.jobs;
				notes = result.notes;
			} else {
				refreshError = `Status ${response.status}`;
			}
		} catch (error) {
			refreshError = error instanceof Error ? error.message : 'Refresh failed';
		}
	}

	onMount(() => {
		const interval = setInterval(refresh, data.config.pollIntervalMs);
		return () => clearInterval(interval);
	});
</script>

<div class="flex flex-col gap-6">
	<PageHeader title="Team" subtitle="Live dispatch work, by lane.">
		<LivePill />
	</PageHeader>

	{#if refreshError}
		<div
			class="rounded border border-status-red/30 bg-status-red/10 px-3 py-2 font-mono text-xs text-status-red"
		>
			Refresh error: {refreshError}
		</div>
	{/if}

	{#each lanes as lane (lane)}
		<section class="flex flex-col gap-3">
			<div class="flex items-center justify-between border-b border-border pb-1.5">
				<h2 class="text-xs font-bold tracking-widest text-foreground uppercase">
					{laneLabel(lane)}
				</h2>
				<span class="text-xs font-bold tracking-widest text-muted-foreground uppercase">
					{jobsByLane[lane].length === 0 ? 'idle' : `${jobsByLane[lane].length} running`}
				</span>
			</div>

			{#each jobsByLane[lane] as job (job.trace_id ?? job.slot)}
				<div animate:flip={{ duration: 300 }} in:slide={{ duration: 300 }}>
					<JobCard {job} />
				</div>
			{:else}
				<div
					class="rounded-sm border border-dashed border-border px-3 py-4 text-center font-mono text-xs text-muted-foreground"
				>
					No active {laneLabel(lane).toLowerCase()} work
				</div>
			{/each}
		</section>
	{/each}

	{#if notes.length > 0 || data.errorMsg}
		<section class="rounded-lg border border-status-red/20 bg-status-red/5 p-4">
			<h2
				class="flex items-center gap-2 text-xs font-bold tracking-widest text-status-red uppercase"
			>
				<AlertCircle size={14} />
				Operational Notes
			</h2>
			<ul class="mt-3 list-inside list-disc space-y-2 font-mono text-xs text-status-red/80">
				{#if data.errorMsg}
					<li>SYSTEM: {data.errorMsg}</li>
				{/if}
				{#each notes as note (note.worker_id)}
					<li>{workerShortLabel(note.worker_id)}: last session ended with {note.last_exit_status}</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
