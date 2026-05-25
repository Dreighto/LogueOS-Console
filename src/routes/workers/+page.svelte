<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import type { ActiveJob, WorkerNote, Lane } from '$lib/types/worker';
	import { dispatchLanes, laneLabel, workerShortLabel } from '$lib/config/workers';
	import {
		AlertCircle,
		Cpu,
		Terminal,
		Play,
		Sparkles,
		BookOpen,
		ShieldCheck,
		MessageSquare,
		Code2,
		Network,
		Activity,
		Ban
	} from 'lucide-svelte';
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
		subtitle={activeTab === 'jobs'
			? 'Live dispatch work, by lane.'
			: 'AI agent registry & capabilities.'}
	>
		<LivePill />
	</PageHeader>

	<!-- Tab Switcher (Glassmorphic Density) -->
	<div class="grid grid-cols-2 gap-1 rounded-sm border border-border bg-muted/40 p-0.5">
		<button
			type="button"
			class="active-trigger cursor-pointer rounded-xs py-1 text-center font-mono text-[10px] font-bold tracking-wider uppercase transition-all duration-200 {activeTab ===
			'jobs'
				? 'border border-border/80 bg-surface text-cta shadow-sm'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => (activeTab = 'jobs')}
		>
			Live Dispatch
		</button>
		<button
			type="button"
			class="active-trigger cursor-pointer rounded-xs py-1 text-center font-mono text-[10px] font-bold tracking-wider uppercase transition-all duration-200 {activeTab ===
			'roster'
				? 'border border-border/80 bg-surface text-cta shadow-sm'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => (activeTab = 'roster')}
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
							<li>
								{workerShortLabel(note.worker_id)}: last session ended with {note.last_exit_status}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</div>
	{:else}
		<!-- Premium AI Roster & Capabilities Cards -->
		<div class="flex flex-col gap-5" transition:slide={{ duration: 150 }}>
			<!-- Claude Code Profile Card -->
			<article
				class="relative overflow-hidden rounded-sm border border-border/60 bg-surface/40 p-4 transition-all duration-300 hover:border-border/100"
			>
				<!-- Brand left accent stripe -->
				<div class="absolute top-0 bottom-0 left-0 w-[3px] bg-[#D97757]"></div>

				<!-- Header info -->
				<header
					class="flex items-start justify-between gap-4 border-b border-border/40 pb-2.5 pl-1.5"
				>
					<div>
						<div class="flex items-center gap-2">
							<h3 class="font-sans text-sm leading-tight font-bold text-white">Claude Code</h3>
							<span
								class="rounded border border-[#D97757]/30 bg-[#D97757]/15 px-1 py-0.5 font-mono text-[8px] font-bold tracking-wider text-[#D97757] uppercase"
								>CC</span
							>
						</div>
						<p class="mt-0.5 font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
							VP Ops & Backend Lead
						</p>
					</div>
					<div class="text-right">
						<span class="block font-mono text-[8px] text-muted-foreground/80">Model</span>
						<span class="font-mono text-xs font-semibold text-white/95">Claude Opus 4.7</span>
					</div>
				</header>

				<!-- Bio description -->
				<div class="mt-2.5 pl-1.5">
					<p class="text-xs leading-relaxed text-muted-foreground">
						The lead execution steward and backend specialist. Responsible for rigorous, multi-file
						code modifications, backend architecture, testing, and keeping standard workflow systems
						aligned.
					</p>
				</div>

				<!-- Capabilities breakdown -->
				<section class="mt-3.5 flex flex-col gap-3 pl-1.5">
					<h4 class="font-mono text-[9px] font-bold tracking-wider text-white/80 uppercase">
						Core Capabilities
					</h4>
					<div class="grid grid-cols-1 gap-3">
						<!-- Code & Feature Work -->
						<div class="flex items-start gap-2.5">
							<div
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#D97757]/20 bg-[#D97757]/10 text-[#D97757]"
							>
								<Code2 size={11} />
							</div>
							<div class="flex-1">
								<h5 class="font-sans text-[10px] font-bold text-white/90">
									Code & Feature Work (LogueOS Console)
								</h5>
								<ul class="mt-1 space-y-0.5 font-mono text-[9px] text-muted-foreground/85">
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span>Build and modify SvelteKit components, pages, stores, and API routes</span
										>
									</li>
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span
											>Fix bugs across the frontend and any backend service touching this repo</span
										>
									</li>
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span>Review PRs and respond to CodeRabbit/Bugbot findings</span>
									</li>
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span>Refactor, rename, clean up — scoped to what you ask</span>
									</li>
								</ul>
							</div>
						</div>

						<!-- Ops & Infra -->
						<div class="flex items-start gap-2.5">
							<div
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#D97757]/20 bg-[#D97757]/10 text-[#D97757]"
							>
								<Terminal size={11} />
							</div>
							<div class="flex-1">
								<h5 class="font-sans text-[10px] font-bold text-white/90">Ops & Infra</h5>
								<ul class="mt-1 space-y-0.5 font-mono text-[9px] text-muted-foreground/85">
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span
											>Restart services autonomously (dispatch_listener, console, sentinel, etc.)</span
										>
									</li>
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span
											>Sync Linear ticket states after ships (CONFIRMED_WORKING → Done, no batching)</span
										>
									</li>
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span>Patch canon and CLAUDE.md drift (typos, broken links, stale paths)</span>
									</li>
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span
											>Run CI gates locally before opening PRs to catch failures before they hit
											GitHub</span
										>
									</li>
								</ul>
							</div>
						</div>

						<!-- Dispatch & Coordination -->
						<div class="flex items-start gap-2.5">
							<div
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#D97757]/20 bg-[#D97757]/10 text-[#D97757]"
							>
								<Network size={11} />
							</div>
							<div class="flex-1">
								<h5 class="font-sans text-[10px] font-bold text-white/90">
									Dispatch & Coordination
								</h5>
								<ul class="mt-1 space-y-0.5 font-mono text-[9px] text-muted-foreground/85">
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span
											>File Linear tickets and dispatch workers (CC or GMI) via the LogueOS dispatch
											listener</span
										>
									</li>
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span>Draft PR bodies that pass the Governance Change Gate on first push</span>
									</li>
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span>Run ticket sweeps and canon sweeps (3-day cadence)</span>
									</li>
								</ul>
							</div>
						</div>

						<!-- Investigation & Verification -->
						<div class="flex items-start gap-2.5">
							<div
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#D97757]/20 bg-[#D97757]/10 text-[#D97757]"
							>
								<Activity size={11} />
							</div>
							<div class="flex-1">
								<h5 class="font-sans text-[10px] font-bold text-white/90">
									Investigation & Verification
								</h5>
								<ul class="mt-1 space-y-0.5 font-mono text-[9px] text-muted-foreground/85">
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span>Read logs, tail sentinel/stall recovery state, triage alerts</span>
									</li>
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span>Verify deploys actually took (not just 'code merged')</span>
									</li>
									<li class="flex items-start gap-1">
										<span class="text-[#D97757]/70 select-none">•</span>
										<span
											>Smoke-test runtime paths — hit live endpoints, run test suites, capture
											evidence</span
										>
									</li>
								</ul>
							</div>
						</div>
					</div>
				</section>

				<!-- Operational Constraints -->
				<section class="mt-4 flex flex-col gap-2 border-t border-border/30 pt-3 pl-1.5">
					<h4
						class="flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-wider text-status-red/80 uppercase"
					>
						<Ban size={10} class="text-status-red" />
						Operational Constraints (What I won't do)
					</h4>
					<ul class="space-y-1 font-mono text-[9px] text-muted-foreground/85">
						<li class="flex items-start gap-1.5">
							<span class="font-bold text-status-red/70">—</span>
							<span>Force-push, reset --hard, drop branches, or any irreversible git op</span>
						</li>
						<li class="flex items-start gap-1.5">
							<span class="font-bold text-status-red/70">—</span>
							<span>Push to remote unless explicitly asked by the Operator</span>
						</li>
						<li class="flex items-start gap-1.5">
							<span class="font-bold text-[#D97757]/70">—</span>
							<span>Touch .mcp.json or card_catalog.db</span>
						</li>
						<li class="flex items-start gap-1.5">
							<span class="font-bold text-[#D97757]/70">—</span>
							<span>Make production-impacting decisions on a hunch when canon is silent</span>
						</li>
					</ul>
				</section>

				<!-- How to request -->
				<footer class="mt-4 rounded-sm border border-[#D97757]/15 bg-[#D97757]/5 p-2.5 pl-1.5">
					<div class="flex items-center gap-1.5 text-[#D97757]">
						<Play size={10} />
						<span class="font-mono text-[9px] font-bold tracking-wider uppercase"
							>Operator Request Protocol</span
						>
					</div>
					<p class="mt-1 font-mono text-[9px] leading-normal text-muted-foreground">
						Just state the task, a ticket ID, or a feature request. CC will pre-flight check, branch
						off main, execute, locally verify, and open a PR.
					</p>
				</footer>
			</article>

			<!-- Antigravity Profile Card -->
			<article
				class="relative overflow-hidden rounded-sm border border-border/60 bg-surface/40 p-4 transition-all duration-300 hover:border-border/100"
			>
				<!-- Brand left accent stripe -->
				<div class="absolute top-0 bottom-0 left-0 w-[3px] bg-[#AD89EB]"></div>

				<!-- Header info -->
				<header
					class="flex items-start justify-between gap-4 border-b border-border/40 pb-2.5 pl-1.5"
				>
					<div>
						<div class="flex items-center gap-2">
							<h3 class="font-sans text-sm leading-tight font-bold text-white">Antigravity</h3>
							<span
								class="rounded border border-[#AD89EB]/30 bg-[#AD89EB]/15 px-1 py-0.5 font-mono text-[8px] font-bold tracking-wider text-[#AD89EB] uppercase"
								>AGY</span
							>
						</div>
						<p class="mt-0.5 font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
							Systems Architect & Design Partner
						</p>
					</div>
					<div class="text-right">
						<span class="block font-mono text-[8px] text-muted-foreground/80">Model</span>
						<span class="font-mono text-xs font-semibold text-white/95">Gemini 3.5 Flash</span>
					</div>
				</header>

				<!-- Bio description -->
				<div class="mt-2.5 pl-1.5">
					<p class="text-xs leading-relaxed text-muted-foreground">
						The alternative-reasoning and large-context specialist. Processes complete service
						architectures in one context window, handles image/visual inputs, and pressure-tests
						logical decisions.
					</p>
				</div>

				<!-- Capabilities breakdown -->
				<section class="mt-3.5 flex flex-col gap-2.5 pl-1.5">
					<h4 class="font-mono text-[9px] font-bold tracking-wider text-white/80 uppercase">
						Core Capabilities
					</h4>
					<div class="grid grid-cols-1 gap-2">
						<!-- Alternative Reasoning -->
						<div class="flex items-start gap-2.5">
							<div
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#AD89EB]/20 bg-[#AD89EB]/10 text-[#AD89EB]"
							>
								<Sparkles size={11} />
							</div>
							<div>
								<h5 class="font-sans text-[10px] font-bold text-white/90">Alternative Reasoning</h5>
								<p class="mt-0.5 text-[9px] leading-normal text-muted-foreground/85">
									Approaches architecture from diverse angles. Pressure-tests settled solutions to
									discover hidden edge-cases.
								</p>
							</div>
						</div>
						<!-- Large Context -->
						<div class="flex items-start gap-2.5">
							<div
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#AD89EB]/20 bg-[#AD89EB]/10 text-[#AD89EB]"
							>
								<BookOpen size={11} />
							</div>
							<div>
								<h5 class="font-sans text-[10px] font-bold text-white/90">Large-Context Audits</h5>
								<p class="mt-0.5 text-[9px] leading-normal text-muted-foreground/85">
									Reads entire repositories in a single pass. Ideal for deep codebase search and
									system-wide audits.
								</p>
							</div>
						</div>
						<!-- Interactive Git -->
						<div class="flex items-start gap-2.5">
							<div
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#AD89EB]/20 bg-[#AD89EB]/10 text-[#AD89EB]"
							>
								<MessageSquare size={11} />
							</div>
							<div>
								<h5 class="font-sans text-[10px] font-bold text-white/90">
									Interactive Co-working
								</h5>
								<p class="mt-0.5 text-[9px] leading-normal text-muted-foreground/85">
									Operates with full interactive session privilege to track tasks in Linear and
									manage the PR close-out cycle.
								</p>
							</div>
						</div>
						<!-- Generalist Coding -->
						<div class="flex items-start gap-2.5">
							<div
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#AD89EB]/20 bg-[#AD89EB]/10 text-[#AD89EB]"
							>
								<Terminal size={11} />
							</div>
							<div>
								<h5 class="font-sans text-[10px] font-bold text-white/90">
									Multidisciplinary Coding
								</h5>
								<p class="mt-0.5 text-[9px] leading-normal text-muted-foreground/85">
									Highly responsive frontend craft (HTML/CSS design engineering) and solid scripting
									across Python, JS, PowerShell, SQL.
								</p>
							</div>
						</div>
					</div>
				</section>

				<!-- How to request -->
				<footer class="mt-4 rounded-sm border border-[#AD89EB]/15 bg-[#AD89EB]/5 p-2.5 pl-1.5">
					<div class="flex items-center gap-1.5 text-[#AD89EB]">
						<Play size={10} />
						<span class="font-mono text-[9px] font-bold tracking-wider uppercase"
							>Operator Request Protocol</span
						>
					</div>
					<p class="mt-1 font-mono text-[9px] leading-normal text-muted-foreground">
						Target AGY for second opinions, complex logic critiques, visual UI/UX audits, or
						cross-repo structural refactoring dispatches.
					</p>
				</footer>
			</article>
		</div>
	{/if}
</div>
