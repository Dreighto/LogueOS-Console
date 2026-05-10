<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { Play, Cpu, Activity, MessageSquare, Settings } from 'lucide-svelte';

	let { children } = $props();

	const tabs = [
		{ name: 'Runs', path: '/', icon: Play },
		{ name: 'Workers', path: '/workers', icon: Cpu },
		{ name: 'Activity', path: '/activity', icon: Activity },
		{ name: 'Ask', path: '/ask', icon: MessageSquare },
		{ name: 'Settings', path: '/settings', icon: Settings }
	];
</script>

<div class="flex flex-col h-screen max-w-[480px] mx-auto bg-background text-foreground border-x border-border shadow-2xl overflow-hidden">
	<!-- Top Bar -->
	<header class="flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-md z-10">
		<div class="flex items-center gap-2">
			<h1 class="text-lg font-bold font-sans tracking-tight">LogueOS Console</h1>
			<span class="px-1.5 py-0.5 rounded bg-surface border border-border text-[10px] font-mono text-muted-foreground uppercase tracking-widest">v1a</span>
		</div>
	</header>

	<!-- Main Content -->
	<main class="flex-1 overflow-y-auto p-4 pb-24">
		{@render children()}
	</main>

	<!-- Bottom Navigation -->
	<nav class="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-background/90 backdrop-blur-lg border-t border-border px-2 py-3 z-20">
		<div class="flex justify-around items-center">
			{#each tabs as tab}
				<a
					href={tab.path}
					class="flex flex-col items-center gap-1 group relative transition-colors duration-200"
					class:text-cta={page.url.pathname === tab.path}
					class:text-muted-foreground={page.url.pathname !== tab.path}
				>
					<tab.icon size={20} class="transition-transform duration-200 group-hover:scale-110" />
					<span class="text-[10px] font-medium font-sans uppercase tracking-wider">{tab.name}</span>
					
					{#if page.url.pathname === tab.path}
						<div class="absolute -bottom-3 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-cta rounded-full shadow-[0_0_8px_rgba(163,230,53,0.5)]"></div>
					{/if}
				</a>
			{/each}
		</div>
	</nav>
</div>

<style>
	:global(body) {
		background-color: #050505; /* Deepest black for surroundings */
	}
</style>
