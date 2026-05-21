<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** When set, the card renders as a navigable <a>; otherwise a plain <div>. */
		href?: string;
		/** Card-specific layout classes (flex direction, gap, fixed height). */
		class?: string;
		children: Snippet;
	}

	let { href, class: className = '', children }: Props = $props();

	// One source of truth for card chrome: border, surface background, radius,
	// padding, and the hover/active feedback. RunCard, WorkerCard and the run
	// skeleton pass only their own layout classes via `class`.
	const base =
		'rounded-sm border border-border bg-surface p-2.5 transition-all hover:border-muted-foreground/30 active:scale-[0.99]';
</script>

<svelte:element
	this={href ? 'a' : 'div'}
	href={href || undefined}
	data-sveltekit-preload-data="hover"
	class="{base} {href ? 'cursor-pointer' : ''} {className}"
>
	{@render children()}
</svelte:element>
