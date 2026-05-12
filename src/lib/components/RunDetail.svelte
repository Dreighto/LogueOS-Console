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

	// Project Registry: maps project_id (from completion log) to its canonical
	// GitHub repo and Linear workspace slug. This is the UI-side mirror of the
	// Orchestrator's kernel project registry.
	const PROJECT_REGISTRY: Record<string, { repo: string; linear: string }> = {
		'logueos-console': { repo: 'Dreighto/LogueOS-Console', linear: 'logueos' },
		'project-miru': { repo: 'Dreighto/project-miru', linear: 'project-miru' },
		'logueos-orchestrator': { repo: 'Dreighto/LogueOS-Orchestrator', linear: 'logueos' }
	};

	// Logic to derive project identity.
	// 1. Explicit project_id from the log row (authoritative)
	// 2. Ticket-id prefix inference (legacy fallback for pre-agnostic logs)
	// 3. Global default (project-miru)
	function getProject(run: Run) {
		if (run.project_id && PROJECT_REGISTRY[run.project_id]) {
			return PROJECT_REGISTRY[run.project_id];
		}
		// Fallback: LOS-* tickets always belong to the console
		if (run.ticket_id && /^LOS-\d+$/i.test(run.ticket_id)) {
			return PROJECT_REGISTRY['logueos-console'];
		}
		return PROJECT_REGISTRY['project-miru'];
	}

	let project = $derived(getProject(run));
	let prRepo = $derived(project.repo);
	let linearTeamSlug = $derived(project.linear);
</script>

<div class="rounded-lg border border-[#21262D] bg-[#161B22] p-4 shadow-xl">
	<div class="flex flex-col gap-5">
		<!-- Header -->
		<div class="flex flex-col gap-4">
			<div class="flex items-start justify-between">
				<div class="flex flex-col gap-1.5">
					{#if run.ticket_id}
						<a
							href="https://linear.app/{linearTeamSlug}/issue/{run.ticket_id.toLowerCase()}"
							target="_blank"
							rel="noopener noreferrer"
							class="flex items-center gap-1.5 text-xs font-mono font-medium text-[#8A8A9A] hover:text-[#F0F0F0] transition-colors"
						>
							{run.ticket_id}
							<ExternalLink size={10} />
						</a>
					{/if}
					<h2 class="text-xl font-bold tracking-tight text-[#F0F0F0]">
						{run.summary.split('\n')[0]}
					</h2>
				</div>
				<div class="flex items-center">
					{#if run.status === 'CONFIRMED_WORKING'}
						<CheckCircle2 size={24} color={statusColor} />
					{:else if run.status === 'FAILED'}
						<XCircle size={24} color={statusColor} />
					{:else if run.status === 'INCONCLUSIVE' || run.status === 'ESCALATE'}
						<AlertCircle size={24} color={statusColor} />
					{:else}
						<CircleHelp size={24} color={statusColor} />
					{/if}
				</div>
			</div>

			<div class="flex flex-wrap gap-2">
				<span
					class="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
					style="background-color: {workerColor}22; color: {workerColor}; border: 1px solid {workerColor}44"
				>
					{run.worker || 'unknown'}
				</span>
				<span
					class="rounded bg-[#21262D] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#8A8A9A] border border-[#30363D]"
				>
					{run.status}
				</span>
				{#if run.branch}
					<span class="flex items-center gap-1 rounded bg-[#21262D] px-2 py-0.5 text-[10px] font-mono text-[#8A8A9A] border border-[#30363D]">
						<GitBranch size={10} />
						{run.branch}
					</span>
				{/if}
			</div>
		</div>

		<!-- Details Grid -->
		<div class="grid grid-cols-2 gap-4 border-y border-[#21262D] py-4">
			<div class="flex flex-col gap-1">
				<span class="text-[10px] uppercase tracking-wider text-[#6B7280] font-bold">Trace ID</span>
				<span class="text-xs font-mono text-[#8A8A9A] truncate">{run.trace_id || '---'}</span>
			</div>
			<div class="flex flex-col gap-1">
				<span class="text-[10px] uppercase tracking-wider text-[#6B7280] font-bold">Timestamp</span>
				<div class="flex items-center gap-1.5 text-xs text-[#8A8A9A]">
					<Clock size={12} />
					{formatFullDate(run.timestamp)}
				</div>
			</div>
			<div class="flex flex-col gap-1">
				<span class="text-[10px] uppercase tracking-wider text-[#6B7280] font-bold">Duration</span>
				<span class="text-xs text-[#8A8A9A]">
					{run.duration_ms != null ? formatDuration(run.duration_ms) : '---'}
				</span>
			</div>
			<div class="flex flex-col gap-1">
				<span class="text-[10px] uppercase tracking-wider text-[#6B7280] font-bold">Pull Request</span>
				{#if run.pr_number}
					<a
						href="https://github.com/{prRepo}/pull/{run.pr_number}"
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center gap-1 text-xs text-[#58A6FF] hover:underline"
					>
						PR #{run.pr_number}
						<ExternalLink size={10} />
					</a>
				{:else}
					<span class="text-xs text-[#6B7280]">No PR created</span>
				{/if}
			</div>
		</div>

		<!-- Files Touched -->
		{#if run.files_touched && run.files_touched.length > 0}
			<div class="flex flex-col gap-3">
				<div class="flex items-center gap-2">
					<Files size={14} class="text-[#6B7280]" />
					<span class="text-[10px] uppercase tracking-wider text-[#6B7280] font-bold">
						Files Touched ({run.files_touched.length})
					</span>
				</div>
				<div class="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
					{#each run.files_touched as file}
						<div class="flex items-center gap-2 text-xs font-mono text-[#8A8A9A] bg-[#21262D]/30 px-2 py-1.5 rounded border border-[#30363D]/50 hover:bg-[#21262D]/50 transition-colors">
							<div class="w-1 h-1 rounded-full bg-[#3FB950]"></div>
							<span class="truncate">{file}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: #30363D;
		border-radius: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: #484F58;
	}
</style>
