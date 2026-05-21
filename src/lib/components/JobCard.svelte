<script lang="ts">
	import type { ActiveJob } from '$lib/types/worker';
	import { formatRelativeTime } from '$lib/utils/format';
	import { workerShortLabel, workerColor } from '$lib/config/workers';
	import { resolve } from '$app/paths';
	import { Square } from 'lucide-svelte';
	import Card from '$lib/components/Card.svelte';

	interface Props {
		job: ActiveJob;
	}

	let { job }: Props = $props();

	// Tap-to-confirm kill — stopping an in-flight worker is high blast radius,
	// so it takes two taps within a short window.
	let confirming = $state(false);
	let submitting = $state(false);
	let errorMsg = $state<string | null>(null);
	let confirmTimer: ReturnType<typeof setTimeout> | null = null;
	const CONFIRM_WINDOW_MS = 3000;

	const killable = $derived(typeof job.trace_id === 'string' && job.trace_id.length > 0);

	function disarmConfirm() {
		confirming = false;
		if (confirmTimer) {
			clearTimeout(confirmTimer);
			confirmTimer = null;
		}
	}

	async function handleKillClick() {
		if (submitting || !killable || !job.trace_id) return;
		if (!confirming) {
			confirming = true;
			errorMsg = null;
			confirmTimer = setTimeout(disarmConfirm, CONFIRM_WINDOW_MS);
			return;
		}
		disarmConfirm();
		submitting = true;
		try {
			const resp = await fetch(resolve('/api/workers/kill'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ trace_id: job.trace_id })
			});
			if (!resp.ok) {
				const body = await resp.json().catch(() => ({}));
				errorMsg =
					resp.status === 404
						? 'Worker already exited.'
						: String(body.detail || body.error || `HTTP ${resp.status}`);
				return;
			}
			errorMsg = null;
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			submitting = false;
		}
	}
</script>

<Card class="flex flex-col gap-2 font-mono">
	<div class="flex items-center justify-between gap-2">
		<div class="flex min-w-0 items-center gap-2">
			<span
				class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
				style="background-color: {workerColor(job.worker_id)}"
			></span>
			<span class="shrink-0 text-xs font-bold tracking-wider text-muted-foreground uppercase">
				{workerShortLabel(job.worker_id)}
			</span>
			{#if job.ticket_id}
				<span class="truncate text-xs font-bold text-status-blue">{job.ticket_id}</span>
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-2">
			<span class="text-xs text-muted-foreground">{formatRelativeTime(job.since || '')}</span>
			<button
				type="button"
				disabled={!killable || submitting}
				onclick={handleKillClick}
				onblur={disarmConfirm}
				class="flex items-center gap-1 rounded border px-2 py-1 text-xs font-bold uppercase transition-colors {confirming
					? 'border-status-red bg-status-red/20 text-status-red'
					: 'border-border bg-muted text-muted-foreground hover:border-status-red/50 hover:text-status-red'}"
			>
				{#if submitting}
					<div
						class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
					></div>
				{:else}
					<Square size={10} />
				{/if}
				{confirming ? 'Confirm' : 'Kill'}
			</button>
		</div>
	</div>

	<div class="text-sm leading-snug text-foreground">
		{job.step || 'Initializing…'}
	</div>

	{#if job.branch}
		<div class="truncate text-xs text-muted-foreground">{job.branch}</div>
	{/if}

	{#if errorMsg}
		<div
			class="rounded border border-status-red/30 bg-status-red/10 px-2 py-1 text-xs text-status-red"
		>
			{errorMsg}
		</div>
	{/if}
</Card>
