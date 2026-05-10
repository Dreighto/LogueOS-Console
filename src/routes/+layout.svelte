<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Play, Cpu, Activity, MessageSquare, Settings } from 'lucide-svelte';

	let { children } = $props();

	const tabs = [
		{ name: 'Runs', path: '/', icon: Play },
		{ name: 'Workers', path: '/workers', icon: Cpu },
		{ name: 'Activity', path: '/activity', icon: Activity },
		{ name: 'Ask', path: '/ask', icon: MessageSquare },
		{ name: 'Settings', path: '/settings', icon: Settings }
	] as const;
</script>

<div
	class="mx-auto flex h-[100dvh] max-w-[480px] flex-col overflow-hidden border-x border-border bg-background text-foreground shadow-2xl"
	style="padding-top: env(safe-area-inset-top, 0px);"
>
	<!-- Top Bar -->
	<header
		class="z-10 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md"
	>
		<div class="flex items-center gap-2">
			<h1 class="font-sans text-lg font-bold tracking-tight">LogueOS Console</h1>
			<span
				class="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
				>v1a</span
			>
		</div>
	</header>

	<!-- Main Content. pb is bottom-nav height (76px) + safe-area-inset-bottom for the
	     iPhone home indicator (34pt portrait on iPhone 16 Pro Max). Without this the
	     last item in any feed gets covered by the nav + iOS home bar. -->
	<main
		class="flex-1 overflow-y-auto p-4"
		style="padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px));"
	>
		{@render children()}
	</main>

	<!-- Bottom Navigation. padding-bottom = design padding (12px) + safe-area-inset-bottom
	     so the home indicator's translucent overlay sits below our content, not on top
	     of the tab labels. iOS auto-tints the indicator based on background luminance. -->
	<nav
		class="fixed bottom-0 left-1/2 z-20 w-full max-w-[480px] -translate-x-1/2 border-t border-border bg-background/90 px-2 backdrop-blur-lg"
		style="padding-top: 12px; padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));"
	>
		<div class="flex items-center justify-around">
			{#each tabs as tab (tab.path)}
				<a
					href={resolve(tab.path)}
					aria-current={page.url.pathname === tab.path ? 'page' : undefined}
					class="group relative flex flex-col items-center gap-1 transition-colors duration-200"
					class:text-cta={page.url.pathname === tab.path}
					class:text-muted-foreground={page.url.pathname !== tab.path}
				>
					<tab.icon
						size={20}
						class="transition-transform duration-200 group-hover:scale-110"
					/>
					<span class="font-sans text-[10px] font-medium uppercase tracking-wider">{tab.name}</span>

					{#if page.url.pathname === tab.path}
						<div
							class="absolute -bottom-3 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-cta shadow-[0_0_8px_rgba(163,230,53,0.5)]"
						></div>
					{/if}
				</a>
			{/each}
		</div>
	</nav>
</div>

<style>
	:global(html) {
		/* dvh-aware so 100dvh in the container reflects the actual visible viewport
		   on iOS where the address bar contracts/expands. */
		height: 100%;
	}
	:global(body) {
		/* Match the locked design token (bg). The home indicator on iPhone is
		   translucent and adapts tint to background luminance, so this dark color
		   gives the auto-light home-bar treatment. */
		background-color: #0d1117;
		/* Disable the rubber-band overscroll on the document so the bottom nav
		   doesn't bounce off-screen when the user pulls past the end of the feed.
		   Inner scroll containers (main) keep their overflow-y behavior. */
		overscroll-behavior-y: none;
	}
</style>
