<script lang="ts">
	import type { WorkerStatus } from '$lib/types/worker';
	import { workerColors } from '$lib/styles/colors';
	import { formatRelativeTime, truncateTraceId } from '$lib/utils/format';
	import { resolve } from '$app/paths';
	import { Activity, Square, RotateCcw, Cpu, Clock, Terminal, AlertCircle, Hash, Play, GitBranch, FileText } from 'lucide-svelte';

	interface Props {
		worker: WorkerStatus;
	}

	let { worker }: Props = $props();

	let workerColor = $derived(workerColors[worker.id] || '#6B7280');
	let stateColor = $derived(
		worker.state === 'busy' ? '#3FB950' : worker.state === 'idle' ? '#6B7280' : '#F85149'
	);

	// Kill button gating + two-click confirmation. Only enabled when the
	// worker is busy AND we have a trace_id to identify it -- the listener
	// looks up the lease by trace_id, so a missing trace_id means there's
	// nothing to kill. Two-click confirmation guards against accidental
	// taps in a multi-card grid where a full modal would be heavy-handed.
	let killable = $derived(worker.state === 'busy' && typeof worker.trace_id === 'string');
	let confirming = $state(false);
	let submitting = $state(false);
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
		// Second click within the window -- fire.
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
				// 404 from the listener means the worker is already gone --
				// not really an error from the operator's POV. Surface a
				// softer message in that case.
				if (resp.status === 404) {
					errorMsg = 'Worker already exited.';
				} else {
					errorMsg = String(detail);
				}
				return;
			}
			// Success -- the next poll will reflect the cleared lease.
			errorMsg = null;
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			submitting = false;
		}
	}
</script>

<div
	class="flex flex-col gap-4 rounded-lg border border-[#21262D] bg-[#161B22] p-4 transition-all hover:border-[#30363D]"
>
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-lg"
				style="background-color: {workerColor}22; color: {workerColor}; border: 1px solid {workerColor}44"
			>
				<Cpu size={24} />
			</div>
			<div>
				<h3 class="text-lg font-semibold text-[#F0F6FC]">{worker.id}</h3>
				<div class="flex items-center gap-2">
					<div class="h-2 w-2 rounded-full" style="background-color: {stateColor}"></div>
					<span class="text-xs font-medium uppercase tracking-wider" style="color: {stateColor}">
						{worker.state}
					</span>
				</div>
			</div>
		</div>

		<div class="flex gap-2">
			<button
				type="button"
				disabled={!killable || submitting}
				onclick={handleKillClick}
				onblur={disarmConfirm}
				title={!killable
					? 'No active worker to kill'
					: confirming
						? 'Click again within 3s to confirm'
						: 'Kill this worker'}
				aria-label="Kill worker"
				class="flex h-8 w-8 items-center justify-center rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-50 {confirming
					? 'border-red-500 bg-red-500/20 text-red-300 hover:bg-red-500/30'
					: 'border-[#30363D] bg-[#21262D] text-[#8B949E] hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300'}"
			>
				{#if submitting}
					<svg
						class="h-4 w-4 animate-spin"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="12" cy="12" r="9" opacity="0.25"></circle>
						<path d="M21 12a9 9 0 0 0-9-9"></path>
					</svg>
				{:else}
					<Square size={16} />
				{/if}
			</button>
			<button
				type="button"
				disabled
				title="Restart Worker — lands in a follow-up PR (v1: kill only)"
				aria-label="Restart worker (disabled in v1)"
				class="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded border border-[#30363D] bg-[#21262D] text-[#8B949E] opacity-50 transition-colors"
			>
				<RotateCcw size={16} />
			</button>
		</div>
	</div>

	{#if errorMsg}
		<div
			class="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-2 font-mono text-[11px] text-red-400"
		>
			<AlertCircle size={14} class="mt-0.5 shrink-0" />
			<span>{errorMsg}</span>
		</div>
	{/if}

	{#if worker.state === 'busy'}
		<div class="flex flex-col gap-3 rounded-md bg-[#0D1117] p-3 border border-[#21262D]">
			<div class="flex flex-col gap-1">
				<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">
					<Play size={10} />
					CURRENT STEP
				</span>
				<span class="text-sm font-medium text-[#A3E635]">
					{worker.step || 'Initializing...'}
				</span>
			</div>
			
			<div class="grid grid-cols-2 gap-4">
				<div class="flex flex-col gap-1">
					<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">
						<Hash size={10} />
						TICKET
					</span>
					<span class="font-mono text-xs text-[#F0F6FC]">
						{worker.ticket_id || '---'}
					</span>
				</div>
				<div class="flex flex-col gap-1">
					<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">
						<GitBranch size={10} />
						BRANCH
					</span>
					<span class="truncate font-mono text-xs text-[#F0F6FC]" title={worker.branch}>
						{worker.branch || '---'}
					</span>
				</div>
			</div>

			{#if worker.last_file_written}
				<div class="flex flex-col gap-1 border-t border-[#21262D] pt-2">
					<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">
						<FileText size={10} />
						LAST WRITE
					</span>
					<span class="truncate font-mono text-[11px] text-[#8B949E]" title={worker.last_file_written}>
						{worker.last_file_written}
					</span>
				</div>
			{/if}
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-4 border-t border-[#21262D] pt-4">
		<div class="flex flex-col gap-1">
			<span class="flex items-center gap-1.5 text-[11px] font-medium text-[#8B949E]">
				<Activity size={12} />
				ACTIVE TRACE
			</span>
			{#if worker.trace_id}
				<span class="font-mono text-xs text-[#F0F6FC]">
					{truncateTraceId(worker.trace_id)}
				</span>
			{:else}
				<span class="text-xs text-[#484F58]">None</span>
			{/if}
		</div>

		<div class="flex flex-col gap-1">
			<span class="flex items-center gap-1.5 text-[11px] font-medium text-[#8B949E]">
				<Terminal size={12} />
				PID
			</span>
			{#if worker.pid}
				<span class="font-mono text-xs text-[#F0F6FC]">
					{worker.pid}
				</span>
			{:else}
				<span class="text-xs text-[#484F58]">---</span>
			{/if}
		</div>

		<div class="flex flex-col gap-1">
			<span class="flex items-center gap-1.5 text-[11px] font-medium text-[#8B949E]">
				<Clock size={12} />
				SINCE
			</span>
			{#if worker.since}
				<span class="text-xs text-[#F0F6FC]">
					{formatRelativeTime(worker.since)}
				</span>
			{:else}
				<span class="text-xs text-[#484F58]">---</span>
			{/if}
		</div>

		{#if worker.state === 'idle' && worker.last_exit_status}
			<div class="flex flex-col gap-1">
				<span class="flex items-center gap-1.5 text-[11px] font-medium text-[#8B949E]">
					<Activity size={12} />
					LAST EXIT
				</span>
				<span class="text-xs font-semibold" style="color: {worker.last_exit_status === 'CONFIRMED_WORKING' ? '#3FB950' : '#F85149'}">
					{worker.last_exit_status}
				</span>
			</div>
		{/if}
	</div>
</div>
