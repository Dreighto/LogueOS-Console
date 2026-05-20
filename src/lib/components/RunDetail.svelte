<script lang="ts">
	import type { Run } from '$lib/types/run';
	import { formatDuration, formatFullDate } from '$lib/utils/format';
	import {
		CheckCircle2,
		XCircle,
		AlertCircle,
		CircleHelp,
		ExternalLink,
		GitBranch,
		Files,
		Clock,
		Hash
	} from 'lucide-svelte';
	import { statusColors } from '$lib/styles/colors';
	import { workerColor, workerLabel } from '$lib/config/workers';

	interface Props {
		run: Run;
	}

	let { run }: Props = $props();

	let statusColor = $derived(statusColors[run.status]);
	let runWorkerColor = $derived(workerColor(run.worker));

	// Project Registry: maps project_id (from completion log) to its canonical
	// GitHub repo and Linear workspace slug. This is the UI-side mirror of the
	// Orchestrator's kernel project registry.
	const PROJECT_REGISTRY: Record<string, { repo: string; linear: string }> = {
		'logueos-console': { repo: 'Dreighto/LogueOS-Console', linear: 'logueos' },
		'project-miru': { repo: 'Dreighto/project-miru', linear: 'project-miru' },
		'logueos-orchestrator': { repo: 'Dreighto/LogueOS-Orchestrator', linear: 'logueos' }
	};

	// Derive project identity from the log row. Returns null when the project
	// cannot be confidently resolved -- callers must guard the URL renders so
	// we do not emit misleading cross-project links (e.g. defaulting an
	// orchestrator ticket into the miru repo).
	function getProject(run: Run): { repo: string; linear: string } | null {
		if (run.project_id && PROJECT_REGISTRY[run.project_id]) {
			return PROJECT_REGISTRY[run.project_id];
		}
		return null;
	}

	let project = $derived(getProject(run));
	let prRepo = $derived(project?.repo ?? null);
	let linearTeamSlug = $derived(project?.linear ?? null);
</script>

<div class="rounded-lg border border-[#21262D] bg-[#161B22] p-4 shadow-xl">
	<div class="flex flex-col gap-5">
		<!-- Header -->
		<div class="flex flex-col gap-4">
			<div class="flex items-start justify-between">
				<div class="flex flex-col gap-1.5">
					{#if run.ticket_id && linearTeamSlug}
						<a
							href="https://linear.app/{linearTeamSlug}/issue/{run.ticket_id.toLowerCase()}"
							target="_blank"
							rel="noopener noreferrer"
							class="flex items-center gap-1.5 font-mono text-xs font-medium text-[#8A8A9A] transition-colors hover:text-[#F0F0F0]"
						>
							{run.ticket_id}
							<ExternalLink size={10} />
						</a>
					{:else if run.ticket_id}
						<span class="flex items-center gap-1.5 font-mono text-xs font-medium text-[#8A8A9A]">
							{run.ticket_id}
						</span>
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
					class="rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
					style="background-color: {runWorkerColor}22; color: {runWorkerColor}; border: 1px solid {runWorkerColor}44"
				>
					{workerLabel(run.worker)}
				</span>
				<span
					class="rounded border border-[#30363D] bg-[#21262D] px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#8A8A9A] uppercase"
				>
					{run.status}
				</span>
				{#if run.branch}
					<span
						class="flex items-center gap-1 rounded border border-[#30363D] bg-[#21262D] px-2 py-0.5 font-mono text-[10px] text-[#8A8A9A]"
					>
						<GitBranch size={10} />
						{run.branch}
					</span>
				{/if}
			</div>
		</div>

		<!-- Details Grid -->
		<div class="grid grid-cols-2 gap-4 border-y border-[#21262D] py-4">
			<div class="flex flex-col gap-1">
				<span class="text-[10px] font-bold tracking-wider text-[#6B7280] uppercase">Trace ID</span>
				<span class="truncate font-mono text-xs text-[#8A8A9A]">{run.trace_id || '---'}</span>
			</div>
			<div class="flex flex-col gap-1">
				<span class="text-[10px] font-bold tracking-wider text-[#6B7280] uppercase">Timestamp</span>
				<div class="flex items-center gap-1.5 text-xs text-[#8A8A9A]">
					<Clock size={12} />
					{formatFullDate(run.timestamp)}
				</div>
			</div>
			<div class="flex flex-col gap-1">
				<span class="text-[10px] font-bold tracking-wider text-[#6B7280] uppercase">Duration</span>
				<span class="text-xs text-[#8A8A9A]">
					{run.duration_ms != null ? formatDuration(run.duration_ms) : '---'}
				</span>
			</div>
			<div class="flex flex-col gap-1">
				<span class="text-[10px] font-bold tracking-wider text-[#6B7280] uppercase"
					>Pull Request</span
				>
				{#if run.pr_number && prRepo}
					<a
						href="https://github.com/{prRepo}/pull/{run.pr_number}"
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center gap-1 text-xs text-[#58A6FF] hover:underline"
					>
						PR #{run.pr_number}
						<ExternalLink size={10} />
					</a>
				{:else if run.pr_number}
					<span class="text-xs text-[#8A8A9A]">PR #{run.pr_number}</span>
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
					<span class="text-[10px] font-bold tracking-wider text-[#6B7280] uppercase">
						Files Touched ({run.files_touched.length})
					</span>
				</div>
				<div class="custom-scrollbar flex max-h-[200px] flex-col gap-1.5 overflow-y-auto pr-2">
					{#each run.files_touched as file}
						<div
							class="flex items-center gap-2 rounded border border-[#30363D]/50 bg-[#21262D]/30 px-2 py-1.5 font-mono text-xs text-[#8A8A9A] transition-colors hover:bg-[#21262D]/50"
						>
							<div class="h-1 w-1 rounded-full bg-[#3FB950]"></div>
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
		background: #30363d;
		border-radius: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: #484f58;
	}
</style>
