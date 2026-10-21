<script lang="ts">
	// Mobile analytics dashboard mockup. Entirely static/offline: sample data
	// lives in $lib/components/mobile-dashboard/data.ts, "Refresh" just
	// re-randomizes it in place. No fetch(), no API routes, no server load —
	// see that module's header comment for the rationale.
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import SpendChart from '$lib/components/mobile-dashboard/SpendChart.svelte';
	import {
		initialSnapshot,
		randomizeSnapshot,
		tallyFleetStates,
		tallyServiceStates,
		computeSuccessRate,
		computeTotalSpend,
		formatCurrency,
		formatMinutesAgo,
		type DashboardSnapshot,
		type FleetWorker,
		type ServiceHealth,
		type RunOutcome
	} from '$lib/components/mobile-dashboard/data';
	import {
		RefreshCw,
		CheckCircle2,
		XCircle,
		AlertCircle,
		Clock,
		Cpu,
		DollarSign,
		ChevronRight
	} from 'lucide-svelte';

	let snapshot = $state<DashboardSnapshot>(initialSnapshot());
	let activeView = $state<'health' | 'runs'>('health');

	let fleetTally = $derived(tallyFleetStates(snapshot.fleet));
	let serviceTally = $derived(tallyServiceStates(snapshot.services));
	let successRate = $derived(computeSuccessRate(snapshot.runs));
	let totalSpend = $derived(computeTotalSpend(snapshot.spend));

	function refresh() {
		snapshot = randomizeSnapshot(snapshot);
	}

	// --- Drawer / bottom-sheet selection ---------------------------------
	type Selection =
		| { kind: 'fleet'; item: FleetWorker }
		| { kind: 'service'; item: ServiceHealth }
		| { kind: 'run'; item: RunOutcome }
		| null;

	let selection = $state<Selection>(null);
	let drawerOpen = $state(false);

	function openDetail(sel: NonNullable<Selection>) {
		selection = sel;
		drawerOpen = true;
	}

	let drawerTitle = $derived(
		selection?.kind === 'fleet'
			? selection.item.label
			: selection?.kind === 'service'
				? selection.item.label
				: selection?.kind === 'run'
					? `${selection.item.ticket} · ${selection.item.workerLabel}`
					: undefined
	);

	// --- Presentation metadata (pure lookup tables, not app logic) --------
	const FLEET_META = {
		busy: { label: 'Busy', text: 'text-status-blue', bg: 'bg-status-blue/10', border: 'border-status-blue/30' },
		idle: {
			label: 'Idle',
			text: 'text-muted-foreground',
			bg: 'bg-muted/30',
			border: 'border-border'
		},
		error: { label: 'Error', text: 'text-status-red', bg: 'bg-status-red/10', border: 'border-status-red/30' }
	} as const;

	const SERVICE_META = {
		good: {
			label: 'Operational',
			text: 'text-status-green',
			bg: 'bg-status-green/10',
			border: 'border-status-green/30'
		},
		warning: {
			label: 'Degraded',
			text: 'text-status-amber',
			bg: 'bg-status-amber/10',
			border: 'border-status-amber/30'
		},
		critical: { label: 'Down', text: 'text-status-red', bg: 'bg-status-red/10', border: 'border-status-red/30' }
	} as const;

	const RUN_META = {
		success: { label: 'Success', text: 'text-status-green', icon: CheckCircle2 },
		failed: { label: 'Failed', text: 'text-status-red', icon: XCircle },
		running: { label: 'Running', text: 'text-status-blue', icon: Clock },
		queued: { label: 'Queued', text: 'text-muted-foreground', icon: Clock }
	} as const;

	// Shared focus-visible ring for every interactive element on this page.
	const FOCUS_RING =
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 focus-visible:ring-offset-background';
</script>

<svelte:head>
	<title>Mobile Dashboard | LogueOS Console</title>
</svelte:head>

