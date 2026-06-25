<script lang="ts">
	let { 
		reviewed, 
		total 
	}: { 
		reviewed: number; 
		total: number; 
	} = $props();

	$effect(() => {
		// Sync progress whenever props change
		reviewed, total;
	});

	const percentage = $derived(total > 0 ? Math.round((reviewed / total) * 100) : 0);
</script>

<!-- Sticky progress bar that stays at top on mobile -->
<div data-testid="progress-indicator" class="sticky top-0 z-10 bg-[#050505]/95 backdrop-blur-md border-b border-zinc-800/80" style="padding-top: env(safe-area-inset-top, 0px);">
	<div class="px-4 py-3">
		<div class="flex items-center justify-between text-sm mb-2">
			<span class="text-zinc-300 font-medium">Judgment Progress</span>
			<span class="font-mono text-xs text-zinc-500">
				{reviewed} / {total} reviewed
			</span>
		</div>
		
		<!-- Progress bar -->
		<div class="w-full bg-zinc-900 rounded-full h-2 overflow-hidden">
			<div 
				class="h-full bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full transition-all duration-500 ease-out"
				style="width: {percentage}%"
			></div>
		</div>
		
		<!-- Percentage -->
		<div class="flex justify-center mt-1">
			<span class="text-xs font-mono text-zinc-400">{percentage}%</span>
		</div>
	</div>
</div>