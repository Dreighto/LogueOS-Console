<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { resolve, base } from '$app/paths';
	import { Play, Cpu, Activity, Brain, MessageSquare, Terminal, Settings, AlertOctagon } from 'lucide-svelte';
	import type { LayoutData } from './$types';
	import type { KillSwitchState } from '$lib/types/kill-switch';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// Use SvelteKit's typed route IDs (the const-asserted tuples) so resolve()
	// type-checks. SvelteKit 2.59 generates these from the file-system routes
	// and rejects bare-string route IDs at the type level.
	const tabs = [
		{ name: 'Runs', path: '/', icon: Play },
		{ name: 'Workers', path: '/workers', icon: Cpu },
		{ name: 'Activity', path: '/activity', icon: Activity },
		{ name: 'Memory', path: '/memory', icon: Brain },
		{ name: 'Ask', path: '/ask', icon: MessageSquare },
		{ name: 'Terminal', path: '/terminal/cc-con', icon: Terminal },
		{ name: 'Settings', path: '/settings', icon: Settings }
	] as const;

	// Seed kill-switch state from SSR. Client polls so the header stays in
	// sync with on-disk reality between navigations — important because the
	// halt file can be touched by any process on the box, not just the
	// Console's own toggle UI. Poll interval is fixed at 5s to keep the
	// header responsive without piling load; the per-page polling stays on
	// its own (longer) cadence.
	function getInitialKS() { return data.killSwitch; }
	let killSwitch = $state<KillSwitchState>(getInitialKS());
	const HEADER_POLL_MS = 5000;

	$effect(() => {
		killSwitch = data.killSwitch;
	});

	async function refreshKillSwitch() {
		try {
			const resp = await fetch(resolve('/api/kill-switch'));
			if (!resp.ok) return;
			killSwitch = (await resp.json()) as KillSwitchState;
		} catch {
			// Silent — the indicator either holds its last good value or
			// stays CLEAR. Settings page surfaces the real error if the
			// operator opens it.
		}
	}

	$effect(() => {
		const interval = setInterval(() => {
			if (document.visibilityState === 'visible') refreshKillSwitch();
		}, HEADER_POLL_MS);
		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') refreshKillSwitch();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	});

	// Terminal routes want every pixel — the ttyd iframe is the experience.
	// Hide header + nav so the embedded terminal can use the full viewport.
	const onTerminalRoute = $derived(page.url.pathname.includes('/terminal/'));
</script>

<svelte:head>
	{#if !onTerminalRoute}
		<link rel="manifest" href="{base}/manifest.webmanifest" />
	{/if}
</svelte:head>

<div
	class="mx-auto flex h-[100dvh] max-w-[480px] flex-col overflow-hidden border-x border-border bg-background text-foreground shadow-2xl"
	style="padding-top: env(safe-area-inset-top, 0px);"
>
	<!-- Top Bar -->
	{#if !onTerminalRoute}
	<header
		class="z-10 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md"
	>
		<div class="flex items-center gap-2">
			<!-- Operator-supplied LogueOS logo. resolve() honors kit.paths.base
			     so the src is correctly prefixed with /console/ when served
			     behind tailscale/IP. Using favicon.png (192x192, ~5KB) instead
			     of the 1024x1024 source — plenty for a 28x28 header display
			     even at iPhone 3x DPR. h-7 keeps the logo visually balanced
			     with the text-lg heading. alt is empty because the heading
			     next to it is the accessible label — avoids screen-reader
			     duplication. -->
			<img src="{base}/favicon.png" alt="" width="28" height="28" class="h-7 w-7 shrink-0" />
			<h1 class="font-sans text-lg font-bold tracking-tight">LogueOS Console</h1>
			<span
				class="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
				>v1a</span
			>
		</div>

		{#if killSwitch.active}
			<!-- Kill-switch live indicator. Tappable so the operator can jump
			     straight to /settings to clear it, no matter which tab they
			     are on. The aria-live region announces the state change for
			     screen readers when the indicator first appears. -->
			<a
				href={resolve('/settings')}
				aria-live="assertive"
				class="flex items-center gap-1.5 rounded-md border border-red-500/50 bg-red-500/10 px-2 py-1 font-mono text-[10px] font-bold tracking-widest text-red-300 uppercase transition-colors hover:bg-red-500/20"
			>
				<AlertOctagon size={12} aria-hidden="true" />
				<span>Halt</span>
			</a>
		{/if}
	</header>
	{/if}

	<!-- Main Content.
	     Optimized for PWA: The container is now the scroll parent, and the nav
	     is part of the flex flow, ensuring it sits at the true bottom. -->
	<main
		class="flex-1 overflow-y-auto custom-scrollbar"
		class:p-4={!onTerminalRoute}
	>
		{@render children()}
	</main>

	{#if !onTerminalRoute}
	<!-- Bottom Navigation. Hard-reset to 44px fixed height.
	     Removes all vertical padding and relies on flex-centering. -->
	<nav
		class="z-20 w-full border-t border-border bg-background/95 backdrop-blur-xl"
		style="padding-bottom: env(safe-area-inset-bottom, 0px);"
	>
		<div class="flex h-11 items-center justify-around overflow-hidden">
			{#each tabs as tab (tab.path)}
				<a
					href={resolve(tab.path)}
					aria-current={page.url.pathname === tab.path ? 'page' : undefined}
					class="relative flex h-full flex-1 items-center justify-center transition-colors duration-200"
					class:text-cta={page.url.pathname === tab.path}
					class:text-muted-foreground={page.url.pathname !== tab.path}
				>
					<tab.icon size={20} class="transition-transform duration-200 group-hover:scale-110" />

					{#if page.url.pathname === tab.path}
						<div
							class="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-cta shadow-[0_0_10px_rgba(163,230,53,1)]"
						></div>
					{/if}
				</a>
			{/each}
		</div>
	</nav>
	{/if}
</div>

<style>
	:global(html) {
		/* dvh-aware so 100dvh in the container reflects the actual visible viewport
		   on iOS where the address bar contracts/expands. */
		height: 100%;
		overflow: hidden;
	}
	:global(body) {
		/* Match the locked design token (bg). The home indicator on iPhone is
		   translucent and adapts tint to background luminance, so this dark color
		   gives the auto-light home-bar treatment. */
		background-color: #0d1117;
		height: 100%;
		overflow: hidden;
	}

	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: #30363d;
		border-radius: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: #484f58;
	}
</style>
