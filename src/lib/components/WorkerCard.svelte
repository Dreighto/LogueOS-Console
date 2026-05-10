<script lang="ts">
	import type { WorkerStatus } from '$lib/types/worker';
	import { workerColors } from '$lib/styles/colors';
	import { formatRelativeTime, truncateTraceId } from '$lib/utils/format';
	import { Activity, Square, RotateCcw, Cpu, Clock, Terminal } from 'lucide-svelte';

	interface Props {
		worker: WorkerStatus;
	}

	let { worker }: Props = $props();

	let workerColor = $derived(workerColors[worker.id] || '#6B7280');
	let stateColor = $derived(
		worker.state === 'busy' ? '#3FB950' : worker.state === 'idle' ? '#6B7280' : '#F85149'
	);
</script>

<div
	class="flex flex-col gap-4 rounded-lg border border-[#21262D] bg-[#161B22] p-4 transition-all hover:border-[#30363D]"
>
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-lg"
				style="background-color: {workerColor}22; color: {workerColor}; border: 1px solid {workerColor}44"
			>
				<Cpu size={24} />
			</div>
			<div>
				<h3 class="text-lg font-semibold text-[#F0F6FC]">{worker.id}</h3>
				<div class="flex items-center gap-2">
					<div class="h-2 w-2 rounded-full" style="background-color: {stateColor}"></div>
					<span class="text-xs font-medium uppercase tracking-wider" style="color: {stateColor}">
						{worker.state}
					</span>
				</div>
			</div>
		</div>

		<div class="flex gap-2">
			<button
				disabled
				title="Kill Worker (Disabled)"
				class="flex h-8 w-8 items-center justify-center rounded border border-[#30363D] bg-[#21262D] text-[#8B949E] opacity-50 transition-colors"
			>
				<Square size={16} />
			</button>
			<button
				disabled
				title="Restart Worker (Disabled)"
				class="flex h-8 w-8 items-center justify-center rounded border border-[#30363D] bg-[#21262D] text-[#8B949E] opacity-50 transition-colors"
			>
				<RotateCcw size={16} />
			</button>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-4 border-t border-[#21262D] pt-4">
		<div class="flex flex-col gap-1">
			<span class="flex items-center gap-1.5 text-[11px] font-medium text-[#8B949E]">
				<Activity size={12} />
				ACTIVE TRACE
			</span>
			{#if worker.trace_id}
				<span class="font-mono text-xs text-[#F0F6FC]">
					{truncateTraceId(worker.trace_id)}
				</span>
			{:else}
				<span class="text-xs text-[#484F58]">None</span>
			{/if}
		</div>

		<div class="flex flex-col gap-1">
			<span class="flex items-center gap-1.5 text-[11px] font-medium text-[#8B949E]">
				<Terminal size={12} />
				PID
			</span>
			{#if worker.pid}
				<span class="font-mono text-xs text-[#F0F6FC]">
					{worker.pid}
				</span>
			{:else}
				<span class="text-xs text-[#484F58]">---</span>
			{/if}
		</div>

		<div class="flex flex-col gap-1">
			<span class="flex items-center gap-1.5 text-[11px] font-medium text-[#8B949E]">
				<Clock size={12} />
				SINCE
			</span>
			{#if worker.since}
				<span class="text-xs text-[#F0F6FC]">
					{formatRelativeTime(worker.since)}
				</span>
			{:else}
				<span class="text-xs text-[#484F58]">---</span>
			{/if}
		</div>

		{#if worker.state === 'idle' && worker.last_exit_status}
			<div class="flex flex-col gap-1">
				<span class="flex items-center gap-1.5 text-[11px] font-medium text-[#8B949E]">
					LAST STATUS
				</span>
				<span class="text-xs font-semibold" style="color: {worker.last_exit_status === 'CONFIRMED_WORKING' ? '#3FB950' : '#F85149'}">
					{worker.last_exit_status}
				</span>
			</div>
		{/if}
	</div>
</div>