<div class="flex flex-col gap-4">
	<PageHeader title="Mobile Dashboard" subtitle="Fleet health & run analytics — offline sample data.">
		<button
			type="button"
			onclick={refresh}
			class="active-trigger flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-surface/50 px-3 py-1.5 font-mono text-xs font-bold tracking-wider text-foreground uppercase transition-colors hover:bg-surface {FOCUS_RING}"
		>
			<RefreshCw size={14} aria-hidden="true" />
			Refresh
		</button>
	</PageHeader>

	<p class="font-mono text-[10px] text-muted-foreground" data-testid="last-updated">
		Updated {snapshot.generatedAt.toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		})}
	</p>

	<!-- Segmented view control -->
	<div
		role="tablist"
		aria-label="Dashboard view"
		class="grid grid-cols-2 gap-1 rounded-sm border border-border bg-muted/40 p-0.5"
	>
		<button
			type="button"
			role="tab"
			id="tab-health"
			aria-selected={activeView === 'health'}
			aria-controls="panel-health"
			class="active-trigger min-h-11 cursor-pointer rounded-xs py-1 text-center font-mono text-xs font-bold tracking-wider uppercase transition-all duration-200 {FOCUS_RING} {activeView ===
			'health'
				? 'border border-border/80 bg-surface text-cta shadow-sm'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => (activeView = 'health')}
		>
			Health
		</button>
		<button
			type="button"
			role="tab"
			id="tab-runs"
			aria-selected={activeView === 'runs'}
			aria-controls="panel-runs"
			class="active-trigger min-h-11 cursor-pointer rounded-xs py-1 text-center font-mono text-xs font-bold tracking-wider uppercase transition-all duration-200 {FOCUS_RING} {activeView ===
			'runs'
				? 'border border-border/80 bg-surface text-cta shadow-sm'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => (activeView = 'runs')}
		>
			Runs
		</button>
	</div>

	<!-- ── Health panel ─────────────────────────────────────────────── -->
	<div id="panel-health" role="tabpanel" aria-labelledby="tab-health" hidden={activeView !== 'health'}>
		<div class="flex flex-col gap-4">
			<div class="grid grid-cols-3 gap-2">
				<div class="flex flex-col gap-1 rounded-lg border border-status-blue/30 bg-status-blue/10 p-3">
					<span class="font-mono text-[10px] font-bold tracking-widest text-status-blue uppercase">Busy</span>
					<span class="text-lg font-bold text-foreground tabular-nums">{fleetTally.busy}</span>
				</div>
				<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
					<span class="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>Idle</span
					>
					<span class="text-lg font-bold text-foreground tabular-nums">{fleetTally.idle}</span>
				</div>
				<div class="flex flex-col gap-1 rounded-lg border border-status-red/30 bg-status-red/10 p-3">
					<span class="font-mono text-[10px] font-bold tracking-widest text-status-red uppercase">Error</span>
					<span class="text-lg font-bold text-foreground tabular-nums">{fleetTally.error}</span>
				</div>
			</div>

			<section class="flex flex-col gap-2">
				<h2 class="flex items-center gap-1.5 text-xs font-bold tracking-widest text-foreground uppercase">
					<Cpu size={12} aria-hidden="true" />
					Worker Fleet
				</h2>
				<ul class="flex flex-col gap-2">
					{#each snapshot.fleet as worker (worker.id)}
						{@const meta = FLEET_META[worker.state]}
						<li>
							<button
								type="button"
								onclick={() => openDetail({ kind: 'fleet', item: worker })}
								class="active-trigger flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-surface/30 px-3 py-2 text-left transition-colors hover:border-muted-foreground/30 {FOCUS_RING}"
							>
								<span
									class="h-2.5 w-2.5 shrink-0 rounded-full"
									style="background-color: {worker.color}"
									aria-hidden="true"
								></span>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium text-foreground">{worker.label}</span>
									<span class="block truncate font-mono text-[11px] text-muted-foreground"
										>{worker.task ?? 'No active task'}</span
									>
								</span>
								<span
									class="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider uppercase {meta.bg} {meta.text} {meta.border}"
								>
									{meta.label}
								</span>
								<ChevronRight size={16} class="shrink-0 text-muted-foreground" aria-hidden="true" />
							</button>
						</li>
					{/each}
				</ul>
			</section>

			<section class="flex flex-col gap-2">
				<h2 class="flex items-center gap-1.5 text-xs font-bold tracking-widest text-foreground uppercase">
					<AlertCircle size={12} aria-hidden="true" />
					Service Health
				</h2>
				<ul class="flex flex-col gap-2">
					{#each snapshot.services as service (service.id)}
						{@const meta = SERVICE_META[service.state]}
						<li>
							<button
								type="button"
								onclick={() => openDetail({ kind: 'service', item: service })}
								class="active-trigger flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-surface/30 px-3 py-2 text-left transition-colors hover:border-muted-foreground/30 {FOCUS_RING}"
							>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium text-foreground">{service.label}</span>
									<span class="block truncate font-mono text-[11px] text-muted-foreground"
										>{service.detail}</span
									>
								</span>
								<span
									class="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider uppercase {meta.bg} {meta.text} {meta.border}"
								>
									{meta.label}
								</span>
								<ChevronRight size={16} class="shrink-0 text-muted-foreground" aria-hidden="true" />
							</button>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	</div>

	<!-- ── Runs panel ───────────────────────────────────────────────── -->
	<div id="panel-runs" role="tabpanel" aria-labelledby="tab-runs" hidden={activeView !== 'runs'}>
		<div class="flex flex-col gap-4">
			<div class="grid grid-cols-3 gap-2">
				<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
					<span class="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>Runs</span
					>
					<span class="text-lg font-bold text-foreground tabular-nums">{snapshot.runs.length}</span>
				</div>
				<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
					<span class="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>Success</span
					>
					<span class="text-lg font-bold text-status-green tabular-nums">{successRate}%</span>
				</div>
				<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 p-3">
					<span class="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>24h Spend</span
					>
					<span class="text-lg font-bold text-foreground tabular-nums">{formatCurrency(totalSpend)}</span>
				</div>
			</div>

			<section class="flex flex-col gap-2 rounded-lg border border-border bg-surface/30 p-3">
				<h2 class="flex items-center gap-1.5 text-xs font-bold tracking-widest text-foreground uppercase">
					<DollarSign size={12} aria-hidden="true" />
					24h Spend by Worker
				</h2>
				<SpendChart spend={snapshot.spend} />
			</section>

			<section class="flex flex-col gap-2">
				<h2 class="text-xs font-bold tracking-widest text-foreground uppercase">Recent Runs</h2>
				<ul class="flex flex-col gap-2">
					{#each snapshot.runs as run (run.id)}
						{@const meta = RUN_META[run.state]}
						<li>
							<button
								type="button"
								onclick={() => openDetail({ kind: 'run', item: run })}
								class="active-trigger flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-surface/30 px-3 py-2 text-left transition-colors hover:border-muted-foreground/30 {FOCUS_RING}"
							>
								<meta.icon size={16} class="shrink-0 {meta.text}" aria-hidden="true" />
								<span class="min-w-0 flex-1">
									<span class="flex items-center gap-2">
										<span class="font-mono text-xs font-bold text-foreground uppercase">{run.ticket}</span>
										<span class="truncate font-mono text-[11px] text-muted-foreground"
											>{run.workerLabel}</span
										>
									</span>
									<span class="block truncate text-xs text-muted-foreground">{run.summary}</span>
								</span>
								<span class="shrink-0 text-right">
									<span class="block font-mono text-[10px] font-bold uppercase {meta.text}">{meta.label}</span>
									<span class="block font-mono text-[10px] text-muted-foreground"
										>{formatMinutesAgo(run.minutesAgo)}</span
									>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	</div>
</div>

<Drawer bind:show={drawerOpen} title={drawerTitle}>
	{#if selection?.kind === 'fleet'}
		{@const worker = selection.item}
		{@const meta = FLEET_META[worker.state]}
		<div class="flex flex-col gap-4">
			<div class="flex items-center gap-3">
				<span class="h-3 w-3 shrink-0 rounded-full" style="background-color: {worker.color}" aria-hidden="true"
				></span>
				<span
					class="rounded border px-2 py-0.5 font-mono text-xs font-bold tracking-wider uppercase {meta.bg} {meta.text} {meta.border}"
				>
					{meta.label}
				</span>
			</div>
			<div class="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface/30 p-3">
				<div class="flex flex-col gap-1">
					<span class="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>Worker ID</span
					>
					<span class="font-mono text-sm text-foreground">{worker.id}</span>
				</div>
				<div class="flex flex-col gap-1">
					<span class="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>Current Task</span
					>
					<span class="text-sm text-foreground">{worker.task ?? 'None'}</span>
				</div>
			</div>
			<p class="text-xs leading-relaxed text-muted-foreground">
				Sample worker slot from the offline mockup fleet. In a live build this panel would show recent
				dispatch history, session uptime, and a link to the worker's terminal.
			</p>
		</div>
	{:else if selection?.kind === 'service'}
		{@const service = selection.item}
		{@const meta = SERVICE_META[service.state]}
		<div class="flex flex-col gap-4">
			<span
				class="w-fit rounded border px-2 py-0.5 font-mono text-xs font-bold tracking-wider uppercase {meta.bg} {meta.text} {meta.border}"
			>
				{meta.label}
			</span>
			<div class="rounded-lg border border-border bg-surface/30 p-3">
				<span class="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
					>Status Detail</span
				>
				<p class="mt-1 text-sm text-foreground">{service.detail}</p>
			</div>
			<p class="text-xs leading-relaxed text-muted-foreground">
				Sample service row. A live build would surface uptime history and a restart action here.
			</p>
		</div>
	{:else if selection?.kind === 'run'}
		{@const run = selection.item}
		{@const meta = RUN_META[run.state]}
		<div class="flex flex-col gap-4">
			<div class="flex items-center gap-2">
				<meta.icon size={18} class={meta.text} aria-hidden="true" />
				<span class="font-mono text-xs font-bold tracking-wider uppercase {meta.text}">{meta.label}</span>
			</div>
			<div class="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface/30 p-3">
				<div class="flex flex-col gap-1">
					<span class="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>Worker</span
					>
					<span class="text-sm text-foreground" style="color: {run.workerColor}">{run.workerLabel}</span>
				</div>
				<div class="flex flex-col gap-1">
					<span class="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>Duration</span
					>
					<span class="font-mono text-sm text-foreground tabular-nums">{run.durationMin}m</span>
				</div>
				<div class="flex flex-col gap-1">
					<span class="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>Started</span
					>
					<span class="font-mono text-sm text-foreground">{formatMinutesAgo(run.minutesAgo)}</span>
				</div>
				<div class="flex flex-col gap-1">
					<span class="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>Ticket</span
					>
					<span class="font-mono text-sm text-foreground">{run.ticket}</span>
				</div>
			</div>
			<p class="text-sm leading-relaxed text-foreground">{run.summary}</p>
		</div>
	{/if}
</Drawer>
