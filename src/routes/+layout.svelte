<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Play, Cpu, Activity, MessageSquare, Settings, AlertOctagon } from 'lucide-svelte';
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
		{ name: 'Ask', path: '/ask', icon: MessageSquare },
		{ name: 'Settings', path: '/settings', icon: Settings }
	] as const;

	// Seed kill-switch state from SSR. Client polls so the header stays in
	// sync with on-disk reality between navigations — important because the
	// halt file can be touched by any process on the box, not just the
	// Console's own toggle UI. Poll interval is fixed at 5s to keep the
	// header responsive without piling load; the per-page polling stays on
	// its own (longer) cadence.
	let killSwitch = $state<KillSwitchState>(data.killSwitch);
	const HEADER_POLL_MS = 5000;

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
			<!-- Operator-supplied LogueOS logo. resolve() honors kit.paths.base
			     so the src is correctly prefixed with /console/ when served
			     behind tailscale/IP. Using favicon.png (192x192, ~5KB) instead
			     of the 1024x1024 source — plenty for a 28x28 header display
			     even at iPhone 3x DPR. h-7 keeps the logo visually balanced
			     with the text-lg heading. alt is empty because the heading
			     next to it is the accessible label — avoids screen-reader
			     duplication. -->
			<img src={resolve('/favicon.png')} alt="" width="28" height="28" class="h-7 w-7 shrink-0" />
			<h1 class="font-sans text-lg font-bold tracking-tight">LogueOS Console</h1>
			<span
				class="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase"
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
					<tab.icon size={20} class="transition-transform duration-200 group-hover:scale-110" />
					<span class="font-sans text-[10px] font-medium tracking-wider uppercase">{tab.name}</span>

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
