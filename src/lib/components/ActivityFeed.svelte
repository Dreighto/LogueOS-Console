<script lang="ts">
	import type { ActivityEvent } from '$lib/types/activity';
	import { formatFullDate } from '$lib/utils/format';
	import { resolveWorker } from '$lib/config/workers';
	import {
		Clock,
		ChevronDown,
		ChevronRight,
		Terminal,
		Hash,
		Fingerprint,
		Bot,
		User,
		Zap,
		ShieldAlert,
		AlertTriangle,
		Search
	} from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';

	interface Props {
		events: ActivityEvent[];
		onEventClick?: (event: ActivityEvent) => void;
	}

	let { events, onEventClick }: Props = $props();

	// Filter state
	let currentFilter = $state<'all' | 'needs-attention' | 'finished'>('all');
	let searchQuery = $state('');

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
		let result = events;
		if (currentFilter === 'needs-attention') {
			result = result.filter((e) => e.level === 'error' || e.level === 'warning');
		} else if (currentFilter === 'finished') {
			result = result.filter((e) => e.msg === 'worker_exit' && e.level === 'success');
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter((e) => 
				(e.worker?.toLowerCase() || '').includes(query) ||
				(e.ticket_id?.toLowerCase() || '').includes(query) ||
				(e.trace_id?.toLowerCase() || '').includes(query) ||
				(e.summary?.toLowerCase() || '').includes(query)
			);
		}
		return result;
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

		activeEvents.forEach((event) => {
			const label = getGroupLabel(event.ts);
			let group = groups.find((g) => g.label === label);
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

		const def = resolveWorker(event.worker);
		if (def?.role === 'operator') return User;
		if (def) return Bot;

		return Terminal;
	}

	function getLevelColor(level: ActivityEvent['level']) {
		switch (level) {
			case 'success':
				return 'text-status-green bg-status-green/10 border-status-green/20';
			case 'warning':
				return 'text-status-amber bg-status-amber/10 border-status-amber/20';
			case 'error':
				return 'text-destructive bg-destructive/10 border-destructive/20';
			default:
				return 'text-muted-foreground bg-muted-foreground/10 border-border';
		}
	}

	function formatEventTime(ts: string): string {
		const diffMs = Date.now() - new Date(ts).getTime();
		const diffSec = Math.floor(diffMs / 1000);
		const diffMin = Math.floor(diffSec / 60);
		const diffHr = Math.floor(diffMin / 60);
		const diffDay = Math.floor(diffHr / 24);

		if (diffSec < 60) return 'just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		if (diffHr < 24) return `${diffHr}h ago`;
		if (diffDay === 1) {
			const time = new Date(ts).toLocaleTimeString('en-US', {
				hour: 'numeric',
				minute: '2-digit',
				hour12: true
			});
			return `yesterday at ${time}`;
		}
		return `${diffDay} days ago`;
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Filter Chips & Search -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex w-fit gap-2 rounded-lg border border-border bg-background p-1">
		<button
			class="active-trigger rounded-md px-3 py-1 text-xs font-medium transition-colors {currentFilter === 'all'
				? 'border border-border bg-muted text-foreground'
				: 'text-muted-foreground hover:bg-surface/50 hover:text-foreground'}"
			onclick={() => (currentFilter = 'all')}
		>
			All
		</button>
		<button
			class="active-trigger rounded-md px-3 py-1 text-xs font-medium transition-colors {currentFilter ===
			'needs-attention'
				? 'border border-border bg-muted text-foreground'
				: 'text-muted-foreground hover:bg-surface/50 hover:text-foreground'}"
			onclick={() => (currentFilter = 'needs-attention')}
		>
			Needs Attention
		</button>
		<button
			class="active-trigger rounded-md px-3 py-1 text-xs font-medium transition-colors {currentFilter ===
			'finished'
				? 'border border-border bg-muted text-foreground'
				: 'text-muted-foreground hover:bg-surface/50 hover:text-foreground'}"
			onclick={() => (currentFilter = 'finished')}
		>
			Finished
		</button>
		</div>

		<div class="flex w-full sm:max-w-xs items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 focus-within:border-status-blue/50 focus-within:ring-1 focus-within:ring-status-blue/50 transition-all">
			<Search size={14} class="text-muted-foreground" />
			<input 
				type="text" 
				placeholder="Filter trace, ticket, or worker..." 
				class="w-full bg-transparent text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
				bind:value={searchQuery}
			/>
		</div>
	</div>

	<div class="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
		{#if filteredEvents().length === 0}
			<div class="p-12 text-center text-muted-foreground">
				<p>Nothing here — the team is running clean</p>
			</div>
		{:else}
			<div class="max-h-[calc(100vh-320px)] divide-y divide-border overflow-y-auto">
				{#each groupedEvents() as group (group.label)}
					<!-- Date Group Header -->
					<div
						class="sticky top-0 z-10 border-y border-border bg-background px-4 py-1.5 first:border-t-0"
					>
						<span class="text-xs font-bold tracking-widest text-muted-foreground uppercase">
							{group.label}
						</span>
					</div>

					{#each group.events as event (event.id)}
						{@const Icon = getEventIcon(event)}
						{@const levelColor = getLevelColor(event.level)}
						{@const isExpanded = expandedEvents.has(event.id)}

						<div animate:flip={{ duration: 300 }} in:slide={{ duration: 300 }} class="group relative transition-colors hover:bg-surface/50">
							<div class="flex items-stretch">
								<button
									type="button"
									class="active-trigger flex flex-1 items-start gap-3 p-3 text-left focus:bg-surface focus:outline-none"
									onclick={() => onEventClick?.(event)}
								>
									<!-- Avatar-like Icon -->
									<div class="mt-0.5 flex-shrink-0">
										<div
											class="flex h-8 w-8 items-center justify-center rounded-md border {levelColor}"
										>
											<Icon size={16} />
										</div>
									</div>

									<!-- Content Area -->
									<div class="min-w-0 flex-grow">
										<div class="mb-0.5 flex items-baseline gap-2">
											<span class="text-sm font-bold text-foreground">
												{event.worker || 'System'}
											</span>
											<span class="text-xs text-muted-foreground">
												{formatEventTime(event.ts)}
											</span>

											{#if event.level === 'error'}
												<span
													class="ml-auto rounded border border-destructive/30 bg-destructive/20 px-1.5 py-0.5 text-xs font-bold tracking-tighter text-destructive uppercase"
												>
													Attention
												</span>
											{:else if event.level === 'warning'}
												<span
													class="ml-auto rounded border border-status-amber/30 bg-status-amber/20 px-1.5 py-0.5 text-xs font-bold tracking-tighter text-status-amber uppercase"
												>
													Review
												</span>
											{/if}
										</div>

										<p class="text-sm leading-relaxed break-words text-foreground">
											{event.summary}
										</p>
									</div>
								</button>

								<!-- Inline Expand Toggle (Secondary) -->
								<button
									type="button"
									class="flex items-center justify-center border-l border-border/30 px-3 text-muted-foreground transition-colors hover:text-muted-foreground"
									onclick={() => toggleExpand(event.id)}
									aria-label={isExpanded ? 'Collapse' : 'Expand'}
								>
									{#if isExpanded}
										<ChevronDown size={14} />
									{:else}
										<ChevronRight size={14} />
									{/if}
								</button>
							</div>

							<!-- Expanded Details Section -->
							{#if isExpanded}
								<div class="ml-11 px-4 pt-0 pb-4">
									<div
										class="grid grid-cols-1 gap-3 rounded-md border border-border bg-background p-3 sm:grid-cols-2"
									>
										<div class="flex flex-col gap-1">
											<span
												class="flex items-center gap-1.5 text-xs font-bold tracking-widest text-muted-foreground uppercase"
											>
												<Clock size={10} />
												Full Timestamp
											</span>
											<span class="font-mono text-xs text-foreground">
												{formatFullDate(event.ts)}
											</span>
										</div>

										{#if event.ticket_id && event.ticket_id !== 'unknown'}
											<div class="flex flex-col gap-1">
												<span
													class="flex items-center gap-1.5 text-xs font-bold tracking-widest text-muted-foreground uppercase"
												>
													<Hash size={10} />
													Ticket
												</span>
												<span class="font-mono text-xs text-foreground">
													{event.ticket_id}
												</span>
											</div>
										{/if}

										{#if event.trace_id}
											<div class="flex flex-col gap-1 sm:col-span-2">
												<span
													class="flex items-center gap-1.5 text-xs font-bold tracking-widest text-muted-foreground uppercase"
												>
													<Fingerprint size={10} />
													Trace ID
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
