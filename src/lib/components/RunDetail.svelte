<script lang="ts">
	import type { Run } from '$lib/types/run';
	import { formatDuration, formatFullDate } from '$lib/utils/format';
	import { CheckCircle2, XCircle, AlertCircle, CircleHelp, ExternalLink, GitBranch, Files, Clock, Hash } from 'lucide-svelte';
	import { statusColors, workerColors } from '$lib/styles/colors';

	interface Props {
		run: Run;
	}

	let { run }: Props = $props();

	let statusColor = $derived(statusColors[run.status]);
	let workerColor = $derived(workerColors[run.worker || ''] || '#6B7280');
</script>

<div class="rounded-lg border border-[#21262D] bg-[#161B22] p-4 shadow-xl">
	<div class="flex flex-col gap-5">
		<!-- Header -->
		<div class="flex flex-col gap-4">
			<div class="flex items-start justify-between">
				<div class="flex flex-col gap-1.5">
					<h1 class="font-mono text-xl font-bold text-[#F0F0F0]">
						{run.ticket_id || '---'}
					</h1>
					<span
						class="w-fit rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
						style="background-color: {workerColor}22; color: {workerColor}; border: 1px solid {workerColor}44"
					>
						{run.worker || 'unknown'}
					</span>
				</div>
				<div class="flex flex-col items-end gap-2">
					<div class="flex items-center gap-1.5 px-2 py-1 rounded-full border" style="border-color: {statusColor}44; background-color: {statusColor}11;">
						{#if run.status === 'CONFIRMED_WORKING'}
							<CheckCircle2 size={14} color={statusColor} />
						{:else if run.status === 'FAILED'}
							<XCircle size={14} color={statusColor} />
						{:else if run.status === 'INCONCLUSIVE' || run.status === 'ESCALATE'}
							<AlertCircle size={14} color={statusColor} />
						{:else}
							<CircleHelp size={14} color={statusColor} />
						{/if}
						<span class="text-[10px] font-bold uppercase tracking-tight" style="color: {statusColor}">
							{run.status.replace('_', ' ')}
						</span>
					</div>
				</div>
			</div>
			<div class="flex items-center gap-1.5 font-mono text-[11px] text-[#6B7280] bg-[#0D1117] p-2 rounded border border-[#21262D]">
				<Hash size={12} class="shrink-0" />
				<span class="truncate">{run.trace_id}</span>
			</div>
			<div class="text-[11px] text-[#6B7280]">{formatFullDate(run.timestamp)}</div>
		</div>

		<!-- Metadata Grid -->
		<div class="grid grid-cols-2 gap-3 py-3 border-y border-[#21262D]">
			{#if run.duration_ms != null}
				<div class="flex items-center gap-2">
					<div class="p-1.5 rounded bg-[#21262D]">
						<Clock size={14} class="text-[#8A8A9A]" />
					</div>
					<div class="flex flex-col">
						<span class="text-[9px] uppercase text-[#6B7280] font-semibold tracking-wider">Duration</span>
						<span class="text-xs font-mono text-[#F0F0F0]">{formatDuration(run.duration_ms)}</span>
					</div>
				</div>
			{/if}

			{#if run.branch}
				<div class="flex items-center gap-2">
					<div class="p-1.5 rounded bg-[#21262D]">
						<GitBranch size={14} class="text-[#8A8A9A]" />
					</div>
					<div class="flex flex-col overflow-hidden">
						<span class="text-[9px] uppercase text-[#6B7280] font-semibold tracking-wider">Branch</span>
						<span class="text-xs font-mono text-[#F0F0F0] truncate" title={run.branch}>{run.branch}</span>
					</div>
				</div>
			{/if}

			{#if run.pr_number}
				<a href="https://github.com/Dreighto/LogueOS-Console/pull/{run.pr_number}" target="_blank" class="flex items-center gap-2 hover:bg-[#1C2128] transition-colors rounded p-1 -m-1">
					<div class="p-1.5 rounded bg-[#21262D]">
						<ExternalLink size={14} class="text-[#8A8A9A]" />
					</div>
					<div class="flex flex-col">
						<span class="text-[9px] uppercase text-[#6B7280] font-semibold tracking-wider">PR</span>
						<span class="text-xs font-mono text-[#3B82F6]">#{run.pr_number}</span>
					</div>
				</a>
			{/if}

			<div class="flex items-center gap-2">
				<div class="p-1.5 rounded bg-[#21262D]">
					<Files size={14} class="text-[#8A8A9A]" />
				</div>
				<div class="flex flex-col">
					<span class="text-[9px] uppercase text-[#6B7280] font-semibold tracking-wider">Files</span>
					<span class="text-xs font-mono text-[#F0F0F0]">{run.files_touched.length} files</span>
				</div>
			</div>
		</div>

		<!-- Summary -->
		<div class="flex flex-col gap-2">
			<h3 class="text-[10px] font-semibold text-[#8A8A9A] uppercase tracking-wider">Summary</h3>
			<div class="bg-[#0D1117] border border-[#21262D] rounded p-3">
				<p class="text-sm text-[#F0F0F0] whitespace-pre-wrap leading-relaxed">
					{run.summary}
				</p>
			</div>
		</div>

		<!-- Files Touched List -->
		{#if run.files_touched.length > 0}
			<div class="flex flex-col gap-2">
				<h3 class="text-[10px] font-semibold text-[#8A8A9A] uppercase tracking-wider">Touched Files</h3>
				<div class="flex flex-col gap-1.5">
					{#each run.files_touched as file}
						<div class="flex items-center gap-2 p-1.5 rounded bg-[#0D1117] border border-[#21262D] font-mono text-[10px] text-[#8A8A9A] truncate hover:text-[#F0F0F0] transition-colors">
							<div class="w-1 h-1 rounded-full bg-[#3FB950]"></div>
							<span class="truncate">{file}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

