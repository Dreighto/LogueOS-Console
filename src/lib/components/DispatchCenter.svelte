<script lang="ts">
	import { resolve } from '$app/paths';
	import { onDestroy } from 'svelte';
	import { Terminal, Send, Loader2, AlertCircle, CheckCircle2, Clock, XCircle, AlertTriangle } from 'lucide-svelte';
	import type { Run } from '$lib/types/run';

	const POLL_INTERVAL_MS = 10_000;
	const MAX_WAIT_MS = 11 * 60 * 1000;

	let worker = $state('claude-code');
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
		if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
		if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
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
					worker,
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

<div class="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
	<!-- Header -->
	<div class="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800">
		<div class="flex items-center gap-2 text-slate-300 font-mono text-sm uppercase tracking-wider">
			<Terminal size={16} />
			<span>Job Center</span>
		</div>
		<div class="flex items-center gap-4 text-[10px] font-mono">
			<div class="flex items-center gap-1.5 text-slate-500">
				<span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
				GATEWAY ONLINE
			</div>
		</div>
	</div>

	<!-- Main Body -->
	<div class="flex-1 p-4 flex flex-col gap-4 overflow-y-auto text-slate-100">
		<!-- Config Row -->
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<div class="flex flex-col gap-1.5">
				<label for="worker" class="text-[10px] font-mono text-slate-500 uppercase">Who should handle this?</label>
				<select
					id="worker"
					bind:value={worker}
					class="bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-1.5 rounded focus:outline-none focus:border-blue-500 transition-colors"
				>
					<option value="claude-code">Claude (backend & code)</option>
					<option value="gemini">Gemini (UI & frontend)</option>
				</select>
			</div>

			<div class="flex flex-col gap-1.5">
				<label for="repo" class="text-[10px] font-mono text-slate-500 uppercase">Which project?</label>
				<select
					id="repo"
					bind:value={targetRepo}
					class="bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-1.5 rounded focus:outline-none focus:border-blue-500 transition-colors"
				>
					<option value="project-miru">project-miru</option>
					<option value="LogueOS-Console">LogueOS-Console</option>
					<option value="LogueOS-Orchestrator">LogueOS-Orchestrator</option>
				</select>
			</div>

			<div class="flex flex-col gap-1.5">
				<label for="ticket" class="text-[10px] font-mono text-slate-500 uppercase">Ticket ID (Optional)</label>
				<input
					id="ticket"
					type="text"
					bind:value={ticketId}
					placeholder="e.g. LOS-65"
					class="bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-1.5 rounded focus:outline-none focus:border-blue-500 placeholder:text-slate-700"
				/>
			</div>
		</div>

		<!-- Advanced Row -->
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<div class="flex flex-col gap-1.5">
				<label for="thinking" class="text-[10px] font-mono text-slate-500 uppercase">Thinking Level</label>
				<select
					id="thinking"
					bind:value={thinkingLevel}
					class="bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-1.5 rounded focus:outline-none focus:border-blue-500 transition-colors"
				>
					<option value="none">Standard</option>
					<option value="extended">Extended Thinking</option>
				</select>
			</div>

			<!-- LOS-92: Track in Linear toggle. Off by default = current behavior
			     (direct dispatch, no Linear ticket). On = file Linear ticket first,
			     dispatch worker against it. -->
			<div class="flex flex-col gap-1.5 justify-end">
				<label for="track" class="text-[10px] font-mono text-slate-500 uppercase">Track in Linear</label>
				<button
					id="track"
					type="button"
					onclick={() => (trackInLinear = !trackInLinear)}
					class="flex items-center gap-2 font-mono text-xs p-1.5 rounded border transition-colors {trackInLinear
						? 'bg-purple-900/30 border-purple-500/40 text-purple-300'
						: 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700'}"
				>
					<span
						class="w-3 h-3 rounded-sm border flex items-center justify-center text-[8px] {trackInLinear
							? 'bg-purple-500 border-purple-400 text-white'
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
			<div class="flex flex-col gap-3 px-3 py-3 bg-purple-950/20 border border-purple-800/30 rounded">
				<div class="text-[10px] font-mono text-purple-400 uppercase tracking-wider">
					Linear Ticket Fields
				</div>
				<div class="flex flex-col gap-1.5">
					<label for="linear-title" class="text-[10px] font-mono text-slate-500 uppercase">
						Title <span class="text-red-400">*</span>
					</label>
					<input
						id="linear-title"
						type="text"
						bind:value={linearTitle}
						placeholder="One-line summary of the work"
						class="bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-1.5 rounded focus:outline-none focus:border-purple-500 placeholder:text-slate-700"
					/>
				</div>
				<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
					<div class="flex flex-col gap-1.5">
						<label for="linear-team" class="text-[10px] font-mono text-slate-500 uppercase">Team</label>
						<select
							id="linear-team"
							bind:value={linearTeam}
							class="bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-1.5 rounded focus:outline-none focus:border-purple-500"
						>
							{#each LINEAR_TEAMS as t (t)}
								<option value={t}>{t}</option>
							{/each}
						</select>
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="linear-project" class="text-[10px] font-mono text-slate-500 uppercase">
							Project (optional)
						</label>
						<select
							id="linear-project"
							bind:value={linearProject}
							class="bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-1.5 rounded focus:outline-none focus:border-purple-500"
						>
							{#each linearProjectOptions as p (p)}
								<option value={p}>{p || '— none —'}</option>
							{/each}
						</select>
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="linear-priority" class="text-[10px] font-mono text-slate-500 uppercase">
							Priority
						</label>
						<select
							id="linear-priority"
							bind:value={linearPriority}
							class="bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-1.5 rounded focus:outline-none focus:border-purple-500"
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
		<div class="flex-1 flex flex-col gap-1.5 min-h-[150px]">
			<label for="prompt" class="text-[10px] font-mono text-slate-500 uppercase">Describe what needs to be done</label>
			<textarea
				id="prompt"
				bind:value={prompt}
				placeholder="What needs to be done?"
				class="flex-1 bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-3 rounded focus:outline-none focus:border-blue-500 placeholder:text-slate-700 resize-none leading-relaxed"
			></textarea>
		</div>

		<!-- Status Bar -->
		{#if status !== 'idle'}
			{@const completedStatus = terminalRun?.status}
			{@const completedTone = completedStatus === 'CONFIRMED_WORKING'
				? 'green'
				: completedStatus === 'INCONCLUSIVE'
					? 'amber'
					: 'red'}
			<div
				class="flex items-start gap-3 px-3 py-2 rounded text-xs font-mono border {
					status === 'submitting' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
					status === 'waiting' ? 'bg-blue-500/10 border-blue-500/20 text-blue-300' :
					status === 'timeout' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
					status === 'completed' && completedTone === 'green' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
					status === 'completed' && completedTone === 'amber' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
					status === 'completed' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
					'bg-red-500/10 border-red-500/20 text-red-400'
				}"
			>
				{#if status === 'submitting'}
					<Loader2 size={14} class="animate-spin mt-0.5" />
					<span>Sending...</span>
				{:else if status === 'waiting'}
					<span class="relative flex h-3 w-3 mt-0.5">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-60"></span>
						<span class="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
					</span>
					<div class="flex-1 flex flex-col gap-0.5">
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
								class="text-[10px] underline text-purple-300 hover:text-purple-200 w-fit"
							>
								Filed: {lastTicketId} →
							</a>
						{/if}
					</div>
					<button
						type="button"
						onclick={dismiss}
						class="text-[10px] underline opacity-70 hover:opacity-100 mt-0.5"
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
					<div class="flex-1 flex flex-col gap-0.5">
						<span class="font-bold">{completedStatus?.replace('_', ' ')}</span>
						{#if terminalRun.summary}
							<span class="opacity-90 leading-relaxed">{terminalRun.summary}</span>
						{/if}
						<div class="flex items-center gap-3 text-[10px] opacity-70 flex-wrap">
							<span>Ref: {lastTraceId}</span>
							{#if lastTicketId && lastTicketUrl}
								<a
									href={lastTicketUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="underline text-purple-300 hover:text-purple-200"
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
						class="text-[10px] underline opacity-70 hover:opacity-100 mt-0.5"
					>
						dismiss
					</button>
				{:else if status === 'completed'}
					<CheckCircle2 size={14} class="mt-0.5" />
					<span>{message}</span>
					<button
						type="button"
						onclick={dismiss}
						class="ml-auto text-[10px] underline opacity-70 hover:opacity-100 mt-0.5"
					>
						dismiss
					</button>
				{:else if status === 'timeout'}
					<AlertTriangle size={14} class="mt-0.5" />
					<div class="flex-1 flex flex-col gap-0.5">
						<span>Worker may have timed out — no terminal status after 11 min.</span>
						<div class="flex items-center gap-3 text-[10px] opacity-70">
							<span>Ref: {lastTraceId}</span>
							<a href={resolve('/activity')} class="underline">Check Activity →</a>
						</div>
					</div>
					<button
						type="button"
						onclick={dismiss}
						class="text-[10px] underline opacity-70 hover:opacity-100 mt-0.5"
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
	<div class="px-4 py-3 bg-slate-900/50 border-t border-slate-800 flex justify-end">
		<button
			onclick={handleSubmit}
			disabled={status === 'submitting' || status === 'waiting' || !prompt.trim()}
			class="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-xs font-mono font-bold px-6 py-2 rounded transition-all active:scale-95 shadow-lg shadow-blue-900/20"
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
