<script lang="ts">
	import { Terminal } from 'lucide-svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<!--
  The outer div uses negative margins to cancel the layout's p-4 padding,
  then adds that space back as height so the iframe fills the full main area.
  Tailwind: -m-4 = -1rem each side; height offset = 2rem (top + bottom).
-->
<div class="-m-4 flex flex-col" style="height: calc(100% + 2rem);">
	<!-- Session label strip -->
	<div
		class="flex shrink-0 items-center gap-1.5 border-b border-border bg-surface px-3 py-1.5 font-mono text-xs"
	>
		<Terminal size={12} class="shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="text-muted-foreground">terminal /</span>
		<span class="font-semibold text-foreground">{data.session}</span>
	</div>

	<!-- ttyd iframe — fills remaining height, no border -->
	<iframe
		src={data.ttydUrl}
		title="{data.session} terminal"
		class="min-h-0 flex-1 border-none"
		style="width: 100%;"
		allow="clipboard-read; clipboard-write"
	></iframe>
</div>
