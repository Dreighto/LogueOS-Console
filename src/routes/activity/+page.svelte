<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import ActivityFeed from '$lib/components/ActivityFeed.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import type { ActivityEvent } from '$lib/types/activity';
	import { formatFullDate } from '$lib/utils/format';
	import { Clock, Hash, Fingerprint, Terminal } from 'lucide-svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import LivePill from '$lib/components/LivePill.svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	function getInitial() { return data.events; }
	let events = $state<ActivityEvent[]>(getInitial());
	
	// Drawer state
	let selectedEvent = $state<ActivityEvent | null>(null);
	let isDrawerOpen = $state(false);

	function openDetail(event: ActivityEvent) {
		selectedEvent = event;
		isDrawerOpen = true;
	}

	// Keep events in sync if data changes (e.g. on navigation)
	$effect(() => {
		events = data.events;
	});

	async function refreshActivity() {
		try {
			// resolve() honors kit.paths.base ('/console'). Bare '/api/activity'
			// would hit the SITE root behind a tailscale serve subpath.
			const response = await fetch(resolve('/api/activity'));
			if (response.ok) {
				const result = await response.json();
				events = result.events;
			}
		} catch (error) {
			console.error('Failed to refresh activity:', error);
		}
	}

	onMount(() => {
		const interval = setInterval(refreshActivity, data.clientSafeConfig.pollIntervalMs);
		return () => clearInterval(interval);
	});
</script>

<div class="flex flex-col gap-6">
	<PageHeader
		title="Activity"
		subtitle="The latest stream of thoughts, actions, and results from the team."
	>
		<LivePill />
	</PageHeader>

	<ActivityFeed {events} onEventClick={openDetail} />
</div>

<Drawer bind:show={isDrawerOpen} title="Event Details">
	{#if selectedEvent}
		<div class="flex flex-col gap-6">
			<!-- Header / Summary -->
			<div class="flex flex-col gap-2">
				<div class="flex items-center gap-2">
					<div class="rounded bg-surface px-2 py-0.5 font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase border border-border">
						{selectedEvent.level}
					</div>
					<span class="font-mono text-xs text-muted-foreground">{formatFullDate(selectedEvent.ts)}</span>
				</div>
				<h3 class="text-lg font-bold leading-snug">{selectedEvent.summary}</h3>
			</div>

			<!-- Meta Grid -->
			<div class="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface/30 p-4">
				<div class="flex flex-col gap-1">
					<span class="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
						<Terminal size={10} />
						Source
					</span>
					<span class="text-sm font-medium">{selectedEvent.worker || 'System'}</span>
				</div>

				{#if selectedEvent.ticket_id && selectedEvent.ticket_id !== 'unknown'}
					<div class="flex flex-col gap-1">
						<span class="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
							<Hash size={10} />
							Ticket
						</span>
						<span class="font-mono text-sm">{selectedEvent.ticket_id}</span>
					</div>
				{/if}

				{#if selectedEvent.trace_id}
					<div class="col-span-2 flex flex-col gap-1 border-t border-border/50 pt-3">
						<span class="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
							<Fingerprint size={10} />
							Trace ID
						</span>
						<span class="font-mono text-xs break-all text-muted-foreground">{selectedEvent.trace_id}</span>
					</div>
				{/if}
			</div>

			<!-- Raw Data / Message -->
			<div class="flex flex-col gap-3">
				<h4 class="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Raw Context</h4>
				<div class="rounded-md bg-black/40 p-4 font-mono text-xs leading-relaxed text-foreground border border-border/30 overflow-x-auto whitespace-pre-wrap">
					{JSON.stringify(selectedEvent, null, 2)}
				</div>
			</div>
		</div>
	{/if}
</Drawer>
