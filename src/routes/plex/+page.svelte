<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import { 
		Activity, 
		Film, 
		Tv, 
		Music, 
		Play,
		ArrowUpRight,
		ArrowDownRight,
		RefreshCw
	} from 'lucide-svelte';
	import { fade } from 'svelte/transition';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const iconMap: Record<string, any> = {
		Activity,
		Film,
		Tv,
		Music
	};

	function getStatusColor(status: string) {
		return status === 'online' ? 'text-status-green' : 'text-status-red';
	}
</script>

<svelte:head>
	<title>Plex Dashboard | LogueOS Console</title>
</svelte:head>

<div class="flex flex-col gap-4">
	<PageHeader 
		title="Plex Server" 
		subtitle="{data.server.name} ({data.server.address})"
	>
		<div class="flex items-center gap-2">
			<div class="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1">
				<div class="h-1.5 w-1.5 animate-pulse rounded-full bg-status-green"></div>
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Online</span>
			</div>
			<button class="flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-surface/50 text-muted-foreground hover:bg-surface hover:text-foreground transition-colors">
				<RefreshCw size={14} />
			</button>
		</div>
	</PageHeader>

	<!-- Key Stats Grid -->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		{#each data.stats as stat}
			{@const Icon = iconMap[stat.icon]}
			<Card class="flex flex-col gap-1">
				<div class="flex items-center justify-between">
					<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">{stat.label}</span>
					<Icon size={12} class="text-muted-foreground" />
				</div>
				<div class="flex items-baseline gap-2">
					<span class="text-lg font-bold tabular-nums text-foreground">{stat.value}</span>
					{#if stat.trend === 'up'}
						<ArrowUpRight size={12} class="text-status-green" />
					{:else if stat.trend === 'down'}
						<ArrowDownRight size={12} class="text-status-red" />
					{/if}
				</div>
			</Card>
		{/each}
	</div>

	<!-- Main Content: Two Columns -->
	<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
		<!-- Left: Active Streams & System -->
		<div class="lg:col-span-2 flex flex-col gap-4">
			<!-- Active Streams -->
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between px-1">
					<h2 class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Active Streams</h2>
					<span class="font-mono text-[10px] text-muted-foreground">{data.activeStreams.length} Playing</span>
				</div>
				
				<div class="flex flex-col gap-1.5">
					{#each data.activeStreams as stream (stream.id)}
						<Card class="flex flex-col gap-2">
							<div class="flex items-start justify-between">
								<div class="flex flex-col gap-0.5">
									<span class="font-mono text-xs font-bold text-foreground">{stream.content}</span>
									<span class="text-[10px] text-muted-foreground">{stream.user} • {stream.device}</span>
								</div>
								<div class="flex flex-col items-end gap-0.5">
									<span class="font-mono text-[10px] text-foreground">{stream.quality}</span>
									<span class="text-[10px] text-muted-foreground">{stream.transcode}</span>
								</div>
							</div>
							
							<div class="flex flex-col gap-1">
								<div class="relative h-1 w-full overflow-hidden rounded-full bg-surface-muted/30 border border-border/20">
									<div 
										class="absolute top-0 left-0 h-full bg-status-green transition-all duration-500"
										style="width: {stream.progress}%"
									></div>
								</div>
								<div class="flex justify-between font-mono text-[9px] text-muted-foreground uppercase tracking-tighter">
									<span>{stream.progress}% Complete</span>
									<span>Playing</span>
								</div>
							</div>
						</Card>
					{/each}
				</div>
			</div>

			<!-- System Resources -->
			<div class="flex flex-col gap-2">
				<h2 class="px-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">System Resources</h2>
				<Card class="grid grid-cols-3 gap-4">
					<div class="flex flex-col gap-2">
						<div class="flex items-center justify-between">
							<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">CPU</span>
							<span class="font-mono text-[10px] text-foreground">{data.system.cpu}%</span>
						</div>
						<div class="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-muted/30 border border-border/20">
							<div class="absolute top-0 left-0 h-full bg-status-amber" style="width: {data.system.cpu}%"></div>
						</div>
					</div>
					<div class="flex flex-col gap-2">
						<div class="flex items-center justify-between">
							<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">RAM</span>
							<span class="font-mono text-[10px] text-foreground">{data.system.memory}%</span>
						</div>
						<div class="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-muted/30 border border-border/20">
							<div class="absolute top-0 left-0 h-full bg-status-green" style="width: {data.system.memory}%"></div>
						</div>
					</div>
					<div class="flex flex-col gap-2">
						<div class="flex items-center justify-between">
							<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Disk</span>
							<span class="font-mono text-[10px] text-foreground">{data.system.storage}%</span>
						</div>
						<div class="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-muted/30 border border-border/20">
							<div class="absolute top-0 left-0 h-full bg-status-red" style="width: {data.system.storage}%"></div>
						</div>
					</div>
				</Card>
			</div>
		</div>

		<!-- Right: Recent Activity -->
		<div class="flex flex-col gap-2">
			<h2 class="px-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Recent Activity</h2>
			<div class="rounded-sm border border-border bg-surface/30 p-2 flex flex-col gap-0.5">
				{#each data.recent as activity (activity.id)}
					<div class="flex items-start gap-2 border-b border-border/20 last:border-0 py-2">
						<div class="mt-0.5 shrink-0 text-muted-foreground">
							{#if activity.type === 'added'}
								<ArrowDownRight size={12} class="text-status-green" />
							{:else}
								<Play size={12} class="text-status-blue" />
							{/if}
						</div>
						<div class="flex flex-col gap-0.5 min-w-0">
							<p class="font-mono text-[11px] leading-tight text-foreground truncate">
								{#if activity.type === 'added'}
									<span class="text-status-green font-bold">Added:</span> {activity.content}
								{:else}
									<span class="text-status-blue font-bold">{activity.user}</span> watched {activity.content}
								{/if}
							</p>
							<span class="text-[9px] text-muted-foreground uppercase tracking-widest">{activity.time}</span>
						</div>
					</div>
				{/each}
			</div>
			
			<!-- Server Info -->
			<div class="mt-2 flex flex-col gap-2">
				<h2 class="px-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Server Info</h2>
				<Card class="flex flex-col gap-1.5 font-mono text-[10px]">
					<div class="flex justify-between">
						<span class="text-muted-foreground">Version</span>
						<span class="text-foreground">{data.server.version}</span>
					</div>
					<div class="flex justify-between">
						<span class="text-muted-foreground">Uptime</span>
						<span class="text-foreground">{data.server.uptime}</span>
					</div>
					<div class="flex justify-between">
						<span class="text-muted-foreground">Local IP</span>
						<span class="text-foreground">{data.server.address}</span>
					</div>
				</Card>
			</div>
		</div>
	</div>
</div>

<style>
	:global(.text-status-blue) { color: var(--color-status-blue); }
</style>
