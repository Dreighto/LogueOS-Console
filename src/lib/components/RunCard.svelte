<script lang="ts">
	import type { Run } from '$lib/types/run';
	import { formatDuration, formatRelativeTime, truncateTraceId } from '$lib/utils/format';
	import { CheckCircle2, XCircle, AlertCircle, Loader2, CircleHelp } from 'lucide-svelte';

	interface Props {
		run: Run;
	}

	let { run }: Props = $props();

	const statusColors: Record<string, string> = {
		CONFIRMED_WORKING: '#3FB950',
		INCONCLUSIVE: '#F5A623',
		FAILED: '#F85149',
		ESCALATE: '#3B82F6'
	};

	const workerColors: Record<string, string> = {
		'claude-code': '#D97757',
		'gemini': '#AD89EB',
		'cursor': '#3B82F6',
		'codex': '#64748B',
		'operator': '#F5A623'
	};

	let statusColor = $derived(statusColors[run.status] || '#6B7280');
	let workerColor = $derived(workerColors[run.worker || ''] || '#6B7280');
	let summaryPreview = $derived(run.summary.slice(0, 200) + (run.summary.length > 200 ? '...' : ''));
</script>

<div
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
			{:else if run.status === 'INCONCLUSIVE'}
				<AlertCircle size={16} color={statusColor} />
			{:else if run.status === 'ESCALATE'}
				<AlertCircle size={16} color={statusColor} />
			{:else if run.status === 'running'}
				<Loader2 size={16} color="#3B82F6" class="animate-spin" />
			{:else}
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
		<span class="flex items-center before:mr-2 before:content-['Â·']">
			{formatRelativeTime(run.timestamp)}
		</span>
		{#if run.duration_ms}
			<span class="flex items-center before:mr-2 before:content-['Â·']">
				{formatDuration(run.duration_ms)}
			</span>
		{/if}
		{#if run.pr_number}
			<span class="flex items-center before:mr-2 before:content-['Â·']">
				PR #{run.pr_number}
			</span>
		{/if}
	</div>
</div>
