<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { resolve, base } from '$app/paths';
	import { onNavigate } from '$app/navigation';
	import {
		Home,
		Cpu,
		Activity,
		ListChecks,
		Brain,
		MessageSquare,
		Settings,
		DollarSign,
		AlertOctagon,
		Pause,
		RefreshCw,
		Power
	} from 'lucide-svelte';
	import { fly, fade } from 'svelte/transition';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import type { LayoutData } from './$types';
	import type { KillSwitchState } from '$lib/types/kill-switch';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// Use SvelteKit's typed route IDs (the const-asserted tuples) so resolve()
	// type-checks. SvelteKit 2.59 generates these from the file-system routes
	// and rejects bare-string route IDs at the type level.
	const tabs = [
		{ name: 'Home', path: '/', icon: Home },
		{ name: 'Team', path: '/workers', icon: Cpu },
		{ name: 'Activity', path: '/activity', icon: Activity },
		{ name: 'Triage', path: '/runs/triage', icon: ListChecks },
		{ name: 'Memory', path: '/memory', icon: Brain },
		{ name: 'Chat', path: '/chat', icon: MessageSquare }
	] as const;

	// Seed kill-switch state from SSR. Client polls so the header stays in
	// sync with on-disk reality between navigations — important because the
	// halt file can be touched by any process on the box, not just the
	// Console's own toggle UI. Poll interval is fixed at 5s to keep the
	// header responsive without piling load; the per-page polling stays on
	// its own (longer) cadence.
	function getInitialKS() {
		return data.killSwitch;
	}
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

	// ── Header style (chat surfaces only) ───────────────────────────────────
	// page.url.pathname includes the SvelteKit paths.base ('/console'), so we
	// compare against the full path. Two modes:
	//   'immersive' — /chat and /chat/preview: full-bleed, NO global chrome
	//                 at all. The page owns its own viewport.
	//   'full'      — everything else.
	// .endsWith() is defensive against future base changes.
	const headerStyle = $derived(
		page.url.pathname.endsWith('/chat') || page.url.pathname.endsWith('/chat/preview')
			? 'immersive'
			: 'full'
	);

	// ── View transitions ─────────────────────────────────────────────────────
	// Butter-smooth, hardware-accelerated view transitions for route swaps (native GPU view-transitions)
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head>
	<link rel="manifest" href="{base}/manifest.webmanifest" />
</svelte:head>

{#if headerStyle === 'immersive'}
	<!-- Conversational OS surface (V2): no global chrome at all. The page
	     owns its own viewport, header, composer, everything. Layout just
	     provides safe-area-aware full-bleed canvas. -->
	<div class="flex min-h-[100dvh] flex-col bg-background text-foreground">
		{@render children()}
		<ToastContainer />
	</div>
{:else}
	<div
		data-sveltekit-preload-data="hover"
		class="mx-auto flex h-[100dvh] max-w-[480px] flex-col overflow-hidden border-x border-border bg-background text-foreground shadow-2xl sm:max-w-[640px] md:max-w-[820px] lg:max-w-[960px]"
		style="padding-top: env(safe-area-inset-top, 0px);"
	>
		<!-- Full header — all non-chat routes. Chat ('/chat') uses the immersive
		     branch above and renders no global header at all. -->
		<header
			class="z-30 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md"
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
				<h1 class="font-sans text-lg font-bold tracking-tight text-white">LogueOS Console</h1>
			</div>

			<div class="flex items-center gap-1">
				{#if killSwitch.active}
					<!-- Kill-switch live indicator. Tappable so the operator can jump
					     straight to /settings to clear it, no matter which tab they
					     are on. The aria-live region announces the state change for
					     screen readers when the indicator first appears. -->
					<a
						href={resolve('/settings')}
						aria-live="assertive"
						in:fade={{ duration: 300 }}
						class="active-trigger flex items-center gap-1.5 rounded-md border border-status-red/50 bg-status-red/10 px-2 py-1 font-mono text-xs font-bold tracking-widest text-status-red uppercase transition-colors hover:bg-status-red/20"
					>
						<AlertOctagon size={12} aria-hidden="true" />
						<span>Halt</span>
					</a>
				{/if}
				<!-- Usage and Settings are occasional meta screens, kept out of the
				     five-tab bottom nav and reachable from here instead. -->
				<a
					href={resolve('/usage')}
					aria-label="API usage"
					aria-current={page.url.pathname.endsWith('/usage') ? 'page' : undefined}
					class="active-trigger flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-surface"
					class:text-cta={page.url.pathname.endsWith('/usage')}
					class:text-muted-foreground={!page.url.pathname.endsWith('/usage')}
				>
					<DollarSign size={18} aria-hidden="true" />
				</a>
				<a
					href={resolve('/settings')}
					aria-label="Settings"
					aria-current={page.url.pathname.endsWith('/settings') ? 'page' : undefined}
					class="active-trigger flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-surface"
					class:text-cta={page.url.pathname.endsWith('/settings')}
					class:text-muted-foreground={!page.url.pathname.endsWith('/settings')}
				>
					<Settings size={18} aria-hidden="true" />
				</a>
			</div>
		</header>

		<!-- Global Command Bar -->
		<div
			class="z-20 flex items-center gap-2 border-b border-border bg-surface/50 px-4 py-1.5 backdrop-blur-sm"
		>
			<span class="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
				>System</span
			>
			<div class="h-3 w-px bg-border"></div>
			<button
				class="active-trigger flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold tracking-widest text-foreground uppercase transition-colors hover:bg-white/5"
			>
				<Pause size={10} />
				Pause
			</button>
			<button
				class="active-trigger flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold tracking-widest text-foreground uppercase transition-colors hover:bg-white/5"
			>
				<RefreshCw size={10} />
				Sync
			</button>
			<div class="flex-1"></div>
			<button
				class="active-trigger flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold tracking-widest text-status-amber uppercase transition-colors hover:bg-status-amber/10"
			>
				<Power size={10} />
				Restart
			</button>
		</div>

		<!-- Main Content.
	     Optimized for PWA: The container is now the scroll parent, and the nav
	     is part of the flex flow, ensuring it sits at the true bottom.
	     Page transitions: fly in from the right/left or simple fade. -->
		<main class="custom-scrollbar relative flex-1 overflow-x-hidden overflow-y-auto">
			{#key page.url.pathname}
				<div class="h-full p-4">
					{@render children()}
				</div>
			{/key}
		</main>

		<!-- Bottom Navigation. Compact 32px height for PWA — maximises content area. -->
		<nav
			class="z-20 w-full border-t border-border bg-background/95 backdrop-blur-xl"
			style="padding-bottom: env(safe-area-inset-bottom, 0px);"
		>
			<div class="flex h-8 items-center justify-around overflow-hidden">
				{#each tabs as tab (tab.path)}
					<a
						href={resolve(tab.path)}
						aria-current={page.url.pathname === tab.path ? 'page' : undefined}
						class="group active-trigger relative flex h-full flex-1 items-center justify-center transition-colors duration-200"
						class:text-cta={page.url.pathname === tab.path}
						class:text-muted-foreground={page.url.pathname !== tab.path}
					>
						<tab.icon
							size={18}
							class="transition-all duration-300 {page.url.pathname === tab.path
								? 'scale-110'
								: 'scale-100 group-hover:scale-110 group-active:scale-95'}"
						/>

						{#if page.url.pathname === tab.path}
							<div
								in:fly={{ y: 4, duration: 150 }}
								class="absolute bottom-0 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-cta shadow-[0_0_8px_rgba(163,230,53,1)]"
							></div>
						{/if}
					</a>
				{/each}
			</div>
		</nav>

		<ToastContainer />
	</div>
{/if}

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
		background-color: #050505;
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
		background: #27272a;
		border-radius: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: #3f3f46;
	}
</style>
