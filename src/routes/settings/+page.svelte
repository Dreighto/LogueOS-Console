<script lang="ts">
	import type { PageData } from './$types';
	import type { KillSwitchState, KillSwitchToggleResponse } from '$lib/types/kill-switch';
	import { resolve } from '$app/paths';
	import { AlertOctagon, ShieldCheck, AlertCircle, X, Signal } from 'lucide-svelte';
	import { formatFullDate } from '$lib/utils/format';
	import ConnectionPill from '$lib/components/ConnectionPill.svelte';

	let { data }: { data: PageData } = $props();

	// Seed from SSR so the first paint is already correct. Polling keeps it
	// fresh — important because the halt file can be touched/removed by any
	// process on the box (operator's PowerShell, another worker, etc.).
	function getInitialKS() { return data.killSwitch; }
	let killSwitch = $state<KillSwitchState>(getInitialKS());
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

	async function submitToggle() {
		if (!pendingAction || submitting) return;
		submitting = true;
		submitError = null;
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
		} catch (e: unknown) {
			submitError = e instanceof Error ? e.message : 'Unknown error';
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
				Connection Status
			</h2>
		</div>

		{#if services.length === 0}
			<div
				class="rounded-md border border-dashed border-border bg-surface/30 p-3 font-mono text-[11px] text-dim"
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
				<span>Connection-status refresh failed: {servicesError}</span>
			</div>
		{/if}
	</section>

	<!-- Kill switch card. Big, visually distinct from everything else on the
	     page so the operator can find it in a panic. State color is the
	     primary signal: red = active, green = clear. -->
	<section
		class="rounded-lg border p-4 {killSwitch.active
			? 'border-red-500/40 bg-red-500/5'
			: 'border-emerald-500/30 bg-emerald-500/5'}"
		aria-labelledby="kill-switch-heading"
	>
		<div class="flex items-start gap-3">
			{#if killSwitch.active}
				<AlertOctagon size={28} class="shrink-0 text-red-400" aria-hidden="true" />
			{:else}
				<ShieldCheck size={28} class="shrink-0 text-emerald-400" aria-hidden="true" />
			{/if}
			<div class="flex flex-1 flex-col gap-1">
				<h2 id="kill-switch-heading" class="font-sans text-lg font-bold tracking-tight">
					Kill Switch
				</h2>
				<p
					class="font-mono text-[10px] tracking-widest uppercase {killSwitch.active
						? 'text-red-400'
						: 'text-emerald-400'}"
				>
					{killSwitch.active ? 'ACTIVE — workers must halt' : 'CLEAR — workers may dispatch'}
				</p>
			</div>
		</div>

		{#if killSwitch.active}
			<dl class="mt-4 flex flex-col gap-2 border-t border-red-500/20 pt-3 text-xs">
				<div class="flex items-center justify-between">
					<dt class="font-mono tracking-wider text-muted-foreground uppercase">Activated</dt>
					<dd class="font-mono text-foreground">
						{killSwitch.activated_at
							? formatFullDate(killSwitch.activated_at)
							: '— (legacy halt file)'}
					</dd>
				</div>
				<div class="flex items-center justify-between">
					<dt class="font-mono tracking-wider text-muted-foreground uppercase">Source</dt>
					<dd class="font-mono text-foreground">{killSwitch.activated_by ?? '—'}</dd>
				</div>
				{#if killSwitch.note}
					<div class="flex flex-col gap-1">
						<dt class="font-mono tracking-wider text-muted-foreground uppercase">Note</dt>
						<dd class="font-sans text-foreground">{killSwitch.note}</dd>
					</div>
				{/if}
			</dl>
		{/if}

		<div class="mt-4 flex flex-col gap-2">
			{#if killSwitch.active}
				<button
					type="button"
					onclick={() => openConfirm('clear')}
					class="flex w-full items-center justify-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 font-sans text-sm font-bold tracking-wider text-emerald-300 uppercase transition-colors hover:bg-emerald-500/20 focus:ring-2 focus:ring-emerald-500/50 focus:outline-none"
				>
					<ShieldCheck size={16} />
					Clear Kill Switch
				</button>
			{:else}
				<button
					type="button"
					onclick={() => openConfirm('activate')}
					class="flex w-full items-center justify-center gap-2 rounded-md border border-red-500/50 bg-red-500/10 px-4 py-3 font-sans text-sm font-bold tracking-wider text-red-300 uppercase transition-colors hover:bg-red-500/20 focus:ring-2 focus:ring-red-500/50 focus:outline-none"
				>
					<AlertOctagon size={16} />
					Activate Kill Switch
				</button>
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

	<p class="font-mono text-[10px] text-muted-foreground">
		Worker controls + token usage tracker land next.
	</p>

	<!-- Build identity (LOS-73). Lets the operator know which build is
	     running when triaging Console issues. Values are inlined at build
	     time via vite.config.ts `define`; zero runtime cost. -->
	<footer
		class="text-dim mt-6 border-t border-border pt-3 text-center font-mono text-[10px]"
		aria-label="Build identity"
	>
		v{__BUILD_VERSION__} · {__BUILD_SHA__} · built {__BUILD_TS__.slice(0, 16).replace('T', ' ')} UTC
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
					{pendingAction === 'activate' ? 'Activate kill switch?' : 'Clear kill switch?'}
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
					Every in-flight worker will fail pre-flight on the next gate check and stop. New
					dispatches will be refused until the switch is cleared.
				{:else}
					Workers will be allowed to dispatch again on their next pre-flight check.
				{/if}
			</p>

			<label class="flex flex-col gap-1">
				<span class="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
					Note (optional, max 500 chars)
				</span>
				<input
					type="text"
					bind:value={noteDraft}
					maxlength="500"
					placeholder={pendingAction === 'activate'
						? 'e.g. live demo at 3pm, halting non-essential dispatches'
						: 'e.g. demo done, resuming normal ops'}
					disabled={submitting}
					class="placeholder:text-dim rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-foreground focus:border-cta focus:ring-1 focus:ring-cta focus:outline-none"
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
						? 'border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20 focus:ring-red-500/50'
						: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 focus:ring-emerald-500/50'}"
				>
					{submitting
						? 'Working…'
						: pendingAction === 'activate'
							? 'Confirm activate'
							: 'Confirm clear'}
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
