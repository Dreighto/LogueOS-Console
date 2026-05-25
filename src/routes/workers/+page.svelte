<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import type { ActiveJob, WorkerNote, Lane } from '$lib/types/worker';
	import { dispatchLanes, laneLabel, workerShortLabel } from '$lib/config/workers';
	import { AlertCircle, Cpu, Terminal, Play, Sparkles, BookOpen, ShieldCheck, MessageSquare } from 'lucide-svelte';
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
	let activeTab = $state<'jobs' | 'roster'>('jobs');

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
	<PageHeader 
		title="Team" 
		subtitle={activeTab === 'jobs' ? "Live dispatch work, by lane." : "AI agent registry & capabilities."}
	>
		<LivePill />
	</PageHeader>

	<!-- Tab Switcher (Glassmorphic Density) -->
	<div class="grid grid-cols-2 gap-1 rounded-sm bg-muted/40 p-0.5 border border-border">
		<button
			type="button"
			class="active-trigger cursor-pointer rounded-xs py-1 text-center font-mono text-[10px] font-bold uppercase tracking-wider transition-all duration-200 {activeTab === 'jobs' ? 'bg-surface text-cta shadow-sm border border-border/80' : 'text-muted-foreground hover:text-foreground'}"
			onclick={() => activeTab = 'jobs'}
		>
			Live Dispatch
		</button>
		<button
			type="button"
			class="active-trigger cursor-pointer rounded-xs py-1 text-center font-mono text-[10px] font-bold uppercase tracking-wider transition-all duration-200 {activeTab === 'roster' ? 'bg-surface text-cta shadow-sm border border-border/80' : 'text-muted-foreground hover:text-foreground'}"
			onclick={() => activeTab = 'roster'}
		>
			AI Roster
		</button>
	</div>

	{#if activeTab === 'jobs'}
		<div class="flex flex-col gap-6" transition:slide={{ duration: 150 }}>
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
	{:else}
		<!-- Premium AI Roster & Capabilities Cards -->
		<div class="flex flex-col gap-5" transition:slide={{ duration: 150 }}>
			<!-- Claude Code Profile Card -->
			<article class="relative overflow-hidden rounded-sm border border-border/60 bg-surface/40 p-4 transition-all duration-300 hover:border-border/100">
				<!-- Brand left accent stripe -->
				<div class="absolute top-0 bottom-0 left-0 w-[3px] bg-[#D97757]"></div>
				
				<!-- Header info -->
				<header class="flex items-start justify-between gap-4 pl-1.5 pb-2.5 border-b border-border/40">
					<div>
						<div class="flex items-center gap-2">
							<h3 class="font-sans text-sm font-bold text-white leading-tight">Claude Code</h3>
							<span class="rounded bg-[#D97757]/15 px-1 py-0.5 font-mono text-[8px] font-bold text-[#D97757] border border-[#D97757]/30 uppercase tracking-wider">CC</span>
						</div>
						<p class="mt-0.5 font-mono text-[9px] text-muted-foreground uppercase tracking-widest">VP Ops & Backend Lead</p>
					</div>
					<div class="text-right">
						<span class="block font-mono text-[8px] text-muted-foreground/80">Model</span>
						<span class="font-mono text-xs font-semibold text-white/95">Claude Opus 4.7</span>
					</div>
				</header>

				<!-- Bio description -->
				<div class="mt-2.5 pl-1.5">
					<p class="text-xs text-muted-foreground leading-relaxed">
						The lead execution steward and backend specialist. Responsible for rigorous, multi-file code modifications, backend architecture, testing, and keeping standard workflow systems aligned.
					</p>
				</div>

				<!-- Capabilities breakdown -->
				<section class="mt-3.5 pl-1.5 flex flex-col gap-2.5">
					<h4 class="font-mono text-[9px] font-bold uppercase tracking-wider text-white/80">Core Capabilities</h4>
					<div class="grid grid-cols-1 gap-2">
						<!-- Frontend -->
						<div class="flex gap-2.5 items-start">
							<div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#D97757]/10 border border-[#D97757]/20 text-[#D97757]">
								<Cpu size={11} />
							</div>
							<div>
								<h5 class="font-sans text-[10px] font-bold text-white/90">SvelteKit Frontend</h5>
								<p class="text-[9px] text-muted-foreground/85 leading-normal mt-0.5">Builds and refines components, views, and wire up live polling feeds and stores. Debugs state lifecycles.</p>
							</div>
						</div>
						<!-- Backend -->
						<div class="flex gap-2.5 items-start">
							<div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#D97757]/10 border border-[#D97757]/20 text-[#D97757]">
								<Terminal size={11} />
							</div>
							<div>
								<h5 class="font-sans text-[10px] font-bold text-white/90">Backend & Services</h5>
								<p class="text-[9px] text-muted-foreground/85 leading-normal mt-0.5">Python refactorings, service state monitoring, test scripts, and automated canon drift corrections.</p>
							</div>
						</div>
						<!-- Orchestration -->
						<div class="flex gap-2.5 items-start">
							<div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#D97757]/10 border border-[#D97757]/20 text-[#D97757]">
								<ShieldCheck size={11} />
							</div>
							<div>
								<h5 class="font-sans text-[10px] font-bold text-white/90">System Orchestration</h5>
								<p class="text-[9px] text-muted-foreground/85 leading-normal mt-0.5">Files Linear tickets, manages worker dispatches via `cc_handoff` prompts, and verifies deployed services.</p>
							</div>
						</div>
						<!-- Git & PR -->
						<div class="flex gap-2.5 items-start">
							<div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#D97757]/10 border border-[#D97757]/20 text-[#D97757]">
								<BookOpen size={11} />
							</div>
							<div>
								<h5 class="font-sans text-[10px] font-bold text-white/90">Git Workflow Autonomy</h5>
								<p class="text-[9px] text-muted-foreground/85 leading-normal mt-0.5">Standalone PR execution, local pre-commit/governance gate checks, and standing self-merge authority.</p>
							</div>
						</div>
					</div>
				</section>

				<!-- How to request -->
				<footer class="mt-4 pl-1.5 rounded-sm bg-[#D97757]/5 border border-[#D97757]/15 p-2.5">
					<div class="flex items-center gap-1.5 text-[#D97757]">
						<Play size={10} />
						<span class="font-mono text-[9px] font-bold uppercase tracking-wider">Operator Request Protocol</span>
					</div>
					<p class="mt-1 font-mono text-[9px] text-muted-foreground leading-normal">
						Just state the task, a ticket ID, or a feature request. CC will pre-flight check, branch off main, execute, locally verify, and open a PR.
					</p>
				</footer>
			</article>

			<!-- Antigravity Profile Card -->
			<article class="relative overflow-hidden rounded-sm border border-border/60 bg-surface/40 p-4 transition-all duration-300 hover:border-border/100">
				<!-- Brand left accent stripe -->
				<div class="absolute top-0 bottom-0 left-0 w-[3px] bg-[#AD89EB]"></div>
				
				<!-- Header info -->
				<header class="flex items-start justify-between gap-4 pl-1.5 pb-2.5 border-b border-border/40">
					<div>
						<div class="flex items-center gap-2">
							<h3 class="font-sans text-sm font-bold text-white leading-tight">Antigravity</h3>
							<span class="rounded bg-[#AD89EB]/15 px-1 py-0.5 font-mono text-[8px] font-bold text-[#AD89EB] border border-[#AD89EB]/30 uppercase tracking-wider">AGY</span>
						</div>
						<p class="mt-0.5 font-mono text-[9px] text-muted-foreground uppercase tracking-widest">Systems Architect & Design Partner</p>
					</div>
					<div class="text-right">
						<span class="block font-mono text-[8px] text-muted-foreground/80">Model</span>
						<span class="font-mono text-xs font-semibold text-white/95">Gemini 3.5 Flash</span>
					</div>
				</header>

				<!-- Bio description -->
				<div class="mt-2.5 pl-1.5">
					<p class="text-xs text-muted-foreground leading-relaxed">
						The alternative-reasoning and large-context specialist. Processes complete service architectures in one context window, handles image/visual inputs, and pressure-tests logical decisions.
					</p>
				</div>

				<!-- Capabilities breakdown -->
				<section class="mt-3.5 pl-1.5 flex flex-col gap-2.5">
					<h4 class="font-mono text-[9px] font-bold uppercase tracking-wider text-white/80">Core Capabilities</h4>
					<div class="grid grid-cols-1 gap-2">
						<!-- Alternative Reasoning -->
						<div class="flex gap-2.5 items-start">
							<div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#AD89EB]/10 border border-[#AD89EB]/20 text-[#AD89EB]">
								<Sparkles size={11} />
							</div>
							<div>
								<h5 class="font-sans text-[10px] font-bold text-white/90">Alternative Reasoning</h5>
								<p class="text-[9px] text-muted-foreground/85 leading-normal mt-0.5">Approaches architecture from diverse angles. Pressure-tests settled solutions to discover hidden edge-cases.</p>
							</div>
						</div>
						<!-- Large Context -->
						<div class="flex gap-2.5 items-start">
							<div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#AD89EB]/10 border border-[#AD89EB]/20 text-[#AD89EB]">
								<BookOpen size={11} />
							</div>
							<div>
								<h5 class="font-sans text-[10px] font-bold text-white/90">Large-Context Audits</h5>
								<p class="text-[9px] text-muted-foreground/85 leading-normal mt-0.5">Reads entire repositories in a single pass. Ideal for deep codebase search and system-wide audits.</p>
							</div>
						</div>
						<!-- Interactive Git -->
						<div class="flex gap-2.5 items-start">
							<div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#AD89EB]/10 border border-[#AD89EB]/20 text-[#AD89EB]">
								<MessageSquare size={11} />
							</div>
							<div>
								<h5 class="font-sans text-[10px] font-bold text-white/90">Interactive Co-working</h5>
								<p class="text-[9px] text-muted-foreground/85 leading-normal mt-0.5">Operates with full interactive session privilege to track tasks in Linear and manage the PR close-out cycle.</p>
							</div>
						</div>
						<!-- Generalist Coding -->
						<div class="flex gap-2.5 items-start">
							<div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#AD89EB]/10 border border-[#AD89EB]/20 text-[#AD89EB]">
								<Terminal size={11} />
							</div>
							<div>
								<h5 class="font-sans text-[10px] font-bold text-white/90">Multidisciplinary Coding</h5>
								<p class="text-[9px] text-muted-foreground/85 leading-normal mt-0.5">Highly responsive frontend craft (HTML/CSS design engineering) and solid scripting across Python, JS, PowerShell, SQL.</p>
							</div>
						</div>
					</div>
				</section>

				<!-- How to request -->
				<footer class="mt-4 pl-1.5 rounded-sm bg-[#AD89EB]/5 border border-[#AD89EB]/15 p-2.5">
					<div class="flex items-center gap-1.5 text-[#AD89EB]">
						<Play size={10} />
						<span class="font-mono text-[9px] font-bold uppercase tracking-wider">Operator Request Protocol</span>
					</div>
					<p class="mt-1 font-mono text-[9px] text-muted-foreground leading-normal">
						Target AGY for second opinions, complex logic critiques, visual UI/UX audits, or cross-repo structural refactoring dispatches.
					</p>
				</footer>
			</article>
		</div>
	{/if}
</div>
