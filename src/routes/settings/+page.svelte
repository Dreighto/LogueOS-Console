<script lang="ts">
	import type { PageData } from './$types';
	import type { KillSwitchState, KillSwitchToggleResponse } from '$lib/types/kill-switch';
	import { resolve } from '$app/paths';
	import { ShieldCheck, AlertCircle, X, Signal, PauseCircle, Bell, BellOff, BellRing } from 'lucide-svelte';
	import { formatRelativeTime } from '$lib/utils/format';
	import ConnectionPill from '$lib/components/ConnectionPill.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

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

	// LLM spend data (PR 1c). Seeded from SSR; refreshed on poll cadence.
	type SpendEntry = { provider: string; tokens_used: number; cap: number; pct: number };
	let spendData = $state<SpendEntry[]>(data.spendProviders ?? []);
	let spendError = $state<string | null>(null);

	$effect(() => {
		spendData = data.spendProviders ?? [];
	});

	// Voice usage data (PR 4).
	type VoiceStatus = { chars_used: number; char_cap: number; minutes_used: number; minute_cap: number };
	let voiceStatus = $state<VoiceStatus | null>(data.voiceStatus ?? null);

	$effect(() => {
		voiceStatus = data.voiceStatus ?? null;
	});

	// Web Push state (PR 6).
	type DeadSub = { device_id: string; endpoint: string; detected_at: string };
	let pushDeadSubs = $state<DeadSub[]>(data.pushDeadSubs ?? []);
	let pushSubCount = $state<number>(data.pushSubCount ?? 0);
	let pushEnabled = $state(false);        // reflects PushManager subscription state
	let pushWorking = $state(false);        // true while subscribe/unsubscribe is in flight
	let pushError = $state<string | null>(null);
	let pushDeviceId = $state<string>('');  // persisted in localStorage

	$effect(() => {
		pushDeadSubs = data.pushDeadSubs ?? [];
		pushSubCount = data.pushSubCount ?? 0;
	});

	// On mount: read/generate device_id from localStorage, then probe PushManager state.
	$effect(() => {
		if (typeof window === 'undefined') return;
		if (!data.enableWebPush) return;

		let id = localStorage.getItem('logueos_push_device_id');
		if (!id) {
			id = crypto.randomUUID();
			localStorage.setItem('logueos_push_device_id', id);
		}
		pushDeviceId = id;

		if ('serviceWorker' in navigator && 'PushManager' in window) {
			navigator.serviceWorker.ready.then(async (reg) => {
				const sub = await reg.pushManager.getSubscription();
				pushEnabled = sub !== null;
			}).catch(() => {});
		}
	});

	async function togglePush() {
		if (pushWorking) return;
		pushWorking = true;
		pushError = null;
		try {
			if (pushEnabled) {
				await disablePush();
			} else {
				await enablePush();
			}
		} catch (e: unknown) {
			pushError = e instanceof Error ? e.message : 'Push toggle failed.';
		} finally {
			pushWorking = false;
		}
	}

	async function enablePush() {
		if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
			throw new Error('Web Push is not supported in this browser.');
		}

		const permission = await Notification.requestPermission();
		if (permission !== 'granted') {
			throw new Error('Notification permission denied.');
		}

		const reg = await navigator.serviceWorker.ready;
		const sub = await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey)
		});

		const resp = await fetch('/api/chat/push/subscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ device_id: pushDeviceId, subscription: sub.toJSON() })
		});
		if (!resp.ok) {
			const err = await resp.json().catch(() => ({}));
			throw new Error((err as Record<string, string>).message ?? `HTTP ${resp.status}`);
		}

		pushEnabled = true;
		pushSubCount += 1;
	}

	async function disablePush() {
		const reg = await navigator.serviceWorker.ready;
		const sub = await reg.pushManager.getSubscription();
		if (sub) await sub.unsubscribe();

		await fetch('/api/chat/push/unsubscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ device_id: pushDeviceId })
		});

		pushEnabled = false;
		pushSubCount = Math.max(0, pushSubCount - 1);
	}

	async function dismissDeadSub(deviceId: string) {
		// Optimistic remove from banner; server-side re_prompted_at update
		// happens via unsubscribe (which cleans the row anyway).
		pushDeadSubs = pushDeadSubs.filter((d) => d.device_id !== deviceId);
	}

	// Converts a URL-safe base64 VAPID public key to Uint8Array as required by
	// PushManager.subscribe(applicationServerKey).
	function urlBase64ToUint8Array(base64String: string): Uint8Array {
		const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
		const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
		const raw = atob(base64);
		return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
	}

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

		// LLM spend data
		try {
			const resp = await fetch(resolve('/api/chat/usage'));
			if (resp.ok) {
				const body = await resp.json();
				spendData = Array.isArray(body.providers) ? body.providers : [];
				spendError = null;
			}
		} catch (e: unknown) {
			spendError = e instanceof Error ? e.message : 'Unknown error';
		}

		// Voice usage data
		try {
			const resp = await fetch(resolve('/api/chat/speak/status'));
			if (resp.ok) {
				voiceStatus = await resp.json();
			}
		} catch {
			// non-fatal — voice banner stays at last known value
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

	<PageHeader title="Settings" />

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
				class="rounded-md border border-dashed border-border bg-surface/30 p-3 font-mono text-xs text-muted-foreground"
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
				class="flex items-start gap-2 rounded-md border border-status-amber/20 bg-status-amber/5 p-2 font-mono text-xs text-status-amber"
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
			? 'border-status-amber/40 bg-status-amber/5'
			: 'border-status-green/30 bg-status-green/5'}"
		aria-labelledby="kill-switch-heading"
	>
		<div class="flex items-start gap-3">
			{#if killSwitch.active}
				<PauseCircle size={28} class="shrink-0 text-status-amber" aria-hidden="true" />
			{:else}
				<ShieldCheck size={28} class="shrink-0 text-status-green" aria-hidden="true" />
			{/if}
			<div class="flex flex-1 flex-col gap-1">
				<h2 id="kill-switch-heading" class="font-sans text-lg font-bold tracking-tight">
					Pause Everything
				</h2>
				<p
					class="font-mono text-xs tracking-widest uppercase {killSwitch.active
						? 'text-status-amber'
						: 'text-status-green'}"
				>
					{killSwitch.active ? 'Work is paused' : 'Running normally'}
				</p>
			</div>
		</div>

		{#if killSwitch.active}
			<div class="mt-4 rounded-md border border-status-amber/20 bg-status-amber/10 p-3 text-xs">
				<p class="font-sans text-status-amber">
					Work is paused. All workers will stop before starting new tasks.
				</p>
				{#if killSwitch.note}
					<p class="mt-1 font-sans text-status-amber/80">{killSwitch.note}</p>
				{/if}
				{#if killSwitch.activated_by || killSwitch.activated_at}
					<p class="mt-2 font-mono text-xs text-status-amber/70">
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
					class="flex w-full items-center justify-center gap-2 rounded-md border border-status-green/40 bg-status-green/10 px-4 py-3 font-sans text-sm font-bold tracking-wider text-status-green uppercase transition-colors hover:bg-status-green/20 focus:ring-2 focus:ring-status-green/50 focus:outline-none"
				>
					<ShieldCheck size={16} />
					Resume work
				</button>
			{:else}
				<button
					type="button"
					onclick={() => openConfirm('activate')}
					class="flex w-full items-center justify-center gap-2 rounded-md border border-status-amber/40 bg-status-amber/10 px-4 py-3 font-sans text-sm font-bold tracking-wider text-status-amber uppercase transition-colors hover:bg-status-amber/20 focus:ring-2 focus:ring-status-amber/50 focus:outline-none"
				>
					<PauseCircle size={16} />
					Pause all work
				</button>
				<p class="text-center font-mono text-xs text-muted-foreground">
					Stops workers from picking up new tasks. In-progress work finishes its current step, then halts.
				</p>
			{/if}
		</div>

		{#if fetchError}
			<div
				class="mt-3 flex items-start gap-2 rounded-md border border-status-red/20 bg-status-red/5 p-2 font-mono text-xs text-status-red"
			>
				<AlertCircle size={14} class="mt-0.5 shrink-0" />
				<span>State refresh failed: {fetchError}</span>
			</div>
		{/if}
	</section>

	<!-- LLM Spend banner (PR 1c). Today's token usage per provider vs cap. -->
	{#if spendData.length > 0}
		<section class="flex flex-col gap-3" aria-labelledby="spend-heading">
			<div class="flex items-center gap-2 px-1">
				<span class="text-muted-foreground text-sm">🪙</span>
				<h2
					id="spend-heading"
					class="font-sans text-xs font-bold tracking-widest text-muted-foreground uppercase"
				>
					LLM Spend Today
				</h2>
			</div>
			<div class="flex flex-col gap-2">
				{#each spendData as p (p.provider)}
					<div class="rounded-md border border-border bg-surface/30 px-3 py-2 flex flex-col gap-1">
						<div class="flex items-center justify-between">
							<span class="font-mono text-xs uppercase tracking-wider text-foreground">{p.provider}</span>
							<span class="font-mono text-xs text-muted-foreground">
								{p.tokens_used.toLocaleString()} / {p.cap.toLocaleString()} tok · {p.pct}%
							</span>
						</div>
						<div class="h-1 w-full rounded bg-border overflow-hidden">
							<div
								class="h-full rounded transition-all duration-300
									{p.pct >= 90 ? 'bg-status-red' : p.pct >= 70 ? 'bg-status-amber' : 'bg-status-green'}"
								style="width: {p.pct}%"
							></div>
						</div>
					</div>
				{/each}
			</div>
			{#if spendError}
				<p class="font-mono text-xs text-status-amber">Spend refresh failed: {spendError}</p>
			{/if}
		</section>
	{/if}

	<!-- Voice usage banner (PR 4). Today's ElevenLabs chars + AssemblyAI minutes vs caps. -->
	{#if voiceStatus}
		{@const ttsPct = voiceStatus.char_cap > 0 ? Math.min(100, Math.round((voiceStatus.chars_used / voiceStatus.char_cap) * 100)) : 0}
		{@const sttPct = voiceStatus.minute_cap > 0 ? Math.min(100, Math.round((voiceStatus.minutes_used / voiceStatus.minute_cap) * 100)) : 0}
		<section class="flex flex-col gap-3" aria-labelledby="voice-spend-heading">
			<div class="flex items-center gap-2 px-1">
				<span class="text-muted-foreground text-sm">🎙️</span>
				<h2
					id="voice-spend-heading"
					class="font-sans text-xs font-bold tracking-widest text-muted-foreground uppercase"
				>
					Voice Today
				</h2>
			</div>
			<div class="flex flex-col gap-2">
				<div class="rounded-md border border-border bg-surface/30 px-3 py-2 flex flex-col gap-1">
					<div class="flex items-center justify-between">
						<span class="font-mono text-xs uppercase tracking-wider text-foreground">ElevenLabs TTS</span>
						<span class="font-mono text-xs text-muted-foreground">
							{voiceStatus.chars_used.toLocaleString()} / {voiceStatus.char_cap.toLocaleString()} chars · {ttsPct}%
						</span>
					</div>
					<div class="h-1 w-full rounded bg-border overflow-hidden">
						<div
							class="h-full rounded transition-all duration-300
								{ttsPct >= 90 ? 'bg-status-red' : ttsPct >= 70 ? 'bg-status-amber' : 'bg-status-green'}"
							style="width: {ttsPct}%"
						></div>
					</div>
				</div>
				<div class="rounded-md border border-border bg-surface/30 px-3 py-2 flex flex-col gap-1">
					<div class="flex items-center justify-between">
						<span class="font-mono text-xs uppercase tracking-wider text-foreground">AssemblyAI STT</span>
						<span class="font-mono text-xs text-muted-foreground">
							{voiceStatus.minutes_used.toFixed(1)} / {voiceStatus.minute_cap} min · {sttPct}%
						</span>
					</div>
					<div class="h-1 w-full rounded bg-border overflow-hidden">
						<div
							class="h-full rounded transition-all duration-300
								{sttPct >= 90 ? 'bg-status-red' : sttPct >= 70 ? 'bg-status-amber' : 'bg-status-green'}"
							style="width: {sttPct}%"
						></div>
					</div>
				</div>
			</div>
		</section>
	{/if}

	<!-- Web Push Notifications section (PR 6). -->
	{#if data.enableWebPush}
		<section class="flex flex-col gap-3" aria-labelledby="push-heading">
			<div class="flex items-center gap-2 px-1">
				<Bell size={16} class="text-muted-foreground" />
				<h2
					id="push-heading"
					class="font-sans text-xs font-bold tracking-widest text-muted-foreground uppercase"
				>
					Push Notifications
				</h2>
			</div>

			<!-- Dead-sub re-subscribe banner -->
			{#each pushDeadSubs as dead (dead.device_id)}
				<div
					class="flex items-start gap-2 rounded-md border border-status-amber/30 bg-status-amber/5 p-3 font-mono text-xs text-status-amber"
				>
					<BellRing size={14} class="mt-0.5 shrink-0" />
					<div class="flex flex-1 flex-col gap-1">
						<span class="font-bold">Dead Subscription Detected — Re-subscribe</span>
						<span class="text-status-amber/80">
							Your push subscription expired or was revoked. Disable and re-enable
							notifications below to restore push delivery.
						</span>
					</div>
					<button
						type="button"
						onclick={() => dismissDeadSub(dead.device_id)}
						class="shrink-0 rounded p-0.5 text-status-amber/60 hover:text-status-amber"
						aria-label="Dismiss"
					>
						<X size={12} />
					</button>
				</div>
			{/each}

			<div
				class="rounded-lg border p-4 {pushEnabled
					? 'border-status-green/30 bg-status-green/5'
					: 'border-border bg-surface/30'}"
			>
				<div class="flex items-center justify-between gap-3">
					<div class="flex flex-col gap-0.5">
						<span class="font-sans text-sm font-semibold text-foreground">
							{pushEnabled ? 'Notifications enabled' : 'Enable Push Notifications'}
						</span>
						{#if pushSubCount > 0}
							<span class="font-mono text-xs text-muted-foreground">
								{pushSubCount} device{pushSubCount !== 1 ? 's' : ''} subscribed
							</span>
						{/if}
					</div>
					<button
						type="button"
						onclick={togglePush}
						disabled={pushWorking || !data.vapidPublicKey}
						class="flex items-center gap-2 rounded-md border px-3 py-2 font-sans text-xs font-bold uppercase tracking-wider transition-colors focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50
							{pushEnabled
							? 'border-status-red/30 bg-status-red/10 text-status-red hover:bg-status-red/20 focus:ring-status-red/40'
							: 'border-status-green/30 bg-status-green/10 text-status-green hover:bg-status-green/20 focus:ring-status-green/40'}"
					>
						{#if pushEnabled}
							<BellOff size={13} />
							{pushWorking ? 'Working…' : 'Disable'}
						{:else}
							<Bell size={13} />
							{pushWorking ? 'Working…' : 'Enable'}
						{/if}
					</button>
				</div>

				{#if !data.vapidPublicKey}
					<div
						class="mt-3 flex items-start gap-2 rounded-md border border-status-amber/20 bg-status-amber/5 p-2 font-mono text-xs text-status-amber"
					>
						<AlertCircle size={13} class="mt-0.5 shrink-0" />
						<span>
							VAPID keys not configured. Run <code>node tools/generate_vapid_keys.js</code> and
							add the output to <code>.env</code>.
						</span>
					</div>
				{/if}

				{#if pushError}
					<div
						class="mt-3 flex items-start gap-2 rounded-md border border-status-red/20 bg-status-red/5 p-2 font-mono text-xs text-status-red"
					>
						<AlertCircle size={13} class="mt-0.5 shrink-0" />
						<span>{pushError}</span>
					</div>
				{/if}

				<!-- iOS-specific inline quirks note -->
				<p class="mt-3 font-mono text-xs text-muted-foreground leading-relaxed">
					Apple Web Push requires the PWA to be home-screen-installed AND launched at least once
					since reboot. On iOS, tap the Share button → "Add to Home Screen", then open the app
					from the home screen before enabling notifications.
				</p>
			</div>
		</section>
	{/if}

	<!-- Build identity (LOS-73). Lets the operator know which build is
	     running when triaging Console issues. Values are inlined at build
	     time via vite.config.ts `define`; zero runtime cost. -->
	<footer
		class="text-muted-foreground mt-6 border-t border-border pt-3 text-center font-mono text-xs"
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
				<span class="font-mono text-xs tracking-wider text-muted-foreground uppercase">
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
					class="flex items-start gap-2 rounded-md border border-status-red/20 bg-status-red/5 p-2 font-mono text-xs text-status-red"
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
						? 'border-status-amber/40 bg-status-amber/10 text-status-amber hover:bg-status-amber/20 focus:ring-status-amber/50'
						: 'border-status-green/40 bg-status-green/10 text-status-green hover:bg-status-green/20 focus:ring-status-green/50'}"
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
