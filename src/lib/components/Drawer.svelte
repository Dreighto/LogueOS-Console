<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { X } from 'lucide-svelte';

	let { 
		show = $bindable(false), 
		title, 
		children 
	}: { 
		show: boolean, 
		title?: string, 
		children: import('svelte').Snippet 
	} = $props();

	function close() {
		show = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
</script>

{#if show}
	<!-- Backdrop -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div 
		class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
		onclick={close}
	></div>

	<!-- Drawer -->
	<div 
		class="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-border bg-background shadow-2xl transition-all"
		in:fly={{ y: 300, duration: 300 }}
		out:fly={{ y: 300, duration: 200 }}
		onkeydown={handleKeydown}
	>
		<!-- Handle / Drag bar visual -->
		<div class="flex items-center justify-center py-3">
			<div class="h-1.5 w-12 rounded-full bg-muted"></div>
		</div>

		<div class="flex items-center justify-between px-4 pb-2">
			{#if title}
				<h2 class="font-sans text-lg font-bold tracking-tight">{title}</h2>
			{:else}
				<div></div>
			{/if}
			<button 
				type="button" 
				onclick={close}
				class="rounded-full bg-surface p-2 text-muted-foreground hover:text-foreground"
			>
				<X size={20} />
			</button>
		</div>

		<div class="overflow-y-auto p-4 pb-10 custom-scrollbar">
			{@render children()}
		</div>
	</div>
{/if}
