<script lang="ts">
	import type { PageData } from './$types';
	import type { KillSwitchState, KillSwitchToggleResponse } from '$lib/types/kill-switch';
	import { resolve } from '$app/paths';
	import { ShieldCheck, AlertCircle, X, Signal, PauseCircle } from 'lucide-svelte';
	import { formatRelativeTime } from '$lib/utils/format';
	import ConnectionPill from '$lib/components/ConnectionPill.svelte';

	let { data }: { data: PageData } = $props();

	// Seed from SSR so the first paint is already correct. Polling keeps it
	// fresh — important because the halt file can be touched/removed by any
	// process on the box (operator's PowerShell, another worker, etc.).
	let killSwitch = $state<KillSwitchState>(data.killSwitch);
	let fetchError = $state<string | null>(null);

	// Connection-status services seeded from SSR (LOS-70). Polled on the same
	// cadence as the kill switch so the operator gets one consistent refresh.
	let services = $state<Array<{ id: string; name: string; status: 'online' | 'offline' }>>(
		data.services ?? []
	);
	let servicesError = $state<string | null>(null);

	$effect(() => {
		killSwitch = data.killSwitch;
	});

	$effect(() => {
		services = data.services ?? [];
	});

	// Modal + form state. We require an explicit confirm tap before any
	// toggle — the kill switch stopping every in-flight worker is a high-
	// blast-radius action even when intentional.
	let confirmOpen = $state(false);
	let pendingAction = $state<'activate' | 'clear' | null>(null);
	let noteDraft = $state('');
	let submitting = $state(false);
	let submitError = $state<string | null>(null);

	async function refresh() {
		// Kill switch
		try {
			const resp = await fetch(resolve('/api/kill-switch'));
			if (!resp.ok) {
				const err = await resp.json().catch(() => ({}));
				throw new Error(err.error || `HTTP ${resp.status}`);
			}
			killSwitch = (await resp.json()) as KillSwitchState;
			fetchError = null;
		} catch (e: unknown) {
			fetchError = e instanceof Error ? e.message : 'Unknown error';
			console.error('kill-switch poll error:', e);
		}

		// Connection-status services
		try {
			const resp = await fetch(resolve('/api/system'));
			if (!resp.ok) {
				const err = await resp.json().catch(() => ({}));
				throw new Error(err.error || `HTTP ${resp.status}`);
			}
			const body = await resp.json();
			services = Array.isArray(body.services) ? body.services : [];
			servicesError = null;
		} catch (e: unknown) {
			servicesError = e instanceof Error ? e.message : 'Unknown error';
			console.error('connection-status poll error:', e);
		}
	}

	$effect(() => {
		const interval = setInterval(() => {
			if (document.visibilityState === 'visible') refresh();
		}, data.pollIntervalMs);
		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	});

	function openConfirm(action: 'activate' | 'clear') {
		pendingAction = action;
		noteDraft = '';
		submitError = null;
		confirmOpen = true;
	}

	function closeConfirm() {
		if (submitting) return;
		confirmOpen = false;
		pendingAction = null;
	}

	import { toasts } from '$lib/utils/toasts';

	async function submitToggle() {
		if (!pendingAction || submitting) return;
		submitting = true;
		submitError = null;
		const actionLabel = pendingAction === 'activate' ? 'Pause' : 'Resume';
		try {
			const resp = await fetch(resolve('/api/kill-switch'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: pendingAction,
					note: noteDraft.trim() || undefined
				})
			});
			if (!resp.ok) {
				const err = await resp.json().catch(() => ({}));
				throw new Error(err.detail || err.error || `HTTP ${resp.status}`);
			}
			const body = (await resp.json()) as KillSwitchToggleResponse;
			killSwitch = body.state;
			confirmOpen = false;
			pendingAction = null;
			noteDraft = '';
			toasts.add(`${actionLabel} successful`, 'success');
		} catch (e: unknown) {
			submitError = e instanceof Error ? e.message : 'Unknown error';
			toasts.add(`${actionLabel} failed`, 'error');
			console.error('kill-switch toggle error:', e);
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex flex-col gap-4">

	<h1 class="font-sans text-xl font-bold tracking-tight">Settings</h1>

	<!-- Connection Status section (LOS-70). Pills show whether each LogueOS
	     service is reachable from the Console box. Same poll cadence as the
	     kill-switch card. -->
	<section class="flex flex-col gap-3" aria-labelledby="connectivity-heading">
		<div class="flex items-center gap-2 px-1">
			<Signal size={16} class="text-muted-foreground" />
			<h2
				id="connectivity-heading"
				class="font-sans text-xs font-bold tracking-widest text-muted-foreground uppercase"
			>
				Connected Services
			</h2>
		</div>

		{#if services.length === 0}
			<div
				class="rounded-md border border-dashed border-border bg-surface/30 p-3 font-mono text-[11px] text-muted-foreground"
			>
				No services reported. {#if servicesError}({servicesError}){/if}
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each services as service (service.id)}
					<ConnectionPill id={service.id} name={service.name} status={service.status} />
				{/each}
			</div>
		{/if}

		{#if servicesError && services.length > 0}
			<div
				class="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-2 font-mono text-[11px] text-amber-400"
			>
				<AlertCircle size={14} class="mt-0.5 shrink-0" />
				<span>Service check failed: {servicesError}</span>
			</div>
		{/if}
	</section>

	<!-- Kill switch card. Big, visually distinct from everything else on the
	     page so the operator can find it in a panic. State color is the
	     primary signal: amber = paused, green = running. -->
	<section
		class="rounded-lg border p-4 {killSwitch.active
			? 'border-amber-500/40 bg-amber-500/5'
			: 'border-emerald-500/30 bg-emerald-500/5'}"
		aria-labelledby="kill-switch-heading"
	>
		<div class="flex items-start gap-3">
			{#if killSwitch.active}
				<PauseCircle size={28} class="shrink-0 text-amber-400" aria-hidden="true" />
			{:else}
				<ShieldCheck size={28} class="shrink-0 text-emerald-400" aria-hidden="true" />
			{/if}
			<div class="flex flex-1 flex-col gap-1">
				<h2 id="kill-switch-heading" class="font-sans text-lg font-bold tracking-tight">
					Pause Everything
				</h2>
				<p
					class="font-mono text-[10px] tracking-widest uppercase {killSwitch.active
						? 'text-amber-400'
						: 'text-emerald-400'}"
				>
					{killSwitch.active ? 'Work is paused' : 'Running normally'}
				</p>
			</div>
		</div>

		{#if killSwitch.active}
			<div class="mt-4 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-xs">
				<p class="font-sans text-amber-300">
					Work is paused. All workers will stop before starting new tasks.
				</p>
				{#if killSwitch.note}
					<p class="mt-1 font-sans text-amber-400/80">{killSwitch.note}</p>
				{/if}
				{#if killSwitch.activated_by || killSwitch.activated_at}
					<p class="mt-2 font-mono text-[10px] text-amber-500/70">
						{#if killSwitch.activated_by}Paused by {killSwitch.activated_by}{/if}{#if killSwitch.activated_by && killSwitch.activated_at} · {/if}{#if killSwitch.activated_at}{formatRelativeTime(killSwitch.activated_at)}{/if}
					</p>
				{/if}
			</div>
		{/if}

		<div class="mt-4 flex flex-col gap-2">
			{#if killSwitch.active}
				<button
					type="button"
					onclick={() => openConfirm('clear')}
					class="flex w-full items-center justify-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 font-sans text-sm font-bold tracking-wider text-emerald-300 uppercase transition-colors hover:bg-emerald-500/20 focus:ring-2 focus:ring-emerald-500/50 focus:outline-none"
				>
					<ShieldCheck size={16} />
					Resume work
				</button>
			{:else}
				<button
					type="button"
					onclick={() => openConfirm('activate')}
					class="flex w-full items-center justify-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 font-sans text-sm font-bold tracking-wider text-amber-300 uppercase transition-colors hover:bg-amber-500/20 focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
				>
					<PauseCircle size={16} />
					Pause all work
				</button>
				<p class="text-center font-mono text-[10px] text-muted-foreground">
					Stops workers from picking up new tasks. In-progress work finishes its current step, then halts.
				</p>
			{/if}
		</div>

		{#if fetchError}
			<div
				class="mt-3 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-2 font-mono text-[11px] text-red-400"
			>
				<AlertCircle size={14} class="mt-0.5 shrink-0" />
				<span>State refresh failed: {fetchError}</span>
			</div>
		{/if}
	</section>

	<!-- Build identity (LOS-73). Lets the operator know which build is
	     running when triaging Console issues. Values are inlined at build
	     time via vite.config.ts `define`; zero runtime cost. -->
	<footer
		class="text-muted-foreground mt-6 border-t border-border pt-3 text-center font-mono text-[10px]"
		aria-label="Build identity"
	>
		{__BUILD_SHA__} · built {__BUILD_TS__.slice(0, 16).replace('T', ' ')} UTC
	</footer>
</div>

{#if confirmOpen && pendingAction}
	<!-- Modal backdrop. role/aria-modal so screen readers treat the dialog as
	     a focus context. Clicking the backdrop cancels (operator's `esc`
	     equivalent on mobile). -->
	<div
		class="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="confirm-heading"
		onclick={closeConfirm}
		onkeydown={(e) => {
			if (e.key === 'Escape') closeConfirm();
		}}
		tabindex="-1"
	>
		<!-- Stop propagation so taps INSIDE the dialog don't dismiss it. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-background p-5 shadow-2xl"
			role="document"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			tabindex="-1"
		>
			<div class="flex items-start justify-between gap-3">
				<h3 id="confirm-heading" class="font-sans text-base font-bold tracking-tight">
					{pendingAction === 'activate' ? 'Pause all work?' : 'Resume work?'}
				</h3>
				<button
					type="button"
					onclick={closeConfirm}
					class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
					aria-label="Close"
					disabled={submitting}
				>
					<X size={16} />
				</button>
			</div>

			<p class="font-sans text-sm text-muted-foreground">
				{#if pendingAction === 'activate'}
					Every in-flight worker will finish its current step, then stop. New
					tasks won't be picked up until work is resumed.
				{:else}
					Workers will be allowed to pick up new tasks again.
				{/if}
			</p>

			<label class="flex flex-col gap-1">
				<span class="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
					Reason (optional)
				</span>
				<input
					type="text"
					bind:value={noteDraft}
					maxlength="500"
					placeholder={pendingAction === 'activate'
						? 'e.g. live demo at 3pm, pausing non-essential work'
						: 'e.g. demo done, resuming normal ops'}
					disabled={submitting}
					class="placeholder:text-muted-foreground rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-foreground focus:border-cta focus:ring-1 focus:ring-cta focus:outline-none"
				/>
			</label>

			{#if submitError}
				<div
					class="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-2 font-mono text-[11px] text-red-400"
				>
					<AlertCircle size={14} class="mt-0.5 shrink-0" />
					<span>{submitError}</span>
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<button
					type="button"
					onclick={submitToggle}
					disabled={submitting}
					class="flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 font-sans text-sm font-bold tracking-wider uppercase transition-colors focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 {pendingAction ===
					'activate'
						? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 focus:ring-amber-500/50'
						: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 focus:ring-emerald-500/50'}"
				>
					{submitting
						? 'Working…'
						: pendingAction === 'activate'
							? 'Confirm pause'
							: 'Resume work'}
				</button>
				<button
					type="button"
					onclick={closeConfirm}
					disabled={submitting}
					class="rounded-md border border-border bg-surface px-4 py-2 font-sans text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
