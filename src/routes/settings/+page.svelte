<script lang="ts">
	import { ShieldAlert, RefreshCcw, Signal, Terminal, Activity } from 'lucide-svelte';
	import ConnectionPill from '$lib/components/ConnectionPill.svelte';

	let { data } = $props();

	// In a real implementation, we'd have an action to toggle this
	let killSwitchActive = $state(false);

	const toggleKillSwitch = () => {
		// Placeholder for actual API call
		killSwitchActive = !killSwitchActive;
	};
</script>

<div class="flex flex-col gap-8">
	<!-- Header Section -->
	<div class="flex items-center justify-between">
		<h1 class="font-sans text-2xl font-bold tracking-tight">Settings</h1>
		<div class="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1">
			<Activity size={12} class="text-cta" />
			<span class="font-mono text-[10px] font-bold text-muted-foreground uppercase">LIVE_FEED</span>
		</div>
	</div>

	<!-- System Connectivity Section (LOS-70) -->
	<section class="flex flex-col gap-4">
		<div class="flex items-center gap-2 px-1">
			<Signal size={18} class="text-muted-foreground" />
			<h2 class="font-sans text-sm font-bold tracking-widest text-muted-foreground uppercase">
				Connectivity
			</h2>
		</div>

		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
			{#each data.services as service}
				<ConnectionPill id={service.id} name={service.name} status={service.status} />
			{/each}
		</div>
	</section>

	<!-- Global Controls Section -->
	<section class="flex flex-col gap-4">
		<div class="flex items-center gap-2 px-1">
			<ShieldAlert size={18} class="text-muted-foreground" />
			<h2 class="font-sans text-sm font-bold tracking-widest text-muted-foreground uppercase">
				Governance
			</h2>
		</div>

		<div class="rounded-xl border border-border bg-surface p-4">
			<div class="flex items-center justify-between">
				<div class="flex flex-col gap-1">
					<span class="font-sans text-sm font-bold text-foreground">System Kill Switch</span>
					<p class="max-w-[240px] font-sans text-xs leading-relaxed text-muted-foreground">
						Immediately halts all autonomous worker dispatch across the system.
					</p>
				</div>
				<button
					onclick={toggleKillSwitch}
					class="relative h-6 w-11 rounded-full transition-colors duration-200 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background focus:outline-none"
					class:bg-status-red={killSwitchActive}
					class:bg-border={!killSwitchActive}
				>
					<span
						class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ease-in-out"
						class:translate-x-6={killSwitchActive}
						class:translate-x-1={!killSwitchActive}
					></span>
				</button>
			</div>
		</div>
	</section>

	<!-- Advanced Info -->
	<section class="flex flex-col gap-4">
		<div class="flex items-center gap-2 px-1">
			<Terminal size={18} class="text-muted-foreground" />
			<h2 class="font-sans text-sm font-bold tracking-widest text-muted-foreground uppercase">
				Environment
			</h2>
		</div>

		<div class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
			<div class="flex items-center justify-between border-b border-border/50 pb-2">
				<span class="font-mono text-[10px] text-muted-foreground uppercase">Poll Interval</span>
				<span class="font-mono text-xs font-bold text-foreground"
					>{data.config.pollIntervalMs}ms</span
				>
			</div>
			<div class="flex items-center justify-between pt-1">
				<span class="font-mono text-[10px] text-muted-foreground uppercase">Feed Limit</span>
				<span class="font-mono text-xs font-bold text-foreground">{data.config.feedLimit} runs</span
				>
			</div>
		</div>
	</section>

	<div class="flex justify-center pt-4">
		<button
			disabled
			class="flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground opacity-50"
		>
			<RefreshCcw size={14} />
			RELOAD CONFIG
		</button>
	</div>
</div>
