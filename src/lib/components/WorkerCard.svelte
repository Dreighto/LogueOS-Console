<script lang="ts">
	import type { WorkerStatus } from '$lib/types/worker';
	import { formatRelativeTime } from '$lib/utils/format';
	import { workerLabel } from '$lib/config/workers';
	import { resolve } from '$app/paths';
	import { Square, AlertCircle, Play, Clock } from 'lucide-svelte';
	import { scale, fade } from 'svelte/transition';

	interface Props {
		worker: WorkerStatus;
	}

	let { worker }: Props = $props();

	// Map internal states to operator-facing labels and colors
	let stateInfo = $derived({
		label: worker.state === 'busy' ? 'Active' : worker.state === 'idle' ? 'Available' : 'Offline',
		color: worker.state === 'busy' ? '#3B82F6' : worker.state === 'idle' ? '#3FB950' : '#8B949E'
	});

	// Kill button logic
	let killable = $derived(worker.state === 'busy' && typeof worker.trace_id === 'string');
	let confirming = $state(false);
	let submitting = $state(false);
	const EXIT_STATUS_LABELS: Record<string, string> = {
		CONFIRMED_WORKING: 'Completed successfully',
		INCONCLUSIVE: 'Stopped — needs follow-up',
		FAILED: 'Failed',
		'ESCALATE: HUMAN-REQUIRED': 'Escalated — needs your attention',
		'ESCALATE: REPEATED_FAILURE': 'Repeated failure — escalated'
	};

	function formatExitStatus(status: string | null | undefined): string {
		if (!status) return 'Unknown';
		return EXIT_STATUS_LABELS[status] ?? 'Last session ended unexpectedly.';
	}

	let errorMsg = $state<string | null>(null);
	let confirmTimer: ReturnType<typeof setTimeout> | null = null;
	const CONFIRM_WINDOW_MS = 3000;

	function disarmConfirm() {
		confirming = false;
		if (confirmTimer) {
			clearTimeout(confirmTimer);
			confirmTimer = null;
		}
	}

	async function handleKillClick() {
		if (submitting || !killable || !worker.trace_id) return;
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
				body: JSON.stringify({ trace_id: worker.trace_id })
			});
			if (!resp.ok) {
				const body = await resp.json().catch(() => ({}));
				const detail = body.detail || body.error || `HTTP ${resp.status}`;
				if (resp.status === 404) {
					errorMsg = 'Worker already exited.';
				} else {
					errorMsg = String(detail);
				}
				return;
			}
			errorMsg = null;
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			submitting = false;
		}
	}

	// Operational notes only shown when there is an actual issue (e.g. failure)
	let hasIssue = $derived(
		worker.last_exit_status &&
			!['CONFIRMED_WORKING', 'INCONCLUSIVE'].includes(worker.last_exit_status)
	);
</script>

<div
	class="flex flex-col gap-2 rounded-sm border border-border bg-surface p-2.5 font-mono transition-all hover:border-[#444C56] active:scale-[0.99]"
>
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<div
				class="h-2 w-2 rounded-full transition-colors duration-500"
				style="background-color: {stateInfo.color}"
			></div>
			<h3 class="text-xs font-bold tracking-wider text-[#F0F6FC] uppercase">
				{workerLabel(worker.id)}
			</h3>
		</div>
		<span class="text-[10px] font-medium tracking-widest text-[#8B949E] uppercase">
			{stateInfo.label}
		</span>
	</div>

	{#if worker.state === 'busy'}
		<div
			in:scale={{ duration: 300, start: 0.95 }}
			out:fade={{ duration: 150 }}
			class="flex flex-col gap-3 py-1"
		>
			<div class="flex flex-col gap-1">
				<span
					class="flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-[#8B949E] uppercase"
				>
					<Play size={10} />
					WORKING ON
				</span>
				<div class="text-sm leading-snug font-medium text-[#F0F6FC]">
					{#if worker.ticket_id}
						<span class="text-[#3B82F6]">{worker.ticket_id}:</span>
					{/if}
					{worker.step || 'Initializing...'}
				</div>
			</div>

			<div class="flex items-center justify-between">
				<div class="flex flex-col gap-1">
					<span
						class="flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-[#8B949E] uppercase"
					>
						<Clock size={10} />
						ELAPSED
					</span>
					<span class="text-xs text-[#F0F6FC]">
						{formatRelativeTime(worker.since || '')}
					</span>
				</div>

				<button
					type="button"
					disabled={!killable || submitting}
					onclick={handleKillClick}
					onblur={disarmConfirm}
					class="flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-bold uppercase transition-colors {confirming
						? 'border-red-500 bg-red-500/20 text-red-400'
						: 'border-[#30363D] bg-[#21262D] text-[#8B949E] hover:border-red-500/50 hover:text-red-400'}"
				>
					{#if submitting}
						<div
							class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
						></div>
					{:else}
						<Square size={10} />
					{/if}
					{confirming ? 'CONFIRM' : 'KILL'}
				</button>
			</div>
		</div>
	{:else if worker.state === 'idle'}
		<div
			in:fade={{ duration: 300 }}
			class="flex h-12 items-center justify-center rounded-sm border border-dashed border-[#30363D] bg-background"
		>
			<span class="text-[10px] font-bold tracking-widest text-[#484F58] uppercase">[ IDLE ]</span>
		</div>
	{:else}
		<div
			in:fade={{ duration: 300 }}
			class="flex h-12 items-center justify-center rounded-sm border border-dashed border-[#484F58]/30 bg-background"
		>
			<span class="text-[10px] font-bold tracking-widest text-[#484F58]/50 uppercase"
				>[ OFFLINE ]</span
			>
		</div>
	{/if}

	{#if hasIssue || errorMsg}
		<div
			in:scale={{ duration: 200, start: 0.9 }}
			class="mt-1 flex items-start gap-2 rounded border border-red-900/30 bg-red-900/10 p-2 text-[10px] text-red-400"
		>
			<AlertCircle size={14} class="mt-0.5 shrink-0" />
			<div class="flex flex-col gap-0.5">
				<span class="font-bold tracking-wider uppercase">Operational Note</span>
				<span>{errorMsg || formatExitStatus(worker.last_exit_status)}</span>
			</div>
		</div>
	{/if}
</div>
