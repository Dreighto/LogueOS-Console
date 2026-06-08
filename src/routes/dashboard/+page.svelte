<script lang="ts">
	/**
	 * LogueOS — System Command Deck (MOCKUP)
	 * ----------------------------------------------------------------------
	 * A single-screen "mission control" mockup answering, at a glance:
	 *   • Is the whole system healthy?      (vitals row + services rail)
	 *   • Who's working and on what?        (worker fleet)
	 *   • Is throughput normal?             (24h dispatch chart)
	 *   • Where is the money going?         (spend-by-worker bars)
	 *   • What needs me right now?          (attention rail + live feed)
	 *
	 * This route is a DESIGN MOCKUP: every value below is static sample data,
	 * not a live feed. It carries no +page.server.ts and hits no API, so it
	 * renders standalone for visual review. It deliberately does NOT touch the
	 * shipped "/" Today screen or the global nav.
	 *
	 * Visual language per the `operator-console-ui` skill: high density,
	 * 1px borders over shadows, mono labels, 4/8px rhythm, state-encoded color
	 * from the @theme registry (status-*, worker-*, cta).
	 */
	import {
		Activity,
		Cpu,
		Server,
		GitMerge,
		DollarSign,
		AlertTriangle,
		CheckCircle2,
		Clock,
		Zap,
		ArrowUpRight,
		ArrowDownRight,
		Radio,
		Power
	} from 'lucide-svelte';

	// ── Mock clock ───────────────────────────────────────────────────────────
	// A ticking deck clock sells the "live instrument" feel without any data
	// dependency. Guarded behind visibility so it idles in a background tab.
	let now = $state('—');
	function paintClock() {
		now = new Date().toLocaleTimeString('en-US', { hour12: false });
	}
	$effect(() => {
		paintClock();
		const id = setInterval(() => {
			if (document.visibilityState === 'visible') paintClock();
		}, 1000);
		return () => clearInterval(id);
	});

	// ── Vitals (top KPI strip) ───────────────────────────────────────────────
	type Trend = 'up' | 'down' | 'flat';
	interface Vital {
		label: string;
		value: string;
		unit?: string;
		delta?: string;
		trend: Trend;
		accent: string; // text-status-* / text-cta
		spark: number[];
	}
	const vitals: Vital[] = [
		{
			label: 'Workers Active',
			value: '3',
			unit: '/ 4',
			delta: '+1',
			trend: 'up',
			accent: 'text-status-blue',
			spark: [1, 2, 1, 3, 2, 3, 3, 4, 3, 3]
		},
		{
			label: 'Dispatches · 24h',
			value: '41',
			delta: '+12%',
			trend: 'up',
			accent: 'text-cta',
			spark: [2, 3, 1, 4, 3, 5, 4, 6, 5, 7]
		},
		{
			label: 'Shipped Today',
			value: '17',
			delta: '+4',
			trend: 'up',
			accent: 'text-status-green',
			spark: [1, 1, 2, 2, 3, 3, 4, 4, 5, 6]
		},
		{
			label: 'Success Rate',
			value: '94',
			unit: '%',
			delta: '+2.1',
			trend: 'up',
			accent: 'text-status-green',
			spark: [88, 90, 89, 91, 92, 90, 93, 92, 94, 94]
		},
		{
			label: 'Median Cycle',
			value: '6.2',
			unit: 'm',
			delta: '−0.8m',
			trend: 'down',
			accent: 'text-status-purple',
			spark: [9, 8, 8, 7, 7, 6, 7, 6, 6, 6]
		},
		{
			label: 'Spend Today',
			value: '12.84',
			unit: 'USD',
			delta: '+3.10',
			trend: 'up',
			accent: 'text-status-amber',
			spark: [2, 4, 5, 6, 7, 8, 9, 10, 11, 13]
		}
	];

	// ── Worker fleet ─────────────────────────────────────────────────────────
	interface Worker {
		id: string;
		label: string;
		role: string;
		color: string; // raw hex from worker registry for the accent rail
		state: 'busy' | 'idle' | 'offline';
		ticket?: string;
		step?: string;
		branch?: string;
		progress?: number; // 0..1
		model: string;
		sinceLabel: string;
	}
	const fleet: Worker[] = [
		{
			id: 'claude-code',
			label: 'CC · Claude Code',
			role: 'VP Ops · backend',
			color: '#8b5cf6',
			state: 'busy',
			ticket: 'LOS-148',
			step: 'Writing Code',
			branch: 'feat/dashboard-mockup',
			progress: 0.62,
			model: 'opus-4.8',
			sinceLabel: '4m'
		},
		{
			id: 'gemini',
			label: 'GMI · Gemini',
			role: 'frontend',
			color: '#3b82f6',
			state: 'busy',
			ticket: 'LOS-145',
			step: 'Running Tests',
			branch: 'fix/composer-safe-area',
			progress: 0.81,
			model: 'gemini-3-pro',
			sinceLabel: '11m'
		},
		{
			id: 'agy',
			label: 'AGY · Antigravity',
			role: 'frontend',
			color: '#06b6d4',
			state: 'busy',
			ticket: 'LOS-150',
			step: 'Opening PR',
			branch: 'feat/usage-sparklines',
			progress: 0.93,
			model: 'gemini-3-flash',
			sinceLabel: '2m'
		},
		{
			id: 'dpsk',
			label: 'DPSK · DeepSeek',
			role: 'backend',
			color: '#6b7280',
			state: 'idle',
			model: 'deepseek-v3',
			sinceLabel: 'idle 38m'
		}
	];

	// ── Services health ──────────────────────────────────────────────────────
	interface Service {
		name: string;
		port: number;
		state: 'up' | 'degraded' | 'down';
		latency: string;
		detail: string;
	}
	const services: Service[] = [
		{ name: 'MCP Gateway', port: 19100, state: 'up', latency: '12ms', detail: 'profiles ok' },
		{ name: 'Dispatch Listener', port: 18900, state: 'up', latency: '8ms', detail: '3 in flight' },
		{ name: 'Sentinel', port: 0, state: 'up', latency: '—', detail: 'no alerts' },
		{ name: 'n8n', port: 5678, state: 'degraded', latency: '410ms', detail: '1 retry queued' },
		{ name: 'Console', port: 18768, state: 'up', latency: '6ms', detail: 'this surface' },
		{ name: 'Companion', port: 18769, state: 'up', latency: '15ms', detail: 'Sully online' }
	];

	// ── 24h throughput (dispatches per 2h bucket) ────────────────────────────
	const throughput = [1, 0, 2, 3, 2, 4, 3, 5, 6, 4, 7, 6];
	const throughputMax = Math.max(...throughput);

	// ── Spend by worker (today, USD) ─────────────────────────────────────────
	interface SpendRow {
		label: string;
		color: string;
		usd: number;
	}
	const spend: SpendRow[] = [
		{ label: 'CC · Claude', color: '#8b5cf6', usd: 6.42 },
		{ label: 'GMI · Gemini', color: '#3b82f6', usd: 3.18 },
		{ label: 'AGY · Antigrav', color: '#06b6d4', usd: 2.04 },
		{ label: 'DPSK', color: '#6b7280', usd: 1.2 }
	];
	const spendTotal = spend.reduce((a, b) => a + b.usd, 0);

	// ── Attention rail (needs operator) ──────────────────────────────────────
	interface Attn {
		kind: 'FAILED' | 'REVIEW' | 'ESCALATE';
		ticket: string;
		summary: string;
		ago: string;
	}
	const attention: Attn[] = [
		{
			kind: 'ESCALATE',
			ticket: 'LOS-141',
			summary: 'AMBIGUOUS_SPEC — needs a routing decision on the voice fallback chain',
			ago: '22m ago'
		},
		{
			kind: 'FAILED',
			ticket: 'PRO-204',
			summary: 'Governance gate red — missing "what does this allow" section',
			ago: '1h ago'
		},
		{
			kind: 'REVIEW',
			ticket: 'LOS-145',
			summary: 'CodeRabbit left 2 comments on the safe-area fix',
			ago: '14m ago'
		}
	];

	// ── Live activity feed ───────────────────────────────────────────────────
	interface FeedRow {
		kind: 'ship' | 'dispatch' | 'observe' | 'merge';
		who: string;
		text: string;
		ago: string;
	}
	const feed: FeedRow[] = [
		{
			kind: 'ship',
			who: 'CC',
			text: 'LOS-147 shipped — voice/talkback rune module (#161)',
			ago: '9m'
		},
		{
			kind: 'dispatch',
			who: 'ROOM',
			text: 'LOS-150 dispatched → AGY (usage sparklines)',
			ago: '14m'
		},
		{
			kind: 'merge',
			who: 'GMI',
			text: 'PR #160 merged — MODEL_CHOICES catalog extracted',
			ago: '31m'
		},
		{
			kind: 'observe',
			who: 'CC',
			text: 'Tier-0 observation logged: stale-base check caught drift',
			ago: '38m'
		},
		{ kind: 'ship', who: 'GMI', text: 'LOS-144 shipped — shared chat-ui types (#159)', ago: '52m' },
		{ kind: 'dispatch', who: 'ROOM', text: 'PRO-204 dispatched → DPSK (canon sweep)', ago: '1h' }
	];

	// ── Inline SVG helpers (no chart lib) ────────────────────────────────────
	// Sparkline: maps a value series to a polyline path inside a WxH box.
	function sparkPath(values: number[], w: number, h: number, pad = 1): string {
		if (values.length < 2) return '';
		const min = Math.min(...values);
		const max = Math.max(...values);
		const span = max - min || 1;
		const step = (w - pad * 2) / (values.length - 1);
		return values
			.map((v, i) => {
				const x = pad + i * step;
				const y = pad + (h - pad * 2) * (1 - (v - min) / span);
				return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	}

	const trendIcon = { up: ArrowUpRight, down: ArrowDownRight, flat: Radio } as const;

	function dotClass(state: string): string {
		if (state === 'up') return 'bg-status-green shadow-[0_0_8px_rgba(34,197,94,0.7)]';
		if (state === 'degraded') return 'bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.7)]';
		return 'bg-status-red shadow-[0_0_8px_rgba(239,68,68,0.7)]';
	}

	function feedAccent(kind: FeedRow['kind']): string {
		return kind === 'ship'
			? 'text-status-green'
			: kind === 'merge'
				? 'text-status-purple'
				: kind === 'dispatch'
					? 'text-status-blue'
					: 'text-muted-foreground';
	}
</script>

<svelte:head>
	<title>Command Deck · LogueOS</title>
</svelte:head>

<div class="flex flex-col gap-3 font-mono text-foreground">
	<!-- ── Deck header ──────────────────────────────────────────────────── -->
	<header class="flex items-center justify-between border-b border-border pb-2">
		<div class="flex items-center gap-2">
			<span class="relative flex h-2 w-2">
				<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-cta opacity-60"
				></span>
				<span class="relative inline-flex h-2 w-2 rounded-full bg-cta"></span>
			</span>
			<h1 class="text-xs font-bold tracking-[0.25em] text-foreground uppercase">Command Deck</h1>
			<span
				class="rounded-sm border border-status-grey/30 px-1.5 py-0.5 text-[9px] tracking-widest text-muted-foreground uppercase"
				>mockup</span
			>
		</div>
		<div class="flex items-center gap-3">
			<span class="hidden text-[10px] tracking-widest text-muted-foreground tabular-nums sm:inline"
				>{now} UTC</span
			>
			<span
				class="flex items-center gap-1.5 rounded-sm border border-status-green/30 bg-status-green/5 px-2 py-0.5 text-[10px] font-bold tracking-widest text-status-green uppercase"
			>
				<Power size={10} /> Nominal
			</span>
		</div>
	</header>

	<!-- ── Vitals strip ─────────────────────────────────────────────────── -->
	<section class="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
		{#each vitals as v (v.label)}
			{@const TI = trendIcon[v.trend]}
			<div
				class="group flex flex-col gap-1.5 rounded-sm border border-border bg-surface p-2.5 transition-colors hover:border-border/80"
			>
				<span class="text-[9px] leading-none tracking-widest text-muted-foreground uppercase"
					>{v.label}</span
				>
				<div class="flex items-baseline gap-1">
					<span class="text-xl leading-none font-bold {v.accent} tabular-nums">{v.value}</span>
					{#if v.unit}<span class="text-[10px] text-muted-foreground">{v.unit}</span>{/if}
				</div>
				<div class="flex items-center justify-between">
					<span
						class="flex items-center gap-0.5 text-[10px] tabular-nums {v.trend === 'down' &&
						v.label === 'Median Cycle'
							? 'text-status-green'
							: v.trend === 'up'
								? 'text-status-green'
								: 'text-status-red'}"
					>
						<TI size={10} />{v.delta}
					</span>
					<svg viewBox="0 0 56 16" class="h-4 w-14 overflow-visible" aria-hidden="true">
						<path
							d={sparkPath(v.spark, 56, 16)}
							fill="none"
							stroke="currentColor"
							stroke-width="1.25"
							class="{v.accent} opacity-70"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</div>
			</div>
		{/each}
	</section>

	<!-- ── Fleet + Services ─────────────────────────────────────────────── -->
	<section class="grid gap-3 lg:grid-cols-3">
		<!-- Worker fleet -->
		<div class="flex flex-col gap-2 lg:col-span-2">
			<div
				class="flex items-center justify-between text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
			>
				<span class="flex items-center gap-1.5"><Cpu size={12} /> Worker Fleet</span>
				<span>3 busy · 1 idle</span>
			</div>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each fleet as w (w.id)}
					<div
						class="relative flex flex-col gap-2 overflow-hidden rounded-sm border border-border bg-surface p-2.5 transition-colors {w.state ===
						'busy'
							? 'hover:border-border/60'
							: 'opacity-70'}"
					>
						<!-- worker color accent rail -->
						<span
							class="absolute top-0 left-0 h-full w-0.5"
							style="background-color: {w.color}; box-shadow: 0 0 12px {w.color}55;"
						></span>
						<div class="flex items-start justify-between pl-1.5">
							<div class="flex flex-col">
								<span class="text-xs font-bold tracking-tight text-foreground">{w.label}</span>
								<span class="text-[9px] tracking-wider text-muted-foreground uppercase"
									>{w.role}</span
								>
							</div>
							<span
								class="rounded-sm px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase {w.state ===
								'busy'
									? 'bg-status-blue/10 text-status-blue'
									: w.state === 'idle'
										? 'bg-status-grey/10 text-muted-foreground'
										: 'bg-status-red/10 text-status-red'}">{w.state}</span
							>
						</div>

						{#if w.state === 'busy'}
							<div class="flex flex-col gap-1 pl-1.5">
								<div class="flex items-center justify-between text-[10px]">
									<span class="font-bold text-status-blue">{w.ticket}</span>
									<span class="text-muted-foreground">{w.sinceLabel}</span>
								</div>
								<span class="truncate text-[10px] text-foreground">{w.step}</span>
								<span class="truncate text-[9px] text-muted-foreground italic">{w.branch}</span>
								<!-- progress -->
								<div class="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-background">
									<div
										class="h-full rounded-full"
										style="width: {Math.round(
											(w.progress ?? 0) * 100
										)}%; background-color: {w.color};"
									></div>
								</div>
							</div>
						{:else}
							<div class="flex items-center gap-1.5 pl-1.5 text-[10px] text-muted-foreground">
								<Clock size={11} />{w.sinceLabel}
							</div>
						{/if}
						<div
							class="flex items-center gap-1 pl-1.5 text-[9px] tracking-wider text-muted-foreground uppercase"
						>
							<Zap size={9} />{w.model}
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Services rail -->
		<div class="flex flex-col gap-2">
			<div
				class="flex items-center justify-between text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
			>
				<span class="flex items-center gap-1.5"><Server size={12} /> Services</span>
				<span class="text-status-amber">1 degraded</span>
			</div>
			<div class="flex flex-col gap-1 rounded-sm border border-border bg-surface p-1.5">
				{#each services as svc (svc.name)}
					<div
						class="flex items-center gap-2 rounded-sm px-1.5 py-1.5 transition-colors hover:bg-background/60"
					>
						<span class="h-2 w-2 shrink-0 rounded-full {dotClass(svc.state)}"></span>
						<div class="flex min-w-0 flex-1 flex-col">
							<span class="truncate text-[11px] font-bold text-foreground">{svc.name}</span>
							<span class="truncate text-[9px] text-muted-foreground">{svc.detail}</span>
						</div>
						<div class="flex flex-col items-end">
							<span class="text-[10px] text-foreground tabular-nums">{svc.latency}</span>
							{#if svc.port > 0}
								<span class="text-[9px] text-muted-foreground tabular-nums">:{svc.port}</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- ── Throughput + Spend ───────────────────────────────────────────── -->
	<section class="grid gap-3 lg:grid-cols-3">
		<!-- Throughput chart -->
		<div class="flex flex-col gap-2 lg:col-span-2">
			<div
				class="flex items-center justify-between text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
			>
				<span class="flex items-center gap-1.5"
					><Activity size={12} /> Dispatch Throughput · 24h</span
				>
				<span class="text-cta">peak {throughputMax}/2h</span>
			</div>
			<div class="rounded-sm border border-border bg-surface p-3">
				<div class="flex h-28 items-end gap-1">
					{#each throughput as t, i (i)}
						<div class="group flex h-full flex-1 flex-col justify-end gap-1">
							<div
								class="w-full rounded-sm bg-cta/70 transition-all group-hover:bg-cta"
								style="height: {throughputMax ? (t / throughputMax) * 100 : 0}%; min-height: 2px;"
							></div>
						</div>
					{/each}
				</div>
				<div class="mt-2 flex justify-between text-[9px] tracking-wider text-muted-foreground">
					<span>−24h</span><span>−18h</span><span>−12h</span><span>−6h</span><span>now</span>
				</div>
			</div>
		</div>

		<!-- Spend by worker -->
		<div class="flex flex-col gap-2">
			<div
				class="flex items-center justify-between text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
			>
				<span class="flex items-center gap-1.5"><DollarSign size={12} /> Spend · Today</span>
				<span class="text-status-amber tabular-nums">${spendTotal.toFixed(2)}</span>
			</div>
			<div class="flex flex-col gap-2.5 rounded-sm border border-border bg-surface p-3">
				{#each spend as row (row.label)}
					<div class="flex flex-col gap-1">
						<div class="flex items-center justify-between text-[10px]">
							<span class="flex items-center gap-1.5 text-foreground">
								<span class="h-2 w-2 rounded-full" style="background-color: {row.color};"></span>
								{row.label}
							</span>
							<span class="text-muted-foreground tabular-nums">${row.usd.toFixed(2)}</span>
						</div>
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-background">
							<div
								class="h-full rounded-full"
								style="width: {(row.usd / spendTotal) * 100}%; background-color: {row.color};"
							></div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- ── Attention + Live feed ────────────────────────────────────────── -->
	<section class="grid gap-3 lg:grid-cols-3">
		<!-- Attention rail -->
		<div class="flex flex-col gap-2">
			<div
				class="flex items-center justify-between text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
			>
				<span class="flex items-center gap-1.5 text-status-amber"
					><AlertTriangle size={12} /> Needs You</span
				>
				<span>{attention.length}</span>
			</div>
			<div class="flex flex-col gap-1.5">
				{#each attention as a (a.ticket)}
					<div
						class="flex flex-col gap-1 rounded-sm border p-2 {a.kind === 'FAILED' ||
						a.kind === 'ESCALATE'
							? 'border-status-red/30 bg-status-red/[0.04]'
							: 'border-status-amber/30 bg-status-amber/[0.04]'}"
					>
						<div class="flex items-center justify-between">
							<span
								class="text-[9px] font-bold tracking-widest uppercase {a.kind === 'FAILED' ||
								a.kind === 'ESCALATE'
									? 'text-status-red'
									: 'text-status-amber'}">{a.kind}</span
							>
							<span class="text-[9px] text-muted-foreground">{a.ago}</span>
						</div>
						<span class="text-[11px] font-bold text-foreground">{a.ticket}</span>
						<span class="text-[10px] leading-snug text-muted-foreground">{a.summary}</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- Live feed -->
		<div class="flex flex-col gap-2 lg:col-span-2">
			<div
				class="flex items-center justify-between text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
			>
				<span class="flex items-center gap-1.5"><Radio size={12} /> Live Activity</span>
				<span class="flex items-center gap-1 text-cta"
					><span class="h-1.5 w-1.5 animate-pulse rounded-full bg-cta"></span> streaming</span
				>
			</div>
			<div class="flex flex-col rounded-sm border border-border bg-surface">
				{#each feed as row, i (i)}
					<div
						class="flex items-center gap-2.5 border-b border-border/60 px-2.5 py-2 transition-colors last:border-b-0 hover:bg-background/50"
					>
						{#if row.kind === 'ship'}
							<CheckCircle2 size={13} class="shrink-0 text-status-green" />
						{:else if row.kind === 'merge'}
							<GitMerge size={13} class="shrink-0 text-status-purple" />
						{:else if row.kind === 'dispatch'}
							<Zap size={13} class="shrink-0 text-status-blue" />
						{:else}
							<Activity size={13} class="shrink-0 text-muted-foreground" />
						{/if}
						<span
							class="w-10 shrink-0 text-[9px] font-bold tracking-widest uppercase {feedAccent(
								row.kind
							)}">{row.who}</span
						>
						<span class="min-w-0 flex-1 truncate text-[11px] text-foreground">{row.text}</span>
						<span class="shrink-0 text-[9px] text-muted-foreground tabular-nums">{row.ago}</span>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<p class="pt-1 text-center text-[9px] tracking-widest text-muted-foreground/60 uppercase">
		Static mockup · sample data · not a live feed
	</p>
</div>
