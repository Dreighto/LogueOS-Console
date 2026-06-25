<script lang="ts">
	import { Check, X, Edit3, ExternalLink, Clock, User, Tag } from 'lucide-svelte';
	import type { TriageSuggestion, JudgmentDecision } from '$lib/types/judgment';
	import { resolve } from '$app/paths';

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

	function handleAccept() {
		if (isProcessing) return;
		isProcessing = true;
		onDecision('accept');
	}

	function handleReject() {
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

	// Format confidence as a badge
	const confidenceColor = (conf: string) => {
		const c = conf.toLowerCase();
		if (c.includes('high')) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
		if (c.includes('medium')) return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
		if (c.includes('low')) return 'bg-red-500/20 text-red-400 border-red-500/40';
		return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/40';
	};
</script>

<div data-testid="triage-card" class="w-full max-w-2xl mx-auto">
	<div class="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-4 space-y-4 transition-all">
		<!-- Header with trace_id link and worker -->
		<div class="flex items-center justify-between gap-3 text-sm">
			<div class="flex items-center gap-2">
				<a 
					href={resolve('/runs/[trace_id]', { trace_id: suggestion.run.trace_id })}
					class="font-mono text-cyan-400 hover:text-cyan-300 transition-colors active:scale-95 flex items-center gap-1.5"
					target="_blank"
					rel="noopener noreferrer"
				>
					{suggestion.run.trace_id}
					<ExternalLink size={12} />
				</a>
			</div>
			<div class="flex items-center gap-2 text-zinc-400">
				<User size={12} />
				<span class="font-mono text-xs">{suggestion.run.worker}</span>
			</div>
		</div>

		<!-- Outcome and suggested label -->
		<div class="space-y-3">
			<div class="flex items-center gap-2 text-sm">
				<span class="text-zinc-500">Outcome:</span>
				<span class="font-medium text-zinc-200">{suggestion.run.outcome}</span>
			</div>
			
			<div class="flex items-center gap-3">
				<span class="text-zinc-500 text-sm">Suggested:</span>
				<div class="flex items-center gap-2">
					<span class="bg-zinc-900/60 border border-zinc-700/50 px-3 py-1.5 rounded-lg font-medium text-sm text-zinc-100">
						{suggestion.suggestion.suggested_label}
					</span>
					<div class="px-2 py-1 rounded-md border text-xs font-mono {confidenceColor(suggestion.suggestion.confidence)}">
						{suggestion.suggestion.confidence}
					</div>
				</div>
			</div>
		</div>

		<!-- Rationale -->
		{#if suggestion.suggestion.rationale}
			<div class="space-y-2">
				<div class="text-zinc-500 text-sm">Rationale:</div>
				<div class="bg-zinc-900/40 border border-zinc-800/60 rounded-lg p-3 text-sm text-zinc-200 leading-relaxed">
					{suggestion.suggestion.rationale}
				</div>
			</div>
		{/if}

		<!-- Derived from -->
		{#if suggestion.suggestion.derived_from}
			<div class="flex items-center gap-2 text-xs text-zinc-500">
				<Tag size={12} />
				<span>Derived from: {suggestion.suggestion.derived_from}</span>
			</div>
		{/if}

		<!-- Duration info -->
		{#if suggestion.run.duration_ms}
			<div class="flex items-center gap-2 text-xs text-zinc-500">
				<Clock size={12} />
				<span>{Math.round(suggestion.run.duration_ms / 1000)}s runtime</span>
			</div>
		{/if}

		<!-- Edit interface -->
		{#if isEditing}
			<div class="space-y-3 border-t border-zinc-800/60 pt-4">
				<div class="text-sm text-zinc-300 font-medium">Custom label:</div>
				<div class="space-y-3">
					<input
						bind:value={customLabel}
						type="text"
						class="w-full bg-zinc-900 border border-zinc-700/50 rounded-lg px-3 py-2 text-[16px] text-zinc-100 focus:border-zinc-600 focus:ring-0 focus:outline-none transition-colors"
						placeholder="Enter custom judgment..."
						autocomplete="off"
						autocorrect="off" 
						autocapitalize="none"
					/>
					<div class="flex gap-2">
						<button
							onclick={handleSubmitEdit}
							disabled={!customLabel.trim() || isProcessing}
							class="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95 disabled:active:scale-100"
						>
							<Check size={14} />
							Submit
						</button>
						<button
							onclick={handleCancelEdit}
							disabled={isProcessing}
							class="flex items-center gap-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95"
						>
							Cancel
						</button>
					</div>
				</div>
			</div>
		{:else}
			<!-- Action buttons -->
			<div class="flex gap-2 border-t border-zinc-800/60 pt-4">
				<button
					onclick={handleAccept}
					disabled={isProcessing}
					class="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white py-3 rounded-xl text-sm font-medium transition-all active:scale-95 disabled:active:scale-100"
				>
					<Check size={16} />
					Accept
				</button>
				<button
					onclick={handleReject}
					disabled={isProcessing}
					class="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white py-3 rounded-xl text-sm font-medium transition-all active:scale-95 disabled:active:scale-100"
				>
					<X size={16} />
					Reject
				</button>
				<button
					onclick={handleEdit}
					disabled={isProcessing}
					data-edit-button
					class="flex-1 flex items-center justify-center gap-2 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 py-3 rounded-xl text-sm font-medium transition-all active:scale-95 disabled:active:scale-100"
				>
					<Edit3 size={16} />
					Edit
				</button>
			</div>
		{/if}
	</div>
</div>