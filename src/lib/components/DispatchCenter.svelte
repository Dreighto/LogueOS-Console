<script lang="ts">
	import { resolve } from '$app/paths';
	import { onDestroy } from 'svelte';
	import {
		Terminal,
		Send,
		Loader2,
		AlertCircle,
		CheckCircle2,
		Clock,
		XCircle,
		AlertTriangle
	} from 'lucide-svelte';
	import type { Run } from '$lib/types/run';
	import { getDispatchWorkers } from '$lib/config/workers';

	// Registry-driven worker roster — drives the Worker dropdown below.
	const dispatchWorkers = getDispatchWorkers();

	const POLL_INTERVAL_MS = 10_000;
	const MAX_WAIT_MS = 11 * 60 * 1000;

	// Role-based routing: pick a `role` (frontend/backend) and let the dispatch
	// listener's routing table choose the worker, OR pin a specific worker.
	// `worker = 'auto'` means "route by role" (send role, no worker).
	let role = $state('backend');
	let worker = $state('auto');
	let targetRepo = $state('project-miru');
	let ticketId = $state('');
	let prompt = $state('');
	let thinkingLevel = $state('none');

	// LOS-92: Track in Linear toggle — when on, file a ticket BEFORE dispatching
	// so the worker runs against a real ticket and outputs link back automatically.
	// Replaces the deactivated W1-Planning-Intake auto-create bridge.
	let trackInLinear = $state(false);
	let linearTitle = $state('');
	let linearTeam = $state('LogueOS');
	let linearProject = $state('');
	let linearPriority = $state(2);

	type Status = 'idle' | 'submitting' | 'waiting' | 'completed' | 'timeout' | 'error';
	let status = $state<Status>('idle');
	let message = $state('');
	let lastTraceId = $state('');
	let lastTicketId = $state('');
	let lastTicketUrl = $state('');
	let elapsedSec = $state(0);
	let terminalRun = $state<Run | null>(null);

	// Team → project options for the dropdowns. Constrained values per CR
	// feedback on the prior PR — free-text caused avoidable filing failures.
	const LINEAR_TEAMS = ['LogueOS', 'Project Miru', 'NASDOOM'] as const;
	const LINEAR_PROJECTS_BY_TEAM: Record<string, string[]> = {
		LogueOS: ['', 'LogueOS Console', 'LogueOS Orchestrator'],
		'Project Miru': ['', 'PM Storefront', 'Miru AI'],
		NASDOOM: ['']
	};
	const linearProjectOptions = $derived(LINEAR_PROJECTS_BY_TEAM[linearTeam] ?? ['']);

	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let tickTimer: ReturnType<typeof setInterval> | null = null;
	let startedAt = 0;

	function clearTimers() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		if (tickTimer) {
			clearInterval(tickTimer);
			tickTimer = null;
		}
	}

	// The listener writes result.json at spawn time with status "spawned" (then
	// updates it when the worker emits a terminal STATUS marker). coerceRunStatus
	// maps anything outside RUN_STATUSES to 'unknown', so the poller has to
	// require a real terminal value before flipping the UI — otherwise we lock
	// in 'unknown' on the first poll, before the worker has even run.
	const TERMINAL_STATUSES = new Set<Run['status']>([
		'CONFIRMED_WORKING',
		'INCONCLUSIVE',
		'FAILED',
		'ESCALATE'
	]);

	async function pollOnce(traceId: string) {
		try {
			const resp = await fetch(resolve(`/api/runs?trace_id=${encodeURIComponent(traceId)}`));
			if (!resp.ok) return;
			const data = await resp.json();
			const run: Run | undefined = data.runs?.[0];
			if (run && TERMINAL_STATUSES.has(run.status)) {
				terminalRun = run;
				status = 'completed';
				clearTimers();
			}
		} catch {
			// transient — try again on next tick
		}
	}

	function startWaiting(traceId: string) {
		lastTraceId = traceId;
		startedAt = Date.now();
		elapsedSec = 0;
		terminalRun = null;
		status = 'waiting';

		tickTimer = setInterval(() => {
			const ms = Date.now() - startedAt;
			elapsedSec = Math.floor(ms / 1000);
			if (ms >= MAX_WAIT_MS) {
				status = 'timeout';
				clearTimers();
			}
		}, 1000);

		pollTimer = setInterval(() => pollOnce(traceId), POLL_INTERVAL_MS);
		// Kick the first poll immediately so quick jobs don't wait 10s.
		pollOnce(traceId);
	}

	function dismiss() {
		clearTimers();
		status = 'idle';
		message = '';
		elapsedSec = 0;
		terminalRun = null;
		lastTicketId = '';
		lastTicketUrl = '';
	}

	function formatElapsed(s: number): string {
		const m = Math.floor(s / 60);
		const r = s % 60;
		return m > 0 ? `${m}m ${r}s` : `${r}s`;
	}

	async function handleSubmit() {
		if (!prompt.trim()) return;
		// LOS-92: enforce title when Track-in-Linear is on. The Linear file step
		// will reject with no title anyway — but catching it client-side avoids
		// the round trip + makes the missing-required-field obvious.
		if (trackInLinear && !linearTitle.trim()) {
			status = 'error';
			message = 'Linear title is required when tracking is on.';
			return;
		}

		clearTimers();
		status = 'submitting';
		message = '';
		terminalRun = null;
		lastTicketId = '';
		lastTicketUrl = '';

		try {
			const response = await fetch(resolve('/api/dispatch'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					role,
					worker: worker === 'auto' ? undefined : worker,
					target_repo: targetRepo,
					ticket_id: ticketId || null,
					prompt,
					thinking_level: thinkingLevel === 'none' ? null : thinkingLevel,
					// LOS-92: pass-through fields. Server-side will file the
					// Linear ticket FIRST then dispatch with the new ticket_id.
					track_in_linear: trackInLinear || undefined,
					linear_title: trackInLinear ? linearTitle.trim() : undefined,
					linear_description: trackInLinear ? prompt : undefined,
					linear_team: trackInLinear ? linearTeam : undefined,
					linear_project: trackInLinear ? linearProject || undefined : undefined,
					linear_priority: trackInLinear ? linearPriority : undefined
				})
			});

			const data = await response.json();

			if (!response.ok) {
				status = 'error';
				message = data.error || 'Something went wrong — please try again';
			} else {
				prompt = '';
				if (trackInLinear) linearTitle = '';
				lastTicketId = data.ticket_id ?? '';
				lastTicketUrl = data.ticket_url ?? '';
				if (data.trace_id) {
					startWaiting(data.trace_id);
				} else {
					status = 'completed';
					message = 'Job sent (no trace id returned).';
				}
			}
		} catch (err) {
			status = 'error';
			message = String(err);
		}
	}

	onDestroy(clearTimers);
