<script lang="ts">
	let {
		reviewed,
		total
	}: {
		reviewed: number;
		total: number;
	} = $props();

	const percentage = $derived(total > 0 ? Math.round((reviewed / total) * 100) : 0);
</script>

<!-- Sticky progress bar that stays at top on mobile -->
<div
	data-testid="progress-indicator"
	class="sticky top-0 z-10 border-b border-zinc-800/80 bg-[#050505]/95 backdrop-blur-md"
	style="padding-top: env(safe-area-inset-top, 0px);"
>
	<div class="px-4 py-3">
		<div class="mb-2 flex items-center justify-between text-sm">
			<span class="font-medium text-zinc-300">Judgment Progress</span>
			<span class="font-mono text-xs text-zinc-500">
				{reviewed} / {total} reviewed
			</span>
		</div>

		<!-- Progress bar -->
		<div class="h-2 w-full overflow-hidden rounded-full bg-zinc-900">
			<div
				class="h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-500 ease-out"
				style="width: {percentage}%"
			></div>
		</div>

		<!-- Percentage -->
		<div class="mt-1 flex justify-center">
			<span class="font-mono text-xs text-zinc-400">{percentage}%</span>
		</div>
	</div>
</div>
