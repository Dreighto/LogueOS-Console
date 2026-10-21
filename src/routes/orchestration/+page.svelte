<script lang="ts">
	import { onMount } from 'svelte';
	import { 
		Cpu, 
		Activity, 
		Zap, 
		Shield, 
		Network, 
		Server, 
		Terminal, 
		Clock, 
		Box,
		GitBranch,
		Lock,
		CheckCircle2,
		AlertTriangle,
		RefreshCw
	} from 'lucide-svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import LivePill from '$lib/components/LivePill.svelte';
	import { slide, fade } from 'svelte/transition';

	// --- Mock Data ---
	const services = [
		{ name: 'Orchestrator', status: 'healthy', uptime: '12d 4h', version: 'v2.4.1' },
		{ name: 'MCP Gateway', status: 'healthy', uptime: '5d 2h', version: 'v1.8.0' },
		{ name: 'Dispatch Listener', status: 'healthy', uptime: '12d 4h', version: 'v2.0.2' },
		{ name: 'Sentinel', status: 'healthy', uptime: '12d 4h', version: 'v1.1.0' },
		{ name: 'Stall Recovery', status: 'warning', uptime: '2h 15m', version: 'v1.0.5' },
		{ name: 'Gatekeeper', status: 'healthy', uptime: '45d 1h', version: 'v3.2.0' }
	];

	const pools = [
		{ id: 'project-miru', slots: 4, busy: 2, lease: '8m left' },
		{ id: 'LogueOS-Console', slots: 2, busy: 1, lease: '15m left' },
		{ id: 'LogueOS-Orchestrator', slots: 2, busy: 0, lease: 'idle' }
	];

	const events = [
		{ ts: '10:42:01', level: 'info', msg: 'W2: Routing PRO-402 to Slot project-miru-w1 (GMI)' },
		{ ts: '10:41:58', level: 'info', msg: 'Gatekeeper: Accepted dispatch proposal for PRO-402' },
		{ ts: '10:41:45', level: 'warn', msg: 'StallRecovery: Warning - project-miru-w3 heartbeat lagging (42s)' },
		{ ts: '10:40:12', level: 'info', msg: 'Lease: Renewed Slot LogueOS-Console-w1 for 30m' },
		{ ts: '10:39:55', level: 'info', msg: 'Completion: Slot LogueOS-Orchestrator-w2 signed off (CONFIRMED_WORKING)' }
	];

	const lifecycle = [
		{ step: 'Gating', status: 'complete', worker: 'Gatekeeper' },
		{ step: 'Routing', status: 'complete', worker: 'W2 Router' },
		{ step: 'Leasing', status: 'active', worker: 'Slot Manager' },
		{ step: 'Execution', status: 'pending', worker: 'claude-code' },
		{ step: 'Validation', status: 'pending', worker: 'VP Ops' }
	];

	let logs = $state([...events]);
	let time = $state(new Date().toLocaleTimeString());

	onMount(() => {
		const interval = setInterval(() => {
			time = new Date().toLocaleTimeString();
		}, 1000);
		return () => clearInterval(interval);
	});
	// --- Section 6: Agent Capabilities & Load ---
	const agentLoad = [
		{ name: 'claude-code', load: 85, task: 'Refactoring Kernel', focus: 'Backend' },
		{ name: 'gemini-cli', load: 20, task: 'Code Audit', focus: 'Security' },
		{ name: 'agy', load: 45, task: 'UI Mockup', focus: 'Frontend' }
	];
</script>

