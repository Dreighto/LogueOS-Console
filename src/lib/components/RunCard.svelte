<script lang="ts">
	import type { Run, RunStatus } from '$lib/types/run';
	import { formatDuration, formatRelativeTime, truncateTraceId } from '$lib/utils/format';
	import { resolve } from '$app/paths';
	import { CheckCircle2, XCircle, AlertCircle, CircleHelp } from 'lucide-svelte';
	import { statusColors } from '$lib/styles/colors';
	import { workerColor, workerLabel } from '$lib/config/workers';

	interface Props {
		run: Run;
	}

	let { run }: Props = $props();

	let statusColor = $derived(statusColors[run.status]);
	let runWorkerColor = $derived(workerColor(run.worker));
	let summaryPreview = $derived(
		run.summary.slice(0, 200) + (run.summary.length > 200 ? '...' : '')
	);
	// resolve() honors kit.paths.base ('/console'). Bare href="/runs/..." would
	// navigate to the SITE root (n8n) and 404. Same base-path bug pattern as the
	// fetch fixes — codified in canon adopted-lessons.md as the recurring trap.
	let detailHref = $derived(run.trace_id ? resolve(`/runs/${run.trace_id}`) : null);
</script>

<a
	href={detailHref ?? '#'}
	data-sveltekit-preload-data="hover"
	class="flex cursor-pointer flex-col justify-between rounded-sm border border-border bg-surface p-2 transition-all hover:bg-surface active:scale-[0.99]"
>
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<span
				class="rounded px-1.5 py-0.5 text-xs font-medium tracking-wider uppercase"
				style="background-color: {runWorkerColor}22; color: {runWorkerColor}; border: 1px solid {runWorkerColor}44"
			>
				{workerLabel(run.worker)}
			</span>
		</div>
		<div class="flex items-center">
			{#if run.status === 'CONFIRMED_WORKING'}
				<CheckCircle2 size={16} color={statusColor} />
			{:else if run.status === 'FAILED'}
				<XCircle size={16} color={statusColor} />
			{:else if run.status === 'INCONCLUSIVE' || run.status === 'ESCALATE'}
				<AlertCircle size={16} color={statusColor} />
			{:else}
				<!-- 'unknown' fallback. Live in-flight state (Loader2 spin) is
				     deferred to P1c per the spec — completion log only contains
				     terminal rows, so we never hit a 'running' state here. -->
				<CircleHelp size={16} color={statusColor} />
			{/if}
		</div>
	</div>

	<div class="mt-1 flex items-baseline gap-2 overflow-hidden">
		<span class="shrink-0 font-mono text-xs font-bold text-foreground uppercase">
			{run.ticket_id || '---'}
		</span>
		<p class="truncate font-sans text-xs text-muted-foreground">
			{summaryPreview}
		</p>
	</div>

	<div class="mt-auto flex items-center gap-2 font-mono text-xs text-muted-foreground">
		<span class="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
			{truncateTraceId(run.trace_id)}
		</span>
		<span class="flex items-center before:mr-2 before:content-['·']">
			{formatRelativeTime(run.timestamp)}
		</span>
		{#if run.duration_ms != null}
			<!-- != null catches both undefined and null but keeps 0 visible.
			     Pre-Round-2 the truthiness check `{#if run.duration_ms}` would
			     hide a legitimate 0 ms duration (e.g. an instant-failure spawn). -->
			<span class="flex items-center before:mr-2 before:content-['·']">
				{formatDuration(run.duration_ms)}
			</span>
		{/if}
		{#if run.pr_number}
			<span class="flex items-center before:mr-2 before:content-['·']">
				PR #{run.pr_number}
			</span>
		{/if}
	</div>
</a>
