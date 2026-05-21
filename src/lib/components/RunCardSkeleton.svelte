<script lang="ts">
	import Card from '$lib/components/Card.svelte';
</script>

<!-- Loading placeholder for RunCard. Uses the shared Card so its chrome
     (border, background, radius, padding) always matches the real card. -->
<Card class="flex h-[100px] animate-pulse flex-col justify-between">
	<div class="flex items-center justify-between">
		<div class="h-4 w-16 rounded bg-muted"></div>
		<div class="h-4 w-4 rounded-full bg-muted"></div>
	</div>
	<div class="mt-1 flex items-baseline gap-2">
		<div class="h-4 w-12 rounded bg-muted"></div>
		<div class="h-4 flex-1 rounded bg-muted"></div>
	</div>
	<div class="mt-auto flex items-center gap-2">
		<div class="h-4 w-16 rounded bg-muted"></div>
		<div class="h-4 w-12 rounded bg-muted"></div>
		<div class="h-4 w-12 rounded bg-muted"></div>
	</div>
</Card>
