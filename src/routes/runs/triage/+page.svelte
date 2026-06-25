<script lang="ts">
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { ArrowLeft, RefreshCw, CheckCircle } from 'lucide-svelte';
	import type { PageData } from './$types';
	import type { JudgmentDecision, TriageSuggestion } from '$lib/types/judgment';
	import TriageCard from '$lib/components/triage/TriageCard.svelte';
	import ProgressIndicator from '$lib/components/triage/ProgressIndicator.svelte';
	import { toasts } from '$lib/utils/toasts';

	let { data }: { data: PageData } = $props();

	// Use state variables that can be updated, initialized from server data
	let suggestions = $state(data.suggestions || []);
	let progress = $state(data.progress || { reviewed: 0, total: 0 });
	let totalUnconfirmed = $state(data.total_unconfirmed || 0);
	let isLoading = $state(false);
	let isSubmitting = $state(false);
	let currentIndex = $state(0);

	// Update state when data prop changes (for SSR refresh)
	$effect(() => {
		if (data.suggestions) suggestions = data.suggestions;
		if (data.progress) progress = data.progress;
		if (data.total_unconfirmed !== undefined) totalUnconfirmed = data.total_unconfirmed;
	});

	// Keyboard navigation
	$effect(() => {
		function handleKeydown(e: KeyboardEvent) {
			if (isSubmitting || suggestions.length === 0) return;

			const current = suggestions[currentIndex];
			if (!current) return;

			switch (e.key) {
				case 'ArrowLeft':
					e.preventDefault();
					handleDecision('reject');
					break;
				case 'ArrowRight':
					e.preventDefault();
					handleDecision('accept');
					break;
				case 'ArrowUp':
					e.preventDefault();
					// Focus the edit input if not already editing
					const editButton = document.querySelector('[data-edit-button]') as HTMLButtonElement;
					editButton?.click();
					break;
			}
		}

		document.addEventListener('keydown', handleKeydown);
		return () => document.removeEventListener('keydown', handleKeydown);
	});

	async function handleDecision(decision: JudgmentDecision, operatorLabel?: string) {
		if (isSubmitting || suggestions.length === 0) return;

		const current = suggestions[currentIndex];
		if (!current) return;

		isSubmitting = true;
		try {
			const resp = await fetch(resolve('/api/runs/triage'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					suggestion_id: current.suggestion.id,
					decision,
					operator_label: operatorLabel
				})
			});

			if (!resp.ok) {
				const errorData = await resp.json().catch(() => ({}));
				throw new Error(errorData.error || `HTTP ${resp.status}`);
			}

			const result = await resp.json();

			// Update progress
			progress = result.progress || progress;
			totalUnconfirmed = result.total_unconfirmed || totalUnconfirmed;

			// Remove current suggestion from list
			suggestions = suggestions.slice(1);
			currentIndex = 0;

			// Show success toast
			const action =
				decision === 'accept' ? 'accepted' : decision === 'reject' ? 'rejected' : 'edited';
			toasts.add(`Suggestion ${action} successfully`, 'success');

			// If no more suggestions, show completion
			if (suggestions.length === 0) {
				toasts.add('All suggestions reviewed!', 'success');
			}
		} catch (e: unknown) {
			console.error('Submit decision error:', e);
			const message = e instanceof Error ? e.message : 'Failed to submit decision';
			toasts.add(`Error: ${message}`, 'error');
		} finally {
			isSubmitting = false;
		}
	}

	async function refreshData() {
		if (isLoading) return;
		isLoading = true;

		try {
			const resp = await fetch(resolve('/api/runs/triage'));
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

			const result = await resp.json();
			suggestions = result.suggestions || [];
			progress = result.progress || { reviewed: 0, total: 0 };
			totalUnconfirmed = result.total_unconfirmed || 0;
			currentIndex = 0;

			toasts.add('Data refreshed', 'success');
		} catch (e: unknown) {
			console.error('Refresh error:', e);
			toasts.add('Failed to refresh data', 'error');
		} finally {
			isLoading = false;
		}
	}
</script>

<svelte:head>
	<title>Judgment Triage • LogueOS Console</title>
	<meta name="description" content="Review worker run judgment suggestions" />
</svelte:head>

<div class="min-h-[100dvh] bg-[#050505]" style="padding-bottom: env(safe-area-inset-bottom, 0px);">
	<!-- Progress indicator -->
	<ProgressIndicator reviewed={progress.reviewed} total={progress.total} />

	<!-- Main content -->
	<div class="space-y-6 px-4 py-6">
		<!-- Header with back button and refresh -->
		<div class="flex items-center justify-between">
			<a
				href={resolve('/')}
				class="flex items-center gap-2 text-zinc-400 transition-colors hover:text-zinc-300 active:scale-95"
			>
				<ArrowLeft size={18} />
				<span class="text-sm font-medium">Back to Console</span>
			</a>

			<button
				onclick={refreshData}
				disabled={isLoading}
				class="flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-200 transition-all hover:bg-zinc-700 active:scale-95 disabled:opacity-50"
			>
				<RefreshCw size={14} class={isLoading ? 'animate-spin' : ''} />
				Refresh
			</button>
		</div>

		<!-- Main content area -->
		{#if suggestions.length === 0}
			<!-- Empty state -->
			<div class="flex flex-col items-center justify-center space-y-4 py-16 text-center">
				<CheckCircle size={48} class="text-emerald-400" />
				<div class="space-y-2">
					<h2 class="text-xl font-semibold text-zinc-100">All done!</h2>
					<p class="max-w-md text-zinc-400">
						{progress.total === 0
							? 'No judgment suggestions available to review.'
							: "You've reviewed all available suggestions. Great work!"}
					</p>
				</div>
				<button
					onclick={refreshData}
					disabled={isLoading}
					class="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-cyan-500 active:scale-95 disabled:opacity-50"
				>
					<RefreshCw size={14} class={isLoading ? 'animate-spin' : ''} />
					Check for new suggestions
				</button>
			</div>
		{:else}
			<!-- Current suggestion card -->
			<div class="space-y-4">
				<div class="text-center text-sm text-zinc-500">
					Reviewing suggestion {currentIndex + 1} of {suggestions.length}
					{totalUnconfirmed > suggestions.length
						? `(${totalUnconfirmed - suggestions.length} more available)`
						: ''}
				</div>

				<TriageCard suggestion={suggestions[currentIndex]} onDecision={handleDecision} />

				<!-- Keyboard shortcuts hint -->
				<div class="space-y-1 text-center text-xs text-zinc-600">
					<div>Keyboard shortcuts:</div>
					<div class="font-mono">← Reject • → Accept • ↑ Edit</div>
				</div>
			</div>
		{/if}
	</div>
</div>
