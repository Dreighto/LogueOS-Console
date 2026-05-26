<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { resolve, base } from '$app/paths';
	import { onNavigate } from '$app/navigation';
	import { Home, Cpu, Activity, Brain, MessageSquare, Settings, DollarSign, AlertOctagon, Pause, RefreshCw, Power, RotateCcw } from 'lucide-svelte';
	import { fly, fade } from 'svelte/transition';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import { toasts } from '$lib/utils/toasts';
	import { goto } from '$app/navigation';
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
		{ name: 'Memory', path: '/memory', icon: Brain },
		{ name: 'Chat', path: '/chat', icon: MessageSquare }
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

	// ── Compact header (chat-only, §2B) ─────────────────────────────────────
	const headerStyle = $derived(page.url.pathname === '/chat' ? 'compact' : 'full');

	type ActivityRow = { id: number; trace_id: string; action: string; target: string | null; timestamp: string };
	let compactActivity = $state<ActivityRow[]>([]);
	let compactResetting = $state(false);
	let compactActiveThread = $state('default');

	function getActiveWorkerInfo(rows: ActivityRow[]): { worker: string; step: string } | null {
		if (rows.length === 0) return null;
		const byTrace = new Map<string, ActivityRow>();
		for (const row of rows) byTrace.set(row.trace_id, row);
		const cutoff = Date.now() - 5 * 60 * 1000;
		for (const [traceId, last] of byTrace) {
			if (new Date(last.timestamp).getTime() < cutoff) continue;
			if (last.action === 'completed' || last.action === 'failed') continue;
			const prefix = traceId.split('-')[0]?.toLowerCase() || 'cc';
			const worker = prefix === 'agy' ? 'AGY' : 'CC';
			const step = last.target ? `${last.action} '${last.target}'` : last.action;
			return { worker, step };
		}
		return null;
	}

	const activeWorkerInfo = $derived(getActiveWorkerInfo(compactActivity));

	async function refreshCompactActivity() {
		try {
			const resp = await fetch(resolve('/api/chat/activity?limit=20'));
			if (!resp.ok) return;
			const body = await resp.json();
			compactActivity = (body.activity || []) as ActivityRow[];
		} catch { /* silent — offline or unavailable */ }
	}

	async function refreshCompactThread() {
		try {
			const resp = await fetch(resolve('/api/chat/state'));
			if (!resp.ok) return;
			const body = await resp.json();
			if (body.active_thread) compactActiveThread = body.active_thread as string;
		} catch { /* silent */ }
	}

	async function handleCompactReset() {
		if (compactResetting) return;
		compactResetting = true;
		try {
			await refreshCompactThread();
			const resp = await fetch(resolve('/api/chat/reset'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ thread: compactActiveThread })
			});
			if (resp.ok) {
				toasts.add('Context reset. Workers start fresh from this point.', 'success');
			}
		} catch { /* silent */ } finally {
			compactResetting = false;
		}
	}

	$effect(() => {
		if (headerStyle !== 'compact') return;
		void refreshCompactActivity();
		void refreshCompactThread();
		const activityInterval = setInterval(refreshCompactActivity, 2000);
		const threadInterval = setInterval(refreshCompactThread, 5000);
		return () => {
			clearInterval(activityInterval);
			clearInterval(threadInterval);
		};
	});

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

<div
	data-sveltekit-preload-data="hover"
	class="mx-auto flex h-[100dvh] max-w-[480px] sm:max-w-[640px] md:max-w-[820px] lg:max-w-[960px] flex-col overflow-hidden border-x border-border bg-background text-foreground shadow-2xl"
	style="padding-top: env(safe-area-inset-top, 0px);"
>
	{#if headerStyle === 'compact'}
		<!-- Compact header — chat-only (§2B). 32px tall: saves 84px vs full header
		     + command bar. Logo anchors identity; thread label is a read-only
		     indicator (full thread switching lives in the chat page's own header
		     per PR 7 scope); reset icon fires the same /api/chat/reset call. -->
		<header class="z-30 flex h-8 items-center justify-between border-b border-border bg-background/80 px-3 backdrop-blur-md">
			<img src="{base}/favicon.png" alt="LogueOS" width="28" height="28" class="h-7 w-7 shrink-0" />

			<span class="flex items-center gap-1 font-sans text-xs font-semibold text-muted-foreground">
				{compactActiveThread === 'default' ? 'Default' : compactActiveThread}
				<span aria-hidden="true">▾</span>
			</span>

			<button
				type="button"
				onclick={handleCompactReset}
				disabled={compactResetting}
				aria-label="Reset context"
				title="Drop a new-conversation marker so workers start fresh"
				class="active-trigger flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface hover:text-foreground disabled:opacity-40"
			>
				<RotateCcw size={14} aria-hidden="true" />
			</button>
		</header>

		<!-- Micro-tracker: slides in below compact header when a worker is active.
		     <16px tall. Shows ⚡ <worker>: <step>... [View Logs]. -->
		{#if activeWorkerInfo}
			<div
				class="z-20 flex h-4 items-center gap-1.5 overflow-hidden border-b border-border/50 bg-surface/20 px-3"
				in:fade={{ duration: 150 }}
				out:fade={{ duration: 150 }}
			>
				<span class="shrink-0 text-[11px] text-cta" aria-hidden="true">⚡</span>
				<span class="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground">
					{activeWorkerInfo.worker}: {activeWorkerInfo.step}...
				</span>
				<button
					type="button"
					onclick={() => goto(resolve('/activity'))}
					class="shrink-0 font-mono text-[10px] text-cta transition-colors hover:text-cta/70"
				>
					[View Logs]
				</button>
			</div>
		{/if}
	{:else}
		<!-- Full header — all non-chat routes. Unchanged. -->
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
					aria-current={page.url.pathname === '/usage' ? 'page' : undefined}
					class="active-trigger flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-surface"
					class:text-cta={page.url.pathname === '/usage'}
					class:text-muted-foreground={page.url.pathname !== '/usage'}
				>
					<DollarSign size={18} aria-hidden="true" />
				</a>
				<a
					href={resolve('/settings')}
					aria-label="Settings"
					aria-current={page.url.pathname === '/settings' ? 'page' : undefined}
					class="active-trigger flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-surface"
					class:text-cta={page.url.pathname === '/settings'}
					class:text-muted-foreground={page.url.pathname !== '/settings'}
				>
					<Settings size={18} aria-hidden="true" />
				</a>
			</div>
		</header>

		<!-- Global Command Bar -->
		<div class="z-20 flex items-center gap-2 border-b border-border bg-surface/50 px-4 py-1.5 backdrop-blur-sm">
			<span class="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">System</span>
			<div class="h-3 w-px bg-border"></div>
			<button class="active-trigger flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-white/5">
				<Pause size={10} />
				Pause
			</button>
			<button class="active-trigger flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-white/5">
				<RefreshCw size={10} />
				Sync
			</button>
			<div class="flex-1"></div>
			<button class="active-trigger flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-status-amber transition-colors hover:bg-status-amber/10">
				<Power size={10} />
				Restart
			</button>
		</div>
	{/if}

	<!-- Main Content.
	     Optimized for PWA: The container is now the scroll parent, and the nav
	     is part of the flex flow, ensuring it sits at the true bottom.
	     Page transitions: fly in from the right/left or simple fade. -->
	<main class="relative flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar">
		{#key page.url.pathname}
			<div
				class="h-full p-4"
			>
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