</script>

<div
	class="flex h-full flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950 shadow-2xl"
>
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2">
		<div class="flex items-center gap-2 font-mono text-sm tracking-wider text-slate-300 uppercase">
			<Terminal size={16} />
			<span>Job Center</span>
		</div>
		<div class="flex items-center gap-4 font-mono text-[10px]">
			<div class="flex items-center gap-1.5 text-slate-500">
				<span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
				GATEWAY ONLINE
			</div>
		</div>
	</div>

	<!-- Main Body -->
	<div class="flex flex-1 flex-col gap-4 overflow-y-auto p-4 text-slate-100">
		<!-- Config Row -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
			<div class="flex flex-col gap-1.5">
				<label for="role" class="font-mono text-[10px] text-slate-500 uppercase">Role</label>
				<select
					id="role"
					bind:value={role}
					class="rounded border border-slate-800 bg-slate-900 p-1.5 font-mono text-xs text-slate-200 transition-colors focus:border-blue-500 focus:outline-none"
				>
					<option value="frontend">Frontend (UI)</option>
					<option value="backend">Backend (code & logic)</option>
				</select>
			</div>

			<div class="flex flex-col gap-1.5">
				<label for="worker" class="font-mono text-[10px] text-slate-500 uppercase">Worker</label>
				<select
					id="worker"
					bind:value={worker}
					class="rounded border border-slate-800 bg-slate-900 p-1.5 font-mono text-xs text-slate-200 transition-colors focus:border-blue-500 focus:outline-none"
				>
					<option value="auto">Auto (route by role)</option>
					{#each dispatchWorkers as w (w.id)}
						<option value={w.dispatchName}>{w.label}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1.5">
				<label for="repo" class="font-mono text-[10px] text-slate-500 uppercase"
					>Which project?</label
				>
				<select
					id="repo"
					bind:value={targetRepo}
					class="rounded border border-slate-800 bg-slate-900 p-1.5 font-mono text-xs text-slate-200 transition-colors focus:border-blue-500 focus:outline-none"
				>
					<option value="project-miru">project-miru</option>
					<option value="LogueOS-Console">LogueOS-Console</option>
					<option value="LogueOS-Orchestrator">LogueOS-Orchestrator</option>
				</select>
			</div>

			<div class="flex flex-col gap-1.5">
				<label for="ticket" class="font-mono text-[10px] text-slate-500 uppercase"
					>Ticket ID (Optional)</label
				>
				<input
					id="ticket"
					type="text"
					bind:value={ticketId}
					placeholder="e.g. LOS-65"
					class="rounded border border-slate-800 bg-slate-900 p-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-700 focus:border-blue-500 focus:outline-none"
				/>
			</div>
		</div>

		<!-- Advanced Row -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<div class="flex flex-col gap-1.5">
				<label for="thinking" class="font-mono text-[10px] text-slate-500 uppercase"
					>Thinking Level</label
				>
				<select
					id="thinking"
					bind:value={thinkingLevel}
					class="rounded border border-slate-800 bg-slate-900 p-1.5 font-mono text-xs text-slate-200 transition-colors focus:border-blue-500 focus:outline-none"
				>
					<option value="none">Standard</option>
					<option value="extended">Extended Thinking</option>
				</select>
			</div>

			<!-- LOS-92: Track in Linear toggle. Off by default = current behavior
			     (direct dispatch, no Linear ticket). On = file Linear ticket first,
			     dispatch worker against it. -->
			<div class="flex flex-col justify-end gap-1.5">
				<label for="track" class="font-mono text-[10px] text-slate-500 uppercase"
					>Track in Linear</label
				>
				<button
					id="track"
					type="button"
					onclick={() => (trackInLinear = !trackInLinear)}
					class="flex items-center gap-2 rounded border p-1.5 font-mono text-xs transition-colors {trackInLinear
						? 'border-purple-500/40 bg-purple-900/30 text-purple-300'
						: 'border-slate-800 bg-slate-900 text-slate-500 hover:border-slate-700'}"
				>
					<span
						class="flex h-3 w-3 items-center justify-center rounded-sm border text-[8px] {trackInLinear
							? 'border-purple-400 bg-purple-500 text-white'
							: 'border-slate-600'}"
					>
						{#if trackInLinear}✓{/if}
					</span>
					{trackInLinear ? 'On — files a ticket' : 'Off — direct dispatch'}
				</button>
			</div>
		</div>

		{#if trackInLinear}
			<!-- Linear ticket fields — revealed only when toggle is on. -->
			<div
				class="flex flex-col gap-3 rounded border border-purple-800/30 bg-purple-950/20 px-3 py-3"
			>
				<div class="font-mono text-[10px] tracking-wider text-purple-400 uppercase">
					Linear Ticket Fields
				</div>
				<div class="flex flex-col gap-1.5">
					<label for="linear-title" class="font-mono text-[10px] text-slate-500 uppercase">
						Title <span class="text-red-400">*</span>
					</label>
					<input
						id="linear-title"
						type="text"
						bind:value={linearTitle}
						placeholder="One-line summary of the work"
						class="rounded border border-slate-800 bg-slate-900 p-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-700 focus:border-purple-500 focus:outline-none"
					/>
				</div>
				<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
					<div class="flex flex-col gap-1.5">
						<label for="linear-team" class="font-mono text-[10px] text-slate-500 uppercase"
							>Team</label
						>
						<select
							id="linear-team"
							bind:value={linearTeam}
							class="rounded border border-slate-800 bg-slate-900 p-1.5 font-mono text-xs text-slate-200 focus:border-purple-500 focus:outline-none"
						>
							{#each LINEAR_TEAMS as t (t)}
								<option value={t}>{t}</option>
							{/each}
						</select>
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="linear-project" class="font-mono text-[10px] text-slate-500 uppercase">
							Project (optional)
						</label>
						<select
							id="linear-project"
							bind:value={linearProject}
							class="rounded border border-slate-800 bg-slate-900 p-1.5 font-mono text-xs text-slate-200 focus:border-purple-500 focus:outline-none"
						>
							{#each linearProjectOptions as p (p)}
								<option value={p}>{p || '— none —'}</option>
							{/each}
						</select>
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="linear-priority" class="font-mono text-[10px] text-slate-500 uppercase">
							Priority
						</label>
						<select
							id="linear-priority"
							bind:value={linearPriority}
							class="rounded border border-slate-800 bg-slate-900 p-1.5 font-mono text-xs text-slate-200 focus:border-purple-500 focus:outline-none"
						>
							<option value={0}>0 — No priority</option>
							<option value={1}>1 — Urgent</option>
							<option value={2}>2 — High</option>
							<option value={3}>3 — Medium</option>
							<option value={4}>4 — Low</option>
						</select>
					</div>
				</div>
			</div>
		{/if}

		<!-- Prompt Area -->
		<div class="flex min-h-[150px] flex-1 flex-col gap-1.5">
			<label for="prompt" class="font-mono text-[10px] text-slate-500 uppercase"
				>Describe what needs to be done</label
			>
			<textarea
				id="prompt"
				bind:value={prompt}
				placeholder="What needs to be done?"
				class="flex-1 resize-none rounded border border-slate-800 bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-200 placeholder:text-slate-700 focus:border-blue-500 focus:outline-none"
			></textarea>
		</div>

		<!-- Status Bar -->
		{#if status !== 'idle'}
			{@const completedStatus = terminalRun?.status}
			{@const completedTone =
				completedStatus === 'CONFIRMED_WORKING'
					? 'green'
					: completedStatus === 'INCONCLUSIVE'
						? 'amber'
						: 'red'}
			<div
				class="flex items-start gap-3 rounded border px-3 py-2 font-mono text-xs {status ===
				'submitting'
					? 'border-blue-500/20 bg-blue-500/10 text-blue-400'
					: status === 'waiting'
						? 'border-blue-500/20 bg-blue-500/10 text-blue-300'
						: status === 'timeout'
							? 'border-amber-500/20 bg-amber-500/10 text-amber-400'
							: status === 'completed' && completedTone === 'green'
								? 'border-green-500/20 bg-green-500/10 text-green-400'
								: status === 'completed' && completedTone === 'amber'
									? 'border-amber-500/20 bg-amber-500/10 text-amber-400'
									: status === 'completed'
										? 'border-red-500/20 bg-red-500/10 text-red-400'
										: 'border-red-500/20 bg-red-500/10 text-red-400'}"
			>
				{#if status === 'submitting'}
					<Loader2 size={14} class="mt-0.5 animate-spin" />
					<span>Sending...</span>
				{:else if status === 'waiting'}
					<span class="relative mt-0.5 flex h-3 w-3">
						<span
							class="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60"
						></span>
						<span class="relative inline-flex h-3 w-3 rounded-full bg-blue-500"></span>
					</span>
					<div class="flex flex-1 flex-col gap-0.5">
						<div class="flex items-center gap-2">
							<Clock size={12} />
							<span>Worker running... {formatElapsed(elapsedSec)}</span>
						</div>
						<span class="text-[10px] opacity-70">Ref: {lastTraceId}</span>
						{#if lastTicketId && lastTicketUrl}
							<a
								href={lastTicketUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="w-fit text-[10px] text-purple-300 underline hover:text-purple-200"
							>
								Filed: {lastTicketId} →
							</a>
						{/if}
					</div>
					<button
						type="button"
						onclick={dismiss}
						class="mt-0.5 text-[10px] underline opacity-70 hover:opacity-100"
					>
						dismiss
					</button>
				{:else if status === 'completed' && terminalRun}
					{#if completedStatus === 'CONFIRMED_WORKING'}
						<CheckCircle2 size={14} class="mt-0.5" />
					{:else if completedStatus === 'INCONCLUSIVE'}
						<AlertTriangle size={14} class="mt-0.5" />
					{:else}
						<XCircle size={14} class="mt-0.5" />
					{/if}
					<div class="flex flex-1 flex-col gap-0.5">
						<span class="font-bold">{completedStatus?.replace('_', ' ')}</span>
						{#if terminalRun.summary}
							<span class="leading-relaxed opacity-90">{terminalRun.summary}</span>
						{/if}
						<div class="flex flex-wrap items-center gap-3 text-[10px] opacity-70">
							<span>Ref: {lastTraceId}</span>
							{#if lastTicketId && lastTicketUrl}
								<a
									href={lastTicketUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="text-purple-300 underline hover:text-purple-200"
								>
									Filed: {lastTicketId} →
								</a>
							{/if}
							{#if completedStatus === 'FAILED' || completedStatus === 'ESCALATE'}
								<a href={resolve('/activity')} class="underline">View in Activity →</a>
							{/if}
						</div>
					</div>
					<button
						type="button"
						onclick={dismiss}
						class="mt-0.5 text-[10px] underline opacity-70 hover:opacity-100"
					>
						dismiss
					</button>
				{:else if status === 'completed'}
					<CheckCircle2 size={14} class="mt-0.5" />
					<span>{message}</span>
					<button
						type="button"
						onclick={dismiss}
						class="mt-0.5 ml-auto text-[10px] underline opacity-70 hover:opacity-100"
					>
						dismiss
					</button>
				{:else if status === 'timeout'}
					<AlertTriangle size={14} class="mt-0.5" />
					<div class="flex flex-1 flex-col gap-0.5">
						<span>Worker may have timed out — no terminal status after 11 min.</span>
						<div class="flex items-center gap-3 text-[10px] opacity-70">
							<span>Ref: {lastTraceId}</span>
							<a href={resolve('/activity')} class="underline">Check Activity →</a>
						</div>
					</div>
					<button
						type="button"
						onclick={dismiss}
						class="mt-0.5 text-[10px] underline opacity-70 hover:opacity-100"
					>
						dismiss
					</button>
				{:else if status === 'error'}
					<AlertCircle size={14} class="mt-0.5" />
					<span>{message}</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Footer / Action -->
	<div class="flex justify-end border-t border-slate-800 bg-slate-900/50 px-4 py-3">
		<button
			onclick={handleSubmit}
			disabled={status === 'submitting' || status === 'waiting' || !prompt.trim()}
			class="flex items-center gap-2 rounded bg-blue-600 px-6 py-2 font-mono text-xs font-bold text-white shadow-lg shadow-blue-900/20 transition-all hover:bg-blue-500 active:scale-95 disabled:bg-slate-800 disabled:text-slate-600"
		>
			{#if status === 'submitting'}
				<Loader2 size={14} class="animate-spin" />
				Sending...
			{:else}
				<Send size={14} />
				Send this job
			{/if}
		</button>
	</div>
</div>

<style>
	select {
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23475569'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.5rem center;
		background-size: 1rem;
		padding-right: 2rem;
	}
</style>
