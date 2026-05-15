<script lang="ts">
	import type { Run, RunStatus } from '$lib/types/run';
	import { formatDuration, formatRelativeTime, truncateTraceId } from '$lib/utils/format';
	import { resolve } from '$app/paths';
	import { CheckCircle2, XCircle, AlertCircle, CircleHelp } from 'lucide-svelte';
	import { statusColors, workerColors } from '$lib/styles/colors';

	interface Props {
		run: Run;
	}

	let { run }: Props = $props();

	let statusColor = $derived(statusColors[run.status]);
	let workerColor = $derived(workerColors[run.worker || ''] || '#6B7280');
	let summaryPreview = $derived(
		run.summary.slice(0, 200) + (run.summary.length > 200 ? '...' : '')
	);
	// resolve() honors kit.paths.base ('/console'). Bare href="/runs/..." would
	// navigate to the SITE root (n8n) and 404. Same base-path bug pattern as the
	// fetch fixes — codified in canon adopted-lessons.md as the recurring trap.
	let detailHref = $derived(
		run.trace_id ? resolve(`/runs/${run.trace_id}`) : null
	);
</script>

<a
	href={detailHref ?? '#'}
	data-sveltekit-preload-data="hover"
	class="flex h-[100px] cursor-pointer flex-col justify-between rounded-lg border border-[#21262D] bg-[#161B22] p-3 transition-all hover:bg-[#1C2128] hover:shadow-[0_0_8px_rgba(163,230,53,0.1)]"
>
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<span
				class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
				style="background-color: {workerColor}22; color: {workerColor}; border: 1px solid {workerColor}44"
			>
				{run.worker || 'unknown'}
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
		<span class="shrink-0 font-mono text-sm font-semibold text-[#F0F0F0]">
			{run.ticket_id || '---'}
		</span>
		<p class="truncate font-sans text-sm text-[#8A8A9A]">
			{summaryPreview}
		</p>
	</div>

	<div class="mt-auto flex items-center gap-2 font-mono text-[11px] text-[#6B7280]">
		<span class="rounded bg-[#21262D] px-1.5 py-0.5 text-[#8A8A9A]">
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

