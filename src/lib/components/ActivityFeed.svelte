<script lang="ts">
	import type { ActivityEvent } from '$lib/types/activity';
	import { formatRelativeTime } from '$lib/utils/format';
	import { Info, CheckCircle2, AlertCircle, XCircle, Clock } from 'lucide-svelte';

	interface Props {
		events: ActivityEvent[];
	}

	let { events }: Props = $props();

	function getLevelStyles(level: ActivityEvent['level']) {
		// Tailwind 4 opacity-modifier syntax for arbitrary hex colors:
		// `bg-[#XXXXXX]/[0.13]` is preferred over the legacy `bg-[#XXXXXX]22`
		// hex-alpha append (which works but isn't part of the canonical
		// Tailwind 4 utility-class spec).
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
				<div
					class="flex items-center gap-4 p-4 border-b border-[#30363D] last:border-0 hover:bg-[#1C2128] transition-colors"
				>
					<div class="flex-shrink-0">
						<div
							class="flex h-8 w-8 items-center justify-center rounded-full border {styles.bg} {styles.text} {styles.border}"
						>
							<styles.icon size={16} />
						</div>
					</div>

					<div class="flex-grow min-w-0">
						<div class="flex items-center justify-between gap-2">
							<span
								class="text-xs font-medium px-2 py-0.5 rounded-full border {styles.bg} {styles.text} {styles.border} uppercase tracking-wider"
							>
								{event.msg.replace(/_/g, ' ')}
							</span>
							<span class="flex items-center gap-1 text-xs text-[#8B949E] whitespace-nowrap">
								<Clock size={12} />
								{formatRelativeTime(event.ts)}
							</span>
						</div>
						<p class="mt-1 text-sm text-[#F0F6FC] truncate" title={event.summary}>
							{event.summary}
						</p>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
