<script lang="ts">
	import type { ActivityEvent } from '$lib/types/activity';
	import { formatRelativeTime, formatFullDate } from '$lib/utils/format';
	import { Info, CheckCircle2, AlertCircle, XCircle, Clock, ChevronDown, ChevronRight, Activity, Terminal, Hash, Fingerprint } from 'lucide-svelte';

	interface Props {
		events: ActivityEvent[];
	}

	let { events }: Props = $props();

	// Keep track of which event IDs are expanded to show details
	let expandedEvents = $state(new Set<string>());

	function toggleExpand(id: string) {
		const newSet = new Set(expandedEvents);
		if (newSet.has(id)) {
			newSet.delete(id);
		} else {
			newSet.add(id);
		}
		expandedEvents = newSet;
	}

	function getLevelStyles(level: ActivityEvent['level']) {
		switch (level) {
			case 'success':
				return {
					bg: 'bg-[#3FB950]/[0.13]',
					text: 'text-[#3FB950]',
					border: 'border-[#3FB950]/[0.27]',
					icon: CheckCircle2
				};
			case 'warning':
				return {
					bg: 'bg-[#D29922]/[0.13]',
					text: 'text-[#D29922]',
					border: 'border-[#D29922]/[0.27]',
					icon: AlertCircle
				};
			case 'error':
				return {
					bg: 'bg-[#F85149]/[0.13]',
					text: 'text-[#F85149]',
					border: 'border-[#F85149]/[0.27]',
					icon: XCircle
				};
			case 'info':
			default:
				return {
					bg: 'bg-[#8B949E]/[0.13]',
					text: 'text-[#8B949E]',
					border: 'border-[#8B949E]/[0.27]',
					icon: Info
				};
		}
	}
</script>

<div class="flex flex-col border border-[#30363D] bg-[#161B22] rounded-lg overflow-hidden">
	{#if events.length === 0}
		<div class="p-8 text-center text-[#8B949E]">
			<p>No activity events found.</p>
		</div>
	{:else}
		<div class="overflow-y-auto max-h-[calc(100vh-280px)]">
			{#each events as event (event.id)}
				{@const styles = getLevelStyles(event.level)}
				{@const isExpanded = expandedEvents.has(event.id)}
				<div class="border-b border-[#30363D] last:border-0 hover:bg-[#1C2128] transition-colors">
					<!-- Clickable Header Row -->
					<button
						type="button"
						class="w-full flex items-start sm:items-center gap-4 p-4 text-left cursor-pointer focus:outline-none focus:bg-[#1C2128]"
						onclick={() => toggleExpand(event.id)}
						aria-expanded={isExpanded}
					>
						<div class="flex-shrink-0 mt-1 sm:mt-0">
							<div
								class="flex h-8 w-8 items-center justify-center rounded-full border {styles.bg} {styles.text} {styles.border}"
							>
								<styles.icon size={16} />
							</div>
						</div>

						<div class="flex-grow min-w-0">
							<div class="flex flex-wrap items-center justify-between gap-2 mb-1">
								<span
									class="text-[10px] font-bold px-2 py-0.5 rounded-full border {styles.bg} {styles.text} {styles.border} uppercase tracking-wider whitespace-nowrap"
								>
									{event.msg.replace(/_/g, ' ')}
								</span>
								<span class="flex items-center gap-1 text-[11px] text-[#8B949E] whitespace-nowrap ml-auto">
									<Clock size={12} />
									{formatRelativeTime(event.ts)}
								</span>
							</div>
							<p class="text-sm font-medium text-[#F0F6FC] break-words">
								{event.summary}
							</p>
						</div>

						<div class="flex-shrink-0 text-[#8B949E] self-center ml-2">
							{#if isExpanded}
								<ChevronDown size={16} />
							{:else}
								<ChevronRight size={16} />
							{/if}
						</div>
					</button>

					<!-- Expanded Details Section -->
					{#if isExpanded}
						<div class="px-4 pb-4 pt-1 sm:pl-[4.5rem]">
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-md bg-[#0D1117] border border-[#21262D]">
								
								<div class="flex flex-col gap-1">
									<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">
										<Clock size={10} />
										Exact Time
									</span>
									<span class="font-mono text-xs text-[#F0F6FC]">
										{formatFullDate(event.ts)}
									</span>
								</div>

								{#if event.worker}
									<div class="flex flex-col gap-1">
										<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">
											<Terminal size={10} />
											Worker
										</span>
										<span class="font-mono text-xs text-[#F0F6FC]">
											{event.worker}
										</span>
									</div>
								{/if}

								{#if event.ticket_id && event.ticket_id !== 'unknown'}
									<div class="flex flex-col gap-1">
										<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">
											<Hash size={10} />
											Ticket ID
										</span>
										<span class="font-mono text-xs text-[#F0F6FC]">
											{event.ticket_id}
										</span>
									</div>
								{/if}

								{#if event.trace_id}
									<div class="flex flex-col gap-1 sm:col-span-2">
										<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">
											<Fingerprint size={10} />
											Trace ID
										</span>
										<span class="font-mono text-[11px] text-[#A3E635] break-all">
											{event.trace_id}
										</span>
									</div>
								{/if}
								
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>