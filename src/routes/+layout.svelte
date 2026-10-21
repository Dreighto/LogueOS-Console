<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { resolve, base } from '$app/paths';
	import { onNavigate } from '$app/navigation';
	import { Home, Cpu, Activity, Brain, MessageSquare, Settings, DollarSign, AlertOctagon, Pause, RefreshCw, Power } from 'lucide-svelte';
	import { fly, fade } from 'svelte/transition';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import type { LayoutData } from './$types';
	import type { KillSwitchState } from '$lib/types/kill-switch';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const tabs = [
		{ name: 'Home', path: '/', icon: Home },
		{ name: 'Team', path: '/workers', icon: Cpu },
		{ name: 'Activity', path: '/activity', icon: Activity },
		{ name: 'Memory', path: '/memory', icon: Brain },
		{ name: 'Chat', path: '/chat', icon: MessageSquare }
	] as const;

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
			// Silent — holds last good value
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

<!--
  Mobile  (<lg): centered 480px column — top header + command bar + main + bottom nav
  Desktop (lg+): full-width row — fixed left sidebar + scrollable main area
-->
<div
	data-sveltekit-preload-data="hover"
	class="mx-auto flex h-[100dvh] max-w-[480px] flex-col overflow-hidden border-x border-border bg-background text-foreground shadow-2xl
	       lg:mx-0 lg:max-w-none lg:w-full lg:flex-row lg:border-x-0 lg:shadow-none"
	style="padding-top: env(safe-area-inset-top, 0px);"
>
	<!-- ══ LEFT SIDEBAR (desktop only) ══════════════════════════════════════ -->
	<aside class="hidden lg:flex lg:w-52 lg:shrink-0 lg:flex-col lg:border-r lg:border-border lg:bg-background">
		<!-- Branding -->
		<div class="flex items-center gap-2.5 border-b border-border px-4 py-4">
			<img src="{base}/favicon.png" alt="" width="28" height="28" class="h-7 w-7 shrink-0" />
			<h1 class="font-sans text-base font-bold tracking-tight text-white">LogueOS</h1>
		</div>

		<!-- Kill-switch indicator (if active) -->
		{#if killSwitch.active}
			<div class="border-b border-border px-3 py-2" in:fade={{ duration: 300 }}>
				<a
					href={resolve('/settings')}
					class="active-trigger flex items-center gap-1.5 rounded-md border border-status-red/50 bg-status-red/10 px-2 py-1.5 font-mono text-[10px] font-bold tracking-widest text-status-red uppercase transition-colors hover:bg-status-red/20"
				>
					<AlertOctagon size={11} aria-hidden="true" />
					<span>Kill Switch Active</span>
				</a>
			</div>
		{/if}

		<!-- Primary nav -->
		<nav class="flex flex-1 flex-col gap-0.5 px-2 py-3">
			{#each tabs as tab (tab.path)}
				<a
					href={resolve(tab.path)}
					aria-current={page.url.pathname === tab.path ? 'page' : undefined}
					class="active-trigger group flex items-center gap-3 rounded-md px-3 py-2 font-sans text-sm font-medium transition-colors duration-150"
					class:bg-surface={page.url.pathname === tab.path}
					class:text-cta={page.url.pathname === tab.path}
					class:text-muted-foreground={page.url.pathname !== tab.path}
					class:hover:bg-surface={page.url.pathname !== tab.path}
					class:hover:text-foreground={page.url.pathname !== tab.path}
				>
					<tab.icon
						size={16}
						class="shrink-0 transition-all duration-200 {page.url.pathname === tab.path ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}"
					/>
					{tab.name}
				</a>
			{/each}
		</nav>

		<!-- Meta nav + system commands -->
		<div class="border-t border-border px-2 py-2">
			<a
				href={resolve('/usage')}
				aria-current={page.url.pathname === '/usage' ? 'page' : undefined}
				class="active-trigger group flex items-center gap-3 rounded-md px-3 py-2 font-sans text-sm font-medium transition-colors duration-150"
				class:bg-surface={page.url.pathname === '/usage'}
				class:text-cta={page.url.pathname === '/usage'}
				class:text-muted-foreground={page.url.pathname !== '/usage'}
				class:hover:bg-surface={page.url.pathname !== '/usage'}
				class:hover:text-foreground={page.url.pathname !== '/usage'}
			>
				<DollarSign size={16} class="shrink-0 opacity-60 group-hover:opacity-100" />
				Usage
			</a>
			<a
				href={resolve('/settings')}
				aria-current={page.url.pathname === '/settings' ? 'page' : undefined}
				class="active-trigger group flex items-center gap-3 rounded-md px-3 py-2 font-sans text-sm font-medium transition-colors duration-150"
				class:bg-surface={page.url.pathname === '/settings'}
				class:text-cta={page.url.pathname === '/settings'}
				class:text-muted-foreground={page.url.pathname !== '/settings'}
				class:hover:bg-surface={page.url.pathname !== '/settings'}
				class:hover:text-foreground={page.url.pathname !== '/settings'}
			>
				<Settings size={16} class="shrink-0 opacity-60 group-hover:opacity-100" />
				Settings
			</a>

			<div class="my-2 h-px bg-border"></div>

			<!-- System commands -->
			<div class="flex flex-col gap-0.5">
				<button class="active-trigger flex items-center gap-3 rounded-md px-3 py-2 font-mono text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-surface">
					<Pause size={12} class="shrink-0" />
					Pause
				</button>
				<button class="active-trigger flex items-center gap-3 rounded-md px-3 py-2 font-mono text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-surface">
					<RefreshCw size={12} class="shrink-0" />
					Sync
				</button>
				<button class="active-trigger flex items-center gap-3 rounded-md px-3 py-2 font-mono text-xs font-bold uppercase tracking-widest text-status-amber transition-colors hover:bg-status-amber/10">
					<Power size={12} class="shrink-0" />
					Restart
				</button>
			</div>
		</div>
	</aside>

	<!-- ══ RIGHT COLUMN (mobile: full layout; desktop: content area) ════════ -->
	<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
		<!-- Top Bar — mobile only -->
		<header
			class="z-30 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md lg:hidden"
		>
			<div class="flex items-center gap-2">
				<img src="{base}/favicon.png" alt="" width="28" height="28" class="h-7 w-7 shrink-0" />
				<h1 class="font-sans text-lg font-bold tracking-tight text-white">LogueOS Console</h1>
			</div>

			<div class="flex items-center gap-1">
				{#if killSwitch.active}
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

		<!-- Command Bar — mobile only -->
		<div class="z-20 flex items-center gap-2 border-b border-border bg-surface/50 px-4 py-1.5 backdrop-blur-sm lg:hidden">
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

		<!-- Main Content -->
		<main class="relative flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar">
			{#key page.url.pathname}
				<div class="h-full p-4">
					{@render children()}
				</div>
			{/key}
		</main>

		<!-- Bottom Navigation — mobile only -->
		<nav
			class="z-20 w-full border-t border-border bg-background/95 backdrop-blur-xl lg:hidden"
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
							size={16}
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
	</div>

	<ToastContainer />
</div>

<style>
	:global(html) {
		height: 100%;
		overflow: hidden;
	}
	:global(body) {
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
