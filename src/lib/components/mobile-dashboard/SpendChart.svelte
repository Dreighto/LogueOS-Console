<script lang="ts">
	// Inline SVG horizontal bar chart — 24h spend by worker. No charting
	// library; per the dataviz method this is a magnitude-by-category
	// comparison (small N), so a horizontal bar with a direct value label is
	// the right form. Color encodes worker identity (matches the same hex
	// family used across the rest of the Console); the worker name is always
	// printed as a direct label too, so identity never rides on color alone.
	import type { WorkerSpend } from './data';
	import { formatCurrency } from './data';

	let { spend }: { spend: WorkerSpend[] } = $props();

	const ROW_HEIGHT = 28;
	const BAR_HEIGHT = 10;
	const LABEL_WIDTH = 96;
	const MAX_BAR_WIDTH = 150;
	const VIEW_WIDTH = 300;

	let maxSpend = $derived(Math.max(0.01, ...spend.map((w) => w.spend)));
	let viewHeight = $derived(spend.length * ROW_HEIGHT);

	function barWidth(value: number): number {
		return Math.max(2, (value / maxSpend) * MAX_BAR_WIDTH);
	}
</script>

<svg
	viewBox="0 0 {VIEW_WIDTH} {viewHeight}"
	width="100%"
	height={viewHeight}
	role="img"
	aria-label="24 hour spend by worker: {spend
		.map((w) => `${w.label} ${formatCurrency(w.spend)}`)
		.join(', ')}"
	class="font-mono"
>
	<!-- Recessive baseline the bars grow from. -->
	<line
		x1={LABEL_WIDTH}
		y1="0"
		x2={LABEL_WIDTH}
		y2={viewHeight}
		stroke="var(--color-border)"
		stroke-width="1"
	/>
	{#each spend as w, i (w.id)}
		{@const y = i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2}
		<g>
			<title>{w.label}: {formatCurrency(w.spend)}</title>
			<text
				x={LABEL_WIDTH - 8}
				y={i * ROW_HEIGHT + ROW_HEIGHT / 2}
				text-anchor="end"
				dominant-baseline="middle"
				fill="var(--color-muted-foreground)"
				font-size="9"
			>
				{w.label}
			</text>
			<rect
				x={LABEL_WIDTH}
				y={y}
				width={barWidth(w.spend)}
				height={BAR_HEIGHT}
				rx={4}
				fill={w.color}
				opacity="0.85"
			/>
			<text
				x={LABEL_WIDTH + barWidth(w.spend) + 6}
				y={i * ROW_HEIGHT + ROW_HEIGHT / 2}
				text-anchor="start"
				dominant-baseline="middle"
				fill="var(--color-foreground)"
				font-size="9"
				font-weight="700"
			>
				{formatCurrency(w.spend)}
			</text>
		</g>
	{/each}
</svg>
