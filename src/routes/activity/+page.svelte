<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import ActivityFeed from '$lib/components/ActivityFeed.svelte';
	import type { ActivityEvent } from '$lib/types/activity';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	function getInitial() { return data.events; }
	let events = $state<ActivityEvent[]>(getInitial());

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
	<header class="flex items-center justify-between">
		<div>
			<h1 class="font-sans text-2xl font-bold text-[#F0F6FC]">What's Happening</h1>
			<p class="mt-1 text-sm text-[#8B949E]">
				The latest stream of thoughts, actions, and results from the team.
			</p>
		</div>
		<div
			class="flex items-center gap-2 rounded-full bg-[#161B22] px-3 py-1 border border-[#30363D]"
		>
			<div class="h-2 w-2 animate-pulse rounded-full bg-[#3FB950]"></div>
			<span class="text-[11px] font-medium text-[#8B949E] uppercase tracking-wider">Live</span>
		</div>
	</header>

	<ActivityFeed {events} />
</div>
