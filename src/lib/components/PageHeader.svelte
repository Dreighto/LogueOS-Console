<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Page title - the plain one-word name, matching the nav tab. */
		title: string;
		/** Optional one-line description shown under the title. */
		subtitle?: string;
		/** Optional right-aligned content - a status pill, action, etc. */
		children?: Snippet;
	}

	let { title, subtitle, children }: Props = $props();
</script>

<!-- font-sans is pinned so the header looks identical on every screen, even
     inside a font-mono page wrapper (e.g. Memory). No own margin: the page
     wrapper's flex `gap` provides the spacing to the content below. -->
<header class="flex items-start justify-between gap-3 font-sans">
	<div class="flex flex-col gap-0.5">
		<h1 class="text-xl font-bold tracking-tight text-foreground">{title}</h1>
		{#if subtitle}
			<p class="text-xs text-muted-foreground">{subtitle}</p>
		{/if}
	</div>
	{#if children}
		<div class="shrink-0">{@render children()}</div>
	{/if}
</header>
