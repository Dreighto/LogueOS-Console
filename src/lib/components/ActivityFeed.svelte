<script lang="ts">
	import type { ActivityEvent } from '$lib/types/activity';
	import { formatFullDate } from '$lib/utils/format';
	import { 
		Info, CheckCircle2, AlertCircle, XCircle, Clock, 
		ChevronDown, ChevronRight, Terminal, Hash, Fingerprint,
		Bot, User, Zap, ShieldAlert, AlertTriangle
	} from 'lucide-svelte';

	interface Props {
		events: ActivityEvent[];
	}

	let { events }: Props = $props();

	// Filter state
	let currentFilter = $state<'all' | 'needs-attention' | 'finished'>('all');

	// Expanded events tracking
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

	// Filter logic
	const filteredEvents = $derived(() => {
		if (currentFilter === 'all') return events;
		if (currentFilter === 'needs-attention') {
			return events.filter(e => e.level === 'error' || e.level === 'warning');
		}
		if (currentFilter === 'finished') {
			return events.filter(e => e.msg === 'worker_exit' && e.level === 'success');
		}
		return events;
	});

	// Grouping logic
	function getGroupLabel(ts: string): string {
		const date = new Date(ts);
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);

		if (date >= today) return 'Today';
		if (date >= yesterday) return 'Yesterday';
		return 'Earlier';
	}

	const groupedEvents = $derived(() => {
		const groups: { label: string; events: ActivityEvent[] }[] = [];
		const activeEvents = filteredEvents();
		
		activeEvents.forEach(event => {
			const label = getGroupLabel(event.ts);
			let group = groups.find(g => g.label === label);
			if (!group) {
				group = { label, events: [] };
				groups.push(group);
			}
			group.events.push(event);
		});
		
		return groups;
	});

	function getEventIcon(event: ActivityEvent) {
		if (event.msg === 'hmac_reject') return ShieldAlert;
		if (event.msg === 'dispatch_rejected') return AlertTriangle;
		if (event.msg === 'listener_listening' || event.msg === 'listener_restarted') return Zap;
		
		const worker = event.worker?.toLowerCase() || '';
		if (worker.includes('claude') || worker.includes('gemini')) return Bot;
		if (worker.includes('operator')) return User;
		
		return Terminal;
	}

	function getLevelColor(level: ActivityEvent['level']) {
		switch (level) {
			case 'success': return 'text-[#3FB950] bg-[#3FB950]/10 border-[#3FB950]/20';
			case 'warning': return 'text-[#D29922] bg-[#D29922]/10 border-[#D29922]/20';
			case 'error': return 'text-[#F85149] bg-[#F85149]/10 border-[#F85149]/20';
			default: return 'text-[#8B949E] bg-[#8B949E]/10 border-[#30363D]';
		}
	}

	function formatEventTime(ts: string) {
		const date = new Date(ts);
		return date.toLocaleTimeString('en-US', { 
			hour: 'numeric', 
			minute: '2-digit',
			hour12: true 
		});
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Filter Chips -->
	<div class="flex gap-2 p-1 bg-[#0D1117] border border-[#30363D] rounded-lg w-fit">
		<button 
			class="px-3 py-1 text-xs font-medium rounded-md transition-colors {currentFilter === 'all' ? 'bg-[#21262D] text-[#F0F6FC] border border-[#30363D]' : 'text-[#8B949E] hover:text-[#C9D1D9]'}"
			onclick={() => currentFilter = 'all'}
		>
			All
		</button>
		<button 
			class="px-3 py-1 text-xs font-medium rounded-md transition-colors {currentFilter === 'needs-attention' ? 'bg-[#21262D] text-[#F0F6FC] border border-[#30363D]' : 'text-[#8B949E] hover:text-[#C9D1D9]'}"
			onclick={() => currentFilter = 'needs-attention'}
		>
			Needs Attention
		</button>
		<button 
			class="px-3 py-1 text-xs font-medium rounded-md transition-colors {currentFilter === 'finished' ? 'bg-[#21262D] text-[#F0F6FC] border border-[#30363D]' : 'text-[#8B949E] hover:text-[#C9D1D9]'}"
			onclick={() => currentFilter = 'finished'}
		>
			Finished
		</button>
	</div>

	<div class="flex flex-col border border-[#30363D] bg-[#161B22] rounded-lg overflow-hidden">
		{#if filteredEvents().length === 0}
			<div class="p-12 text-center text-[#8B949E]">
				<p>No events found for this filter.</p>
			</div>
		{:else}
			<div class="overflow-y-auto max-h-[calc(100vh-320px)] divide-y divide-[#30363D]">
				{#each groupedEvents() as group}
					<!-- Date Group Header -->
					<div class="bg-[#0D1117] px-4 py-1.5 sticky top-0 z-10 border-y border-[#30363D] first:border-t-0">
						<span class="text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">
							{group.label}
						</span>
					</div>

					{#each group.events as event (event.id)}
						{@const Icon = getEventIcon(event)}
						{@const levelColor = getLevelColor(event.level)}
						{@const isExpanded = expandedEvents.has(event.id)}
						
						<div class="group relative hover:bg-[#1C2128] transition-colors">
							<button
								type="button"
								class="w-full flex items-start gap-3 p-3 text-left focus:outline-none focus:bg-[#1C2128]"
								onclick={() => toggleExpand(event.id)}
							>
								<!-- Avatar-like Icon -->
								<div class="flex-shrink-0 mt-0.5">
									<div class="flex h-8 w-8 items-center justify-center rounded-md border {levelColor}">
										<Icon size={16} />
									</div>
								</div>

								<!-- Content Area -->
								<div class="flex-grow min-w-0">
									<div class="flex items-baseline gap-2 mb-0.5">
										<span class="text-sm font-bold text-[#F0F6FC]">
											{event.worker || 'System'}
										</span>
										<span class="text-[11px] text-[#8B949E]">
											{formatEventTime(event.ts)}
										</span>
										
										{#if event.level === 'error'}
											<span class="px-1.5 py-0.5 text-[9px] font-bold bg-[#F85149]/20 text-[#F85149] rounded border border-[#F85149]/30 uppercase tracking-tighter ml-auto">
												Attention
											</span>
										{:else if event.level === 'warning'}
											<span class="px-1.5 py-0.5 text-[9px] font-bold bg-[#D29922]/20 text-[#D29922] rounded border border-[#D29922]/30 uppercase tracking-tighter ml-auto">
												Review
											</span>
										{/if}
									</div>
									
									<p class="text-sm text-[#C9D1D9] leading-relaxed break-words">
										{event.summary}
									</p>
								</div>

								<!-- Expand/Collapse Hint -->
								<div class="flex-shrink-0 self-center text-[#484F58] group-hover:text-[#8B949E] transition-colors">
									{#if isExpanded}
										<ChevronDown size={14} />
									{:else}
										<ChevronRight size={14} />
									{/if}
								</div>
							</button>

							<!-- Expanded Details Section -->
							{#if isExpanded}
								<div class="px-4 pb-4 pt-0 ml-11">
									<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-md bg-[#0D1117] border border-[#30363D]">
										<div class="flex flex-col gap-1">
											<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">
												<Clock size={10} />
												Full Timestamp
											</span>
											<span class="font-mono text-[11px] text-[#F0F6FC]">
												{formatFullDate(event.ts)}
											</span>
										</div>

										{#if event.ticket_id && event.ticket_id !== 'unknown'}
											<div class="flex flex-col gap-1">
												<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">
													<Hash size={10} />
													Ticket
												</span>
												<span class="font-mono text-[11px] text-[#F0F6FC]">
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
												<span class="font-mono text-[10px] text-[#A3E635] break-all">
													{event.trace_id}
												</span>
											</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				{/each}
			</div>
		{/if}
	</div>
</div>
