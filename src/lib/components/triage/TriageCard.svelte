<script lang="ts">
	import { Check, X, Edit3, ChevronDown, HelpCircle, AlertTriangle } from 'lucide-svelte';
	import type { TriageSuggestion, JudgmentDecision } from '$lib/types/judgment';
	import { resolve } from '$app/paths';
	import { formatRelativeTime } from '$lib/utils/format';
	import { workerLabel } from '$lib/config/workers';

	let {
		suggestion,
		onDecision
	}: {
		suggestion: TriageSuggestion;
		onDecision: (decision: JudgmentDecision, operatorLabel?: string) => void;
	} = $props();

	let isEditing = $state(false);
	let customLabel = $state('');
	let isProcessing = $state(false);
	let detailsOpen = $state(false);

	function handleAgree() {
		if (isProcessing) return;
		isProcessing = true;
		onDecision('accept');
	}

	function handleOverride() {
		if (isProcessing) return;
		isProcessing = true;
		onDecision('reject');
	}

	function handleEdit() {
		isEditing = true;
		customLabel = suggestion.suggestion.suggested_label || '';
	}

	function handleSubmitEdit() {
		if (isProcessing || !customLabel.trim()) return;
		isProcessing = true;
		onDecision('edit', customLabel.trim());
	}

	function handleCancelEdit() {
		isEditing = false;
		customLabel = '';
	}

	// Translate the cryptic suggested_label into something an operator can
	// read at a glance + map to a color signal.
	const labelDisplay = $derived.by(() => {
		const lbl = (suggestion.suggestion.suggested_label || '').toLowerCase();
		// Tier 1 — definite success / failure
		if (lbl === 'good' || lbl === 'accepted' || lbl === 'success')
			return { text: 'Looks like a success', tone: 'good' as const, icon: 'check' as const };
		if (lbl === 'bad' || lbl === 'rejected' || lbl === 'failed')
			return { text: 'Looks like a failure', tone: 'bad' as const, icon: 'x' as const };
		// Tier 2 — uncertain
		if (lbl === 'needs_review' || lbl === 'inconclusive' || lbl === 'review')
			return { text: 'Needs your judgment', tone: 'unsure' as const, icon: 'help' as const };
		// Fallback — show the raw label but with neutral tone
		return {
			text: suggestion.suggestion.suggested_label,
			tone: 'unsure' as const,
			icon: 'help' as const
		};
	});

	// Translate the most common derived rationale strings into plain English.
	// Falls back to the raw rationale if there's no match.
	const plainRationale = $derived.by(() => {
		const raw = (suggestion.suggestion.rationale || '').toLowerCase();
		if (!raw) return null;
		if (
			raw.includes("outcome='inconclusive_clean'") ||
			raw.includes('outcome=inconclusive_clean')
		) {
			const hasStderr = raw.includes('stderr present');
			return hasStderr
				? 'Worker exited cleanly but produced stderr output and never opened a PR or set a definitive marker. The system can’t tell on its own whether the run actually accomplished anything.'
				: 'Worker exited cleanly but never opened a PR or set a definitive success/failure marker. The system can’t tell on its own whether the run actually accomplished anything.';
		}
		if (raw.includes('outcome=success') || raw.includes("outcome='success'"))
			return 'Worker reported success with exit code 0 and no errors on stderr.';
		if (raw.includes("outcome='failed'") || raw.includes('outcome=failed'))
			return 'Worker reported failure.';
		if (raw.includes('timeout')) return 'Worker was killed for hitting the dispatch timeout.';
		if (raw.includes('refused'))
			return 'Worker refused the dispatch (kill switch, pre-flight gate, or similar).';
		// Unknown — surface the raw string but tagged so it doesn't read as plain prose.
		return suggestion.suggestion.rationale;
	});

	// Translate worker outcome (kernel terminology) to operator-friendly text.
	const outcomeDisplay = $derived.by(() => {
		const o = (suggestion.run.outcome || '').toLowerCase();
		const map: Record<string, string> = {
			success: 'Reported success',
			failed: 'Reported failure',
			inconclusive_clean: 'Exited cleanly, no PR',
			inconclusive: 'Inconclusive',
			timeout: 'Timed out',
			refused: 'Refused (gate)'
		};
		return map[o] || suggestion.run.outcome;
	});

	// Confidence pill color.
	const confidenceColor = $derived.by(() => {
		const c = (suggestion.suggestion.confidence || '').toLowerCase();
		if (c.includes('high')) return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30';
		if (c.includes('medium')) return 'text-amber-300 bg-amber-500/10 border-amber-500/30';
		if (c.includes('low')) return 'text-red-300 bg-red-500/10 border-red-500/30';
		return 'text-zinc-300 bg-zinc-500/10 border-zinc-500/30';
	});

	// Tone classes for the big system-suggestion callout.
	const toneClasses = $derived.by(() => {
		switch (labelDisplay.tone) {
			case 'good':
				return 'border-emerald-500/40 bg-emerald-500/5 text-emerald-200';
			case 'bad':
				return 'border-red-500/40 bg-red-500/5 text-red-200';
			default:
				return 'border-amber-500/40 bg-amber-500/5 text-amber-200';
		}
	});

	const startedIso = suggestion.run.started_at;
	const startedRelative = $derived(startedIso ? formatRelativeTime(startedIso) : '');
	const durationDisplay = $derived.by(() => {
		const ms = suggestion.run.duration_ms;
		if (!ms || ms < 0) return null;
		const s = Math.round(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.round(s / 60);
		if (m < 60) return `${m}m`;
		const h = Math.round(m / 60);
		return `${h}h`;
	});
	const friendlyWorker = $derived(workerLabel(suggestion.run.worker) || suggestion.run.worker);
</script>

<div data-testid="triage-card" class="mx-auto w-full max-w-2xl">
	<div class="space-y-5 rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-4 transition-all">
		<!-- Header strip: who ran what + when + project -->
		<div class="flex flex-wrap items-center gap-2 text-xs">
			<span
				class="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/15 px-2.5 py-1 font-mono tracking-wide text-cyan-200 uppercase"
			>
				{friendlyWorker}
			</span>
			{#if startedRelative}
				<span class="text-zinc-400" title={startedIso ?? ''}>{startedRelative}</span>
			{/if}
			{#if suggestion.run.project_id}
				<span class="text-zinc-500">·</span>
				<span class="font-mono text-zinc-400">{suggestion.run.project_id}</span>
			{/if}
			{#if outcomeDisplay}
				<span class="text-zinc-500">·</span>
				<span class="text-zinc-400">{outcomeDisplay}</span>
			{/if}
			{#if durationDisplay}
				<span class="text-zinc-500">·</span>
				<span class="text-zinc-400">{durationDisplay}</span>
			{/if}
		</div>

		<!-- The big system suggestion callout -->
		<div class="border {toneClasses} space-y-1 rounded-lg p-4">
			<div class="text-xs tracking-wider uppercase opacity-70">System thinks this run was:</div>
			<div class="flex items-center gap-2 text-lg font-semibold">
				{#if labelDisplay.icon === 'check'}
					<Check size={20} />
				{:else if labelDisplay.icon === 'x'}
					<X size={20} />
				{:else}
					<HelpCircle size={20} />
				{/if}
				<span>{labelDisplay.text}</span>
				<span
					class="ml-auto inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs uppercase {confidenceColor}"
				>
					{suggestion.suggestion.confidence} confidence
				</span>
			</div>
		</div>

		<!-- Why -->
		{#if plainRationale}
			<div class="space-y-1.5">
				<div class="text-xs tracking-wider text-zinc-500 uppercase">Why the system thinks so</div>
				<p class="text-sm leading-relaxed text-zinc-200">{plainRationale}</p>
			</div>
		{/if}

		<!-- Edit mode or the question + actions -->
		{#if isEditing}
			<div class="space-y-3 border-t border-zinc-800/60 pt-4">
				<div class="text-sm font-medium text-zinc-300">
					What label should this run actually have?
				</div>
				<input
					bind:value={customLabel}
					type="text"
					class="w-full rounded-lg border border-zinc-700/50 bg-zinc-900 px-3 py-2 text-[16px] text-zinc-100 transition-colors focus:border-zinc-600 focus:ring-0 focus:outline-none"
					placeholder="e.g. partial_success, ran_but_no_pr, …"
					autocomplete="off"
					autocorrect="off"
					autocapitalize="none"
				/>
				<div class="flex gap-2">
					<button
						onclick={handleSubmitEdit}
						disabled={!customLabel.trim() || isProcessing}
						class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-emerald-500 active:scale-95 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:active:scale-100"
					>
						<Check size={14} />
						Save label
					</button>
					<button
						onclick={handleCancelEdit}
						disabled={isProcessing}
						class="flex items-center gap-2 rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-all hover:bg-zinc-600 active:scale-95 disabled:opacity-50"
					>
						Cancel
					</button>
				</div>
			</div>
		{:else}
			<div class="space-y-3 border-t border-zinc-800/60 pt-4">
				<div class="text-sm font-medium text-zinc-200">Was the system right?</div>
				<div class="flex gap-2">
					<button
						onclick={handleAgree}
						disabled={isProcessing}
						class="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-emerald-600 py-3 font-medium text-white transition-all hover:bg-emerald-500 active:scale-95 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:active:scale-100"
					>
						<Check size={18} />
						<span class="text-sm">Yes, agree</span>
					</button>
					<button
						onclick={handleOverride}
						disabled={isProcessing}
						class="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-red-600 py-3 font-medium text-white transition-all hover:bg-red-500 active:scale-95 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:active:scale-100"
					>
						<X size={18} />
						<span class="text-sm">No, override</span>
					</button>
					<button
						onclick={handleEdit}
						disabled={isProcessing}
						data-edit-button
						class="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-zinc-700 py-3 font-medium text-zinc-200 transition-all hover:bg-zinc-600 active:scale-95 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:active:scale-100"
					>
						<Edit3 size={18} />
						<span class="text-sm">Different label</span>
					</button>
				</div>
				<p class="text-xs leading-relaxed text-zinc-500">
					<span class="font-semibold text-zinc-400">Yes, agree</span> — the system’s call is right;
					record it as your judgment.
					<span class="text-zinc-600">·</span>
					<span class="font-semibold text-zinc-400">No, override</span> — the system got it wrong;
					flag this as the opposite verdict.
					<span class="text-zinc-600">·</span>
					<span class="font-semibold text-zinc-400">Different label</span> — neither matches; type your
					own.
				</p>
			</div>
		{/if}

		<!-- Collapsible technical details -->
		<details
			class="group rounded-lg border border-zinc-800/60 bg-zinc-900/40"
			bind:open={detailsOpen}
		>
			<summary
				class="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs text-zinc-400 transition-colors hover:text-zinc-300"
			>
				<span class="tracking-wider uppercase">Technical details</span>
				<ChevronDown size={14} class="transition-transform group-open:rotate-180" />
			</summary>
			<div class="space-y-2 px-3 pt-1 pb-3 text-xs">
				<div class="flex flex-wrap gap-x-3 gap-y-1 font-mono text-zinc-400">
					<a
						href={resolve('/runs/[trace_id]', { trace_id: suggestion.run.trace_id })}
						class="text-cyan-400 underline decoration-cyan-400/40 hover:text-cyan-300"
						target="_blank"
						rel="noopener noreferrer"
					>
						{suggestion.run.trace_id}
					</a>
					{#if suggestion.run.exit_code !== null && suggestion.run.exit_code !== undefined}
						<span>exit={suggestion.run.exit_code}</span>
					{/if}
					{#if suggestion.run.duration_ms !== null && suggestion.run.duration_ms !== undefined}
						<span>{suggestion.run.duration_ms}ms</span>
					{/if}
				</div>
				{#if suggestion.suggestion.rationale && plainRationale !== suggestion.suggestion.rationale}
					<div class="text-zinc-500">
						<span class="mr-1 tracking-wider text-zinc-600 uppercase">raw rationale:</span>
						<span class="font-mono">{suggestion.suggestion.rationale}</span>
					</div>
				{/if}
				{#if suggestion.suggestion.derived_from}
					<div class="text-zinc-500">
						<span class="mr-1 tracking-wider text-zinc-600 uppercase">derived from:</span>
						<span class="font-mono break-all">{suggestion.suggestion.derived_from}</span>
					</div>
				{/if}
				{#if suggestion.run.stderr_tail}
					<div class="text-zinc-500">
						<span class="mr-1 tracking-wider text-zinc-600 uppercase">stderr tail:</span>
						<pre
							class="mt-1 font-mono text-[11px] break-words whitespace-pre-wrap text-zinc-400">{suggestion
								.run.stderr_tail}</pre>
					</div>
				{/if}
			</div>
		</details>
	</div>
</div>