<div class="flex flex-col gap-6 font-mono">
	<PageHeader title="Orchestration" subtitle="Kernel state & dispatch topology.">
		<LivePill />
	</PageHeader>

	<!-- Section 1: Service Grid (High Density) -->
	<section class="flex flex-col gap-2">
		<div class="flex items-center justify-between border-b border-border pb-1">
			<h2 class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Services</h2>
			<span class="text-[9px] text-muted-foreground italic">Sync: {time}</span>
		</div>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
			{#each services as service}
				<div class="flex flex-col gap-1 rounded-sm border border-border bg-surface p-2 transition-colors hover:border-border/100">
					<div class="flex items-center justify-between">
						<span class="truncate text-[10px] font-bold text-foreground">{service.name}</span>
						<div class="h-1.5 w-1.5 rounded-full {service.status === 'healthy' ? 'bg-status-green' : 'bg-status-amber'} shadow-[0_0_4px_rgba(34,197,94,0.5)] animate-pulse"></div>
					</div>
					<div class="flex justify-between text-[8px] text-muted-foreground uppercase">
						<span>{service.uptime}</span>
						<span>{service.version}</span>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- Section 2: Dispatch Pipeline Visual -->
	<section class="flex flex-col gap-2">
		<div class="flex items-center justify-between border-b border-border pb-1">
			<h2 class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Active Pipeline</h2>
			<span class="text-[9px] font-bold text-status-blue">TRACE: s-178...fa45</span>
		</div>
		<div class="relative flex justify-between gap-1 overflow-x-auto pb-2 custom-scrollbar">
			{#each lifecycle as step, i}
				<div class="flex flex-1 flex-col items-center gap-2 min-w-[70px]">
					<div class="relative flex h-8 w-8 items-center justify-center rounded-full border-2 {step.status === 'complete' ? 'border-status-green bg-status-green/10 text-status-green' : step.status === 'active' ? 'border-status-blue bg-status-blue/10 text-status-blue animate-pulse' : 'border-border bg-muted/20 text-muted-foreground'}">
						{#if step.status === 'complete'}
							<CheckCircle2 size={16} />
						{:else if step.status === 'active'}
							<Zap size={16} />
						{:else}
							<Box size={16} />
						{/if}
						
						{#if i < lifecycle.length - 1}
							<div class="absolute -right-4 top-1/2 h-[1px] w-3 bg-border"></div>
						{/if}
					</div>
					<div class="flex flex-col items-center text-center">
						<span class="text-[9px] font-bold text-foreground uppercase">{step.step}</span>
						<span class="text-[8px] text-muted-foreground">{step.worker}</span>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
		<!-- Section 3: Worktree Pools -->
		<section class="flex flex-col gap-2">
			<div class="border-b border-border pb-1">
				<h2 class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Resource Pools</h2>
			</div>
			<div class="flex flex-col gap-2">
				{#each pools as pool}
					<div class="flex flex-col gap-1.5 rounded-sm border border-border bg-surface p-2.5">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<GitBranch size={12} class="text-status-purple" />
								<span class="text-[10px] font-bold text-white">{pool.id}</span>
							</div>
							<span class="text-[9px] text-muted-foreground uppercase">{pool.busy}/{pool.slots} Busy</span>
						</div>
						
						<!-- Utilization Bar -->
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
							<div 
								class="h-full bg-status-purple transition-all duration-500" 
								style="width: {(pool.busy / pool.slots) * 100}%"
							></div>
						</div>
						
						<div class="flex items-center justify-between text-[8px] text-muted-foreground uppercase">
							<span>Pool Health: 100%</span>
							<span>Lease: {pool.lease}</span>
						</div>
					</div>
				{/each}
			</div>
		</section>

		<!-- Section 4: Event Stream (Dense) -->
		<section class="flex flex-col gap-2">
			<div class="flex items-center justify-between border-b border-border pb-1">
				<h2 class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Kernel Event Stream</h2>
				<Terminal size={10} class="text-muted-foreground" />
			</div>
			<div class="h-48 overflow-y-auto rounded-sm border border-border bg-black/40 p-2 custom-scrollbar">
				<div class="flex flex-col gap-1">
					{#each logs as log}
						<div class="flex items-start gap-2 border-l-2 {log.level === 'warn' ? 'border-status-amber' : 'border-status-blue'} pl-2 py-0.5">
							<span class="shrink-0 text-[8px] text-muted-foreground">{log.ts}</span>
							<p class="text-[9px] leading-tight text-foreground/90 break-words">{log.msg}</p>
						</div>
					{/each}
					<div class="flex items-center gap-2 pl-2 animate-pulse">
						<span class="h-1 w-1 rounded-full bg-cta"></span>
						<span class="text-[8px] text-cta italic">Listening for events...</span>
					</div>
				</div>
			</div>
		</section>
	</div>

	<!-- Section 5: System Metrics (Micro-charts/Values) -->
	<section class="flex flex-col gap-2">
		<div class="border-b border-border pb-1">
			<h2 class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Performance Metrics</h2>
		</div>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<div class="flex flex-col gap-1 rounded-sm border border-border bg-surface/40 p-2">
				<span class="text-[8px] tracking-widest text-muted-foreground uppercase">Latent Delay</span>
				<span class="text-xs font-bold text-status-green">142ms</span>
			</div>
			<div class="flex flex-col gap-1 rounded-sm border border-border bg-surface/40 p-2">
				<span class="text-[8px] tracking-widest text-muted-foreground uppercase">Token Velocity</span>
				<span class="text-xs font-bold text-status-blue">4.2k/min</span>
			</div>
			<div class="flex flex-col gap-1 rounded-sm border border-border bg-surface/40 p-2">
				<span class="text-[8px] tracking-widest text-muted-foreground uppercase">Success Rate</span>
				<span class="text-xs font-bold text-status-green">98.4%</span>
			</div>
			<div class="flex flex-col gap-1 rounded-sm border border-border bg-surface/40 p-2">
				<span class="text-[8px] tracking-widest text-muted-foreground uppercase">Uptime Score</span>
				<span class="text-xs font-bold text-white">0.9999</span>
			</div>
		</div>
	</section>

	<!-- Section 6: Agent Load & Specialization -->
	<section class="flex flex-col gap-2">
		<div class="border-b border-border pb-1">
			<h2 class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Agent Cognitive Load</h2>
		</div>
		<div class="flex flex-col gap-2">
			{#each agentLoad as agent}
				<div class="flex items-center gap-3 rounded-sm border border-border bg-surface p-2">
					<div class="flex flex-1 flex-col gap-1">
						<div class="flex items-center justify-between">
							<span class="text-[10px] font-bold text-foreground">{agent.name}</span>
							<span class="text-[8px] text-muted-foreground uppercase">{agent.focus}</span>
						</div>
						<div class="h-1 w-full rounded-full bg-muted/20">
							<div 
								class="h-full rounded-full transition-all duration-1000 {agent.load > 80 ? 'bg-status-red' : agent.load > 50 ? 'bg-status-amber' : 'bg-status-green'}"
								style="width: {agent.load}%"
							></div>
						</div>
					</div>
					<div class="flex flex-col items-end gap-1 min-w-[80px]">
						<span class="text-[9px] font-bold text-foreground uppercase truncate w-20 text-right">{agent.task}</span>
						<span class="text-[8px] text-muted-foreground uppercase">{agent.load}% Load</span>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- Footer: Control Plane -->
	<footer class="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4">
		<button class="active-trigger flex items-center justify-center gap-2 rounded-sm border border-border bg-surface py-2 text-[10px] font-bold tracking-widest text-foreground uppercase transition-colors hover:bg-muted/20">
			<Lock size={12} />
			Audit Logs
		</button>
		<button class="active-trigger flex items-center justify-center gap-2 rounded-sm border border-status-blue/50 bg-status-blue/10 py-2 text-[10px] font-bold tracking-widest text-status-blue uppercase transition-colors hover:bg-status-blue/20">
			<RefreshCw size={12} />
			Full Resync
		</button>
	</footer>
</div>

<style>
	.custom-scrollbar::-webkit-scrollbar {
		width: 3px;
		height: 3px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: #27272a;
		border-radius: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: #3f3f46;
	}
</style>
