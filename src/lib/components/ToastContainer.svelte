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

	// Status-colored TINTED background + neutral readable text + status-colored
	// icon + border. The previous palette set background AND text to the same
	// status color, rendering the message invisible (red text on a red panel —
	// surfaced during the 2026-05-27 audit as "empty red bars on mic failure").
	const panel = {
		info: 'bg-zinc-950/90 border-zinc-800/80',
		success: 'bg-status-green/[0.08] border-status-green/40',
		warning: 'bg-status-amber/[0.08] border-status-amber/40',
		error: 'bg-status-red/[0.08] border-status-red/40'
	};
	const iconColor = {
		info: 'text-zinc-300',
		success: 'text-status-green',
		warning: 'text-status-amber',
		error: 'text-status-red'
	};
</script>

<div
	class="pointer-events-none fixed top-4 left-1/2 z-[100] flex w-full max-w-[400px] -translate-x-1/2 flex-col gap-2 px-4"
>
	{#each $toasts as toast (toast.id)}
		{@const Icon = icons[toast.type]}
		<div
			animate:flip={{ duration: 300 }}
			in:fly={{ y: -20, duration: 300 }}
			out:fly={{ y: -20, duration: 200 }}
			data-toast
			data-toast-type={toast.type}
			class="pointer-events-auto flex items-start gap-3 rounded-lg border p-3 text-zinc-100 shadow-xl backdrop-blur-md {panel[toast.type]}"
		>
			<Icon size={18} class="mt-0.5 shrink-0 {iconColor[toast.type]}" aria-hidden="true" />
			<div class="flex-1 text-sm font-medium leading-tight">
				{toast.message}
			</div>
			<button
				type="button"
				onclick={() => toasts.remove(toast.id)}
				aria-label="Dismiss notification"
				class="rounded-md p-1 text-zinc-400 opacity-60 transition-opacity hover:opacity-100"
			>
				<X size={14} aria-hidden="true" />
			</button>
		</div>
	{/each}
</div>
