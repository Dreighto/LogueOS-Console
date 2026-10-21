<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { X } from 'lucide-svelte';
	import { tick } from 'svelte';

	let {
		show = $bindable(false),
		title,
		children
	}: {
		show: boolean,
		title?: string,
		children: import('svelte').Snippet
	} = $props();

	// Stable id for aria-labelledby — Math.random is fine here since it only
	// needs to be unique per mounted Drawer instance, not stable across SSR.
	const titleId = `drawer-title-${Math.random().toString(36).slice(2)}`;

	let panelEl = $state<HTMLDivElement | undefined>(undefined);
	// The element focused right before the drawer opened — focus returns
	// here on close, per the standard dialog pattern.
	let triggerEl: HTMLElement | null = null;

	function close() {
		show = false;
	}

	function focusableElements(): HTMLElement[] {
		if (!panelEl) return [];
		return Array.from(
			panelEl.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		);
	}

	// Basic focus trap: Tab/Shift+Tab wrap within the panel's focusable set
	// so keyboard focus never escapes to the page behind the backdrop.
	function trapFocus(e: KeyboardEvent) {
		const focusables = focusableElements();
		if (focusables.length === 0) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		const active = document.activeElement;
		if (e.shiftKey && active === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && (active === last || !panelEl?.contains(active))) {
			e.preventDefault();
			first.focus();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			close();
			return;
		}
		if (e.key === 'Tab') trapFocus(e);
	}

	// Move focus into the panel on open, and back to the trigger on close.
	$effect(() => {
		if (show) {
			triggerEl = document.activeElement as HTMLElement | null;
			tick().then(() => {
				const focusables = focusableElements();
				(focusables[0] ?? panelEl)?.focus();
			});
		} else if (triggerEl) {
			triggerEl.focus();
			triggerEl = null;
		}
	});
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
		bind:this={panelEl}
		class="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-border bg-background shadow-2xl transition-all focus:outline-none"
		in:fly={{ y: 300, duration: 300 }}
		out:fly={{ y: 300, duration: 200 }}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby={title ? titleId : undefined}
		tabindex="-1"
	>
		<!-- Handle / Drag bar visual -->
		<div class="flex items-center justify-center py-3">
			<div class="h-1.5 w-12 rounded-full bg-muted"></div>
		</div>

		<div class="flex items-center justify-between px-4 pb-2">
			{#if title}
				<h2 id={titleId} class="font-sans text-lg font-bold tracking-tight">{title}</h2>
			{:else}
				<div></div>
			{/if}
			<button
				type="button"
				onclick={close}
				aria-label="Close"
				class="active-trigger rounded-full bg-surface p-2 text-muted-foreground hover:text-foreground hover:bg-surface/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 focus-visible:ring-offset-background"
			>
				<X size={20} />
			</button>
		</div>

		<div class="overflow-y-auto p-4 pb-10 custom-scrollbar">
			{@render children()}
		</div>
	</div>
{/if}
