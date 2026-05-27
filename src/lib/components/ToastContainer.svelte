<script lang="ts">
	import { toasts } from '$lib/utils/toasts';
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import { Info, CheckCircle2, AlertTriangle, AlertCircle, X } from 'lucide-svelte';

	const icons = {
		info: Info,
		success: CheckCircle2,
		warning: AlertTriangle,
		error: AlertCircle
	};

	const colors = {
		info: 'bg-background border-border text-foreground',
		success: 'bg-status-green border-status-green/50 text-white',
		warning: 'bg-status-amber border-status-amber/50 text-zinc-950',
		error: 'bg-status-red border-status-red/50 text-white'
	};
</script>

<div class="fixed top-4 left-1/2 z-[100] flex w-full max-w-[400px] -translate-x-1/2 flex-col gap-2 px-4 pointer-events-none">
	{#each $toasts as toast (toast.id)}
		{@const Icon = icons[toast.type]}
		<div
			animate:flip={{ duration: 300 }}
			in:fly={{ y: -20, duration: 300 }}
			out:fly={{ y: -20, duration: 200 }}
			class="pointer-events-auto flex items-start gap-3 rounded-lg border p-3 shadow-xl backdrop-blur-md {colors[toast.type]}"
		>
			<Icon size={18} class="mt-0.5 shrink-0" />
			<div class="flex-1 text-sm font-medium leading-tight">
				{toast.message}
			</div>
			<button 
				type="button" 
				onclick={() => toasts.remove(toast.id)}
				class="rounded-md p-1 opacity-60 hover:opacity-100 transition-opacity"
			>
				<X size={14} />
			</button>
		</div>
	{/each}
</div>
