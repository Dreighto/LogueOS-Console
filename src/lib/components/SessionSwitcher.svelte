<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { ChevronRight } from 'lucide-svelte';

	// Tiny floating tap target in the corner of /terminal pages that toggles
	// between cc-con and gmi-con. Plain Svelte + Tailwind to match the rest
	// of the Console — no shadcn-svelte / bits-ui dependency.
	const currentSession = $derived(page.params.session ?? 'cc-con');
	const otherSession = $derived(currentSession === 'cc-con' ? 'gmi-con' : 'cc-con');
	const otherPath = $derived(
		otherSession === 'cc-con' ? resolve('/terminal/cc-con') : resolve('/terminal/gmi-con')
	);
</script>

<a
	href={otherPath}
	aria-label="Switch to {otherSession} terminal"
	class="absolute right-3 top-2 z-10 flex items-center gap-1 rounded border border-border bg-background/80 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur-md transition-colors hover:border-cta hover:text-foreground"
>
	<span class="text-foreground">{currentSession}</span>
	<ChevronRight size={10} aria-hidden="true" />
	<span>{otherSession}</span>
</a>
