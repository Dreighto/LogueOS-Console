<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>terminal probe — LogueOS</title>
</svelte:head>

<div class="flex h-full flex-col gap-4 overflow-y-auto p-4 font-mono text-xs">
	<h1 class="text-base font-bold">Terminal access probe</h1>

	<section class="rounded border border-border bg-surface p-3">
		<div class="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Verdict</div>
		<div
			class="text-sm font-bold {data.gateAllowed ? 'text-green-400' : 'text-red-400'}"
		>
			{data.gateAllowed ? 'ALLOWED' : 'BLOCKED'}
		</div>
		<div class="mt-1 text-muted-foreground">{data.gateReason}</div>
	</section>

	<section class="rounded border border-border bg-surface p-3">
		<div class="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
			What the server saw
		</div>
		<dl class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
			<dt class="text-muted-foreground">URL:</dt>
			<dd class="break-all">{data.url}</dd>
			<dt class="text-muted-foreground">Peer IP:</dt>
			<dd>{data.directIp}</dd>
			<dt class="text-muted-foreground">Funnel header:</dt>
			<dd>{data.funnelHeader ?? '(absent)'}</dd>
			<dt class="text-muted-foreground">X-Forwarded-For:</dt>
			<dd class="break-all">{data.forwardedFor ?? '(absent)'}</dd>
		</dl>
	</section>

	<section class="rounded border border-border bg-surface p-3">
		<div class="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
			All headers ({Object.keys(data.allHeaders).length})
		</div>
		<dl class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
			{#each Object.entries(data.allHeaders) as [name, value] (name)}
				<dt class="text-muted-foreground">{name}:</dt>
				<dd class="break-all">{value}</dd>
			{/each}
		</dl>
	</section>
</div>
