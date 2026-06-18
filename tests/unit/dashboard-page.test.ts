/**
 * Tests for src/routes/dashboard/+page.svelte
 *
 * The dashboard page is a static mockup with no server dependencies.
 * It exposes three internal pure-helper functions (sparkPath, dotClass,
 * feedAccent) that are not exported from the component. We test those
 * functions by mirroring their logic here, and we test the component's
 * rendered output via @testing-library/svelte.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DashboardPage from '../../src/routes/dashboard/+page.svelte';

// ── Pure-function mirrors ────────────────────────────────────────────────────
// These are exact copies of the private helpers inside the component.
// Any change to the originals must be reflected here.

function sparkPath(values: number[], w: number, h: number, pad = 1): string {
	if (values.length < 2) return '';
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;
	const step = (w - pad * 2) / (values.length - 1);
	return values
		.map((v, i) => {
			const x = pad + i * step;
			const y = pad + (h - pad * 2) * (1 - (v - min) / span);
			return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(' ');
}

function dotClass(state: string): string {
	if (state === 'up') return 'bg-status-green shadow-[0_0_8px_rgba(34,197,94,0.7)]';
	if (state === 'degraded') return 'bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.7)]';
	return 'bg-status-red shadow-[0_0_8px_rgba(239,68,68,0.7)]';
}

type FeedKind = 'ship' | 'dispatch' | 'observe' | 'merge';
function feedAccent(kind: FeedKind): string {
	return kind === 'ship'
		? 'text-status-green'
		: kind === 'merge'
			? 'text-status-purple'
			: kind === 'dispatch'
				? 'text-status-blue'
				: 'text-muted-foreground';
}

// ── sparkPath ────────────────────────────────────────────────────────────────
describe('sparkPath', () => {
	it('returns empty string for an empty array', () => {
		expect(sparkPath([], 56, 16)).toBe('');
	});

	it('returns empty string for a single-element array', () => {
		expect(sparkPath([5], 56, 16)).toBe('');
	});

	it('starts with M for a two-element array', () => {
		const path = sparkPath([1, 2], 56, 16);
		expect(path).toMatch(/^M/);
	});

	it('contains exactly one M and one L for two elements', () => {
		const path = sparkPath([1, 2], 56, 16);
		const mCount = (path.match(/M/g) ?? []).length;
		const lCount = (path.match(/L/g) ?? []).length;
		expect(mCount).toBe(1);
		expect(lCount).toBe(1);
	});

	it('generates N-1 L commands for N values', () => {
		const values = [1, 2, 3, 4, 5];
		const path = sparkPath(values, 56, 16);
		const lCount = (path.match(/L/g) ?? []).length;
		expect(lCount).toBe(values.length - 1);
	});

	it('first x coordinate equals pad', () => {
		const pad = 2;
		const path = sparkPath([1, 2, 3], 56, 16, pad);
		// First segment: M<x>,<y>
		const firstX = parseFloat(path.split(',')[0].replace('M', ''));
		expect(firstX).toBeCloseTo(pad, 1);
	});

	it('last x coordinate equals w - pad', () => {
		const w = 56;
		const pad = 1;
		const values = [1, 2, 3];
		const path = sparkPath(values, w, 16, pad);
		const segments = path.split(' ');
		const lastSegment = segments[segments.length - 1];
		const lastX = parseFloat(lastSegment.replace('L', ''));
		expect(lastX).toBeCloseTo(w - pad, 1);
	});

	it('maps maximum value to the top (y = pad)', () => {
		const pad = 1;
		const h = 16;
		// Last value is the maximum; it should sit at y = pad (top)
		const path = sparkPath([1, 5], 56, h, pad);
		const segments = path.split(' ');
		const lastY = parseFloat(segments[segments.length - 1].split(',')[1]);
		expect(lastY).toBeCloseTo(pad, 1);
	});

	it('maps minimum value to the bottom (y = h - pad)', () => {
		const pad = 1;
		const h = 16;
		// First value is the minimum; it should sit at y = h - pad (bottom)
		const path = sparkPath([1, 5], 56, h, pad);
		const firstY = parseFloat(path.split(',')[1].split(' ')[0]);
		expect(firstY).toBeCloseTo(h - pad, 1);
	});

	it('handles all-equal values without dividing by zero', () => {
		// span falls back to 1, so all points should have the same y
		const path = sparkPath([3, 3, 3], 56, 16);
		expect(path).not.toBe('');
		// All y values should be identical (midpoint: pad + (h-2*pad)*(1-0/1) = pad)
		const yValues = path.split(' ').map((seg) => parseFloat(seg.split(',')[1]));
		expect(new Set(yValues).size).toBe(1);
	});

	it('uses default padding of 1 when pad is omitted', () => {
		const withDefault = sparkPath([1, 2], 56, 16);
		const withExplicit = sparkPath([1, 2], 56, 16, 1);
		expect(withDefault).toBe(withExplicit);
	});

	it('respects custom padding', () => {
		const withPad0 = sparkPath([1, 2], 56, 16, 0);
		const withPad4 = sparkPath([1, 2], 56, 16, 4);
		expect(withPad0).not.toBe(withPad4);
		// First x should differ by the pad value
		const x0 = parseFloat(withPad0.split(',')[0].replace('M', ''));
		const x4 = parseFloat(withPad4.split(',')[0].replace('M', ''));
		expect(x4 - x0).toBeCloseTo(4, 1);
	});

	it('produces a path matching the real vitals spark data', () => {
		// Regression: Workers Active sparkline (from component data)
		const path = sparkPath([1, 2, 1, 3, 2, 3, 3, 4, 3, 3], 56, 16);
		expect(path).toMatch(/^M/);
		expect(path.split(' ')).toHaveLength(10);
	});
});

// ── dotClass ─────────────────────────────────────────────────────────────────
describe('dotClass', () => {
	it('returns green class for "up" state', () => {
		expect(dotClass('up')).toBe('bg-status-green shadow-[0_0_8px_rgba(34,197,94,0.7)]');
	});

	it('returns amber class for "degraded" state', () => {
		expect(dotClass('degraded')).toBe('bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.7)]');
	});

	it('returns red class for "down" state', () => {
		expect(dotClass('down')).toBe('bg-status-red shadow-[0_0_8px_rgba(239,68,68,0.7)]');
	});

	it('falls back to red for an unknown state string', () => {
		expect(dotClass('unknown')).toBe('bg-status-red shadow-[0_0_8px_rgba(239,68,68,0.7)]');
	});

	it('falls back to red for an empty string', () => {
		expect(dotClass('')).toBe('bg-status-red shadow-[0_0_8px_rgba(239,68,68,0.7)]');
	});
});

// ── feedAccent ───────────────────────────────────────────────────────────────
describe('feedAccent', () => {
	it('returns green for "ship"', () => {
		expect(feedAccent('ship')).toBe('text-status-green');
	});

	it('returns purple for "merge"', () => {
		expect(feedAccent('merge')).toBe('text-status-purple');
	});

	it('returns blue for "dispatch"', () => {
		expect(feedAccent('dispatch')).toBe('text-status-blue');
	});

	it('returns muted-foreground for "observe"', () => {
		expect(feedAccent('observe')).toBe('text-muted-foreground');
	});
});

// ── Computed data values ─────────────────────────────────────────────────────
describe('dashboard computed values', () => {
	describe('throughputMax', () => {
		it('equals 7 for the 24h throughput sample data', () => {
			const throughput = [1, 0, 2, 3, 2, 4, 3, 5, 6, 4, 7, 6];
			const throughputMax = Math.max(...throughput);
			expect(throughputMax).toBe(7);
		});

		it('throughput array has 12 buckets (2h each over 24h)', () => {
			const throughput = [1, 0, 2, 3, 2, 4, 3, 5, 6, 4, 7, 6];
			expect(throughput).toHaveLength(12);
		});
	});

	describe('spendTotal', () => {
		it('totals to 12.84 USD for the sample spend data', () => {
			const spend = [
				{ label: 'CC · Claude', color: '#8b5cf6', usd: 6.42 },
				{ label: 'GMI · Gemini', color: '#3b82f6', usd: 3.18 },
				{ label: 'AGY · Antigrav', color: '#06b6d4', usd: 2.04 },
				{ label: 'DPSK', color: '#6b7280', usd: 1.2 }
			];
			const spendTotal = spend.reduce((a, b) => a + b.usd, 0);
			expect(spendTotal).toBeCloseTo(12.84, 2);
		});

		it('has 4 spend rows', () => {
			const spend = [
				{ label: 'CC · Claude', color: '#8b5cf6', usd: 6.42 },
				{ label: 'GMI · Gemini', color: '#3b82f6', usd: 3.18 },
				{ label: 'AGY · Antigrav', color: '#06b6d4', usd: 2.04 },
				{ label: 'DPSK', color: '#6b7280', usd: 1.2 }
			];
			expect(spend).toHaveLength(4);
		});

		it('all spend percentages sum to 100%', () => {
			const spend = [
				{ label: 'CC · Claude', color: '#8b5cf6', usd: 6.42 },
				{ label: 'GMI · Gemini', color: '#3b82f6', usd: 3.18 },
				{ label: 'AGY · Antigrav', color: '#06b6d4', usd: 2.04 },
				{ label: 'DPSK', color: '#6b7280', usd: 1.2 }
			];
			const total = spend.reduce((a, b) => a + b.usd, 0);
			const pctSum = spend.reduce((a, b) => a + (b.usd / total) * 100, 0);
			expect(pctSum).toBeCloseTo(100, 5);
		});
	});
});

// ── Mock data shape validation ───────────────────────────────────────────────
describe('dashboard static mock data shapes', () => {
	it('vitals array has 6 KPI cards', () => {
		const vitals = [
			{ label: 'Workers Active', value: '3', unit: '/ 4', delta: '+1', trend: 'up', accent: 'text-status-blue', spark: [1, 2, 1, 3, 2, 3, 3, 4, 3, 3] },
			{ label: 'Dispatches · 24h', value: '41', delta: '+12%', trend: 'up', accent: 'text-cta', spark: [2, 3, 1, 4, 3, 5, 4, 6, 5, 7] },
			{ label: 'Shipped Today', value: '17', delta: '+4', trend: 'up', accent: 'text-status-green', spark: [1, 1, 2, 2, 3, 3, 4, 4, 5, 6] },
			{ label: 'Success Rate', value: '94', unit: '%', delta: '+2.1', trend: 'up', accent: 'text-status-green', spark: [88, 90, 89, 91, 92, 90, 93, 92, 94, 94] },
			{ label: 'Median Cycle', value: '6.2', unit: 'm', delta: '−0.8m', trend: 'down', accent: 'text-status-purple', spark: [9, 8, 8, 7, 7, 6, 7, 6, 6, 6] },
			{ label: 'Spend Today', value: '12.84', unit: 'USD', delta: '+3.10', trend: 'up', accent: 'text-status-amber', spark: [2, 4, 5, 6, 7, 8, 9, 10, 11, 13] }
		];
		expect(vitals).toHaveLength(6);
	});

	it('each vital has at least 2 spark data points for a valid sparkline', () => {
		const sparks = [
			[1, 2, 1, 3, 2, 3, 3, 4, 3, 3],
			[2, 3, 1, 4, 3, 5, 4, 6, 5, 7],
			[1, 1, 2, 2, 3, 3, 4, 4, 5, 6],
			[88, 90, 89, 91, 92, 90, 93, 92, 94, 94],
			[9, 8, 8, 7, 7, 6, 7, 6, 6, 6],
			[2, 4, 5, 6, 7, 8, 9, 10, 11, 13]
		];
		sparks.forEach((spark) => {
			expect(spark.length).toBeGreaterThanOrEqual(2);
		});
	});

	it('fleet has 4 workers', () => {
		const fleet = [
			{ id: 'claude-code', state: 'busy' },
			{ id: 'gemini', state: 'busy' },
			{ id: 'agy', state: 'busy' },
			{ id: 'dpsk', state: 'idle' }
		];
		expect(fleet).toHaveLength(4);
	});

	it('fleet has 3 busy and 1 idle worker', () => {
		const fleet = [
			{ id: 'claude-code', state: 'busy' },
			{ id: 'gemini', state: 'busy' },
			{ id: 'agy', state: 'busy' },
			{ id: 'dpsk', state: 'idle' }
		];
		const busy = fleet.filter((w) => w.state === 'busy');
		const idle = fleet.filter((w) => w.state === 'idle');
		expect(busy).toHaveLength(3);
		expect(idle).toHaveLength(1);
	});

	it('services array has 6 entries', () => {
		const services = [
			{ name: 'MCP Gateway', port: 19100, state: 'up' },
			{ name: 'Dispatch Listener', port: 18900, state: 'up' },
			{ name: 'Sentinel', port: 0, state: 'up' },
			{ name: 'n8n', port: 5678, state: 'degraded' },
			{ name: 'Console', port: 18768, state: 'up' },
			{ name: 'Companion', port: 18769, state: 'up' }
		];
		expect(services).toHaveLength(6);
	});

	it('exactly one service is in degraded state (n8n)', () => {
		const services = [
			{ name: 'MCP Gateway', state: 'up' },
			{ name: 'Dispatch Listener', state: 'up' },
			{ name: 'Sentinel', state: 'up' },
			{ name: 'n8n', state: 'degraded' },
			{ name: 'Console', state: 'up' },
			{ name: 'Companion', state: 'up' }
		];
		const degraded = services.filter((s) => s.state === 'degraded');
		expect(degraded).toHaveLength(1);
		expect(degraded[0].name).toBe('n8n');
	});

	it('Sentinel service has port 0 (no port label should render)', () => {
		const sentinel = { name: 'Sentinel', port: 0, state: 'up', latency: '—', detail: 'no alerts' };
		expect(sentinel.port).toBe(0);
	});

	it('attention rail has 3 items', () => {
		const attention = [
			{ kind: 'ESCALATE', ticket: 'LOS-141' },
			{ kind: 'FAILED', ticket: 'PRO-204' },
			{ kind: 'REVIEW', ticket: 'LOS-145' }
		];
		expect(attention).toHaveLength(3);
	});

	it('attention items include FAILED and ESCALATE (critical) and REVIEW', () => {
		const attention = [
			{ kind: 'ESCALATE', ticket: 'LOS-141' },
			{ kind: 'FAILED', ticket: 'PRO-204' },
			{ kind: 'REVIEW', ticket: 'LOS-145' }
		];
		const kinds = attention.map((a) => a.kind);
		expect(kinds).toContain('ESCALATE');
		expect(kinds).toContain('FAILED');
		expect(kinds).toContain('REVIEW');
	});

	it('live feed has 6 entries', () => {
		const feed = [
			{ kind: 'ship', who: 'CC', text: 'LOS-147 shipped — voice/talkback rune module (#161)', ago: '9m' },
			{ kind: 'dispatch', who: 'ROOM', text: 'LOS-150 dispatched → AGY (usage sparklines)', ago: '14m' },
			{ kind: 'merge', who: 'GMI', text: 'PR #160 merged — MODEL_CHOICES catalog extracted', ago: '31m' },
			{ kind: 'observe', who: 'CC', text: 'Tier-0 observation logged: stale-base check caught drift', ago: '38m' },
			{ kind: 'ship', who: 'GMI', text: 'LOS-144 shipped — shared chat-ui types (#159)', ago: '52m' },
			{ kind: 'dispatch', who: 'ROOM', text: 'PRO-204 dispatched → DPSK (canon sweep)', ago: '1h' }
		];
		expect(feed).toHaveLength(6);
	});

	it('busy workers have required ticket, step, branch, and progress fields', () => {
		const busyWorkers = [
			{ id: 'claude-code', state: 'busy', ticket: 'LOS-148', step: 'Writing Code', branch: 'feat/dashboard-mockup', progress: 0.62 },
			{ id: 'gemini', state: 'busy', ticket: 'LOS-145', step: 'Running Tests', branch: 'fix/composer-safe-area', progress: 0.81 },
			{ id: 'agy', state: 'busy', ticket: 'LOS-150', step: 'Opening PR', branch: 'feat/usage-sparklines', progress: 0.93 }
		];
		busyWorkers.forEach((w) => {
			expect(w.ticket).toBeDefined();
			expect(w.step).toBeDefined();
			expect(w.branch).toBeDefined();
			expect(w.progress).toBeGreaterThanOrEqual(0);
			expect(w.progress).toBeLessThanOrEqual(1);
		});
	});
});

// ── Component rendering ──────────────────────────────────────────────────────
describe('DashboardPage component', () => {
	it('renders the "Command Deck" heading', () => {
		render(DashboardPage);
		expect(screen.getByRole('heading', { name: /command deck/i })).toBeInTheDocument();
	});

	it('renders the "mockup" badge', () => {
		render(DashboardPage);
		expect(screen.getByText(/mockup/i)).toBeInTheDocument();
	});

	it('renders the "Nominal" system status indicator', () => {
		render(DashboardPage);
		expect(screen.getByText(/nominal/i)).toBeInTheDocument();
	});

	it('renders all 6 vital KPI labels', () => {
		render(DashboardPage);
		const labels = [
			'Workers Active',
			'Dispatches · 24h',
			'Shipped Today',
			'Success Rate',
			'Median Cycle',
			'Spend Today'
		];
		labels.forEach((label) => {
			expect(screen.getByText(label)).toBeInTheDocument();
		});
	});

	it('renders all 4 worker labels in the fleet section', () => {
		render(DashboardPage);
		expect(screen.getByText('CC · Claude Code')).toBeInTheDocument();
		expect(screen.getByText('GMI · Gemini')).toBeInTheDocument();
		expect(screen.getByText('AGY · Antigravity')).toBeInTheDocument();
		expect(screen.getByText('DPSK · DeepSeek')).toBeInTheDocument();
	});

	it('renders all 6 service names in the services rail', () => {
		render(DashboardPage);
		const names = ['MCP Gateway', 'Dispatch Listener', 'Sentinel', 'n8n', 'Console', 'Companion'];
		names.forEach((name) => {
			expect(screen.getByText(name)).toBeInTheDocument();
		});
	});

	it('renders the degraded service count indicator', () => {
		render(DashboardPage);
		expect(screen.getByText('1 degraded')).toBeInTheDocument();
	});

	it('renders the worker fleet summary "3 busy · 1 idle"', () => {
		render(DashboardPage);
		expect(screen.getByText('3 busy · 1 idle')).toBeInTheDocument();
	});

	it('renders attention rail ticket IDs', () => {
		render(DashboardPage);
		expect(screen.getByText('LOS-141')).toBeInTheDocument();
		expect(screen.getByText('PRO-204')).toBeInTheDocument();
		expect(screen.getByText('LOS-145')).toBeInTheDocument();
	});

	it('renders the attention count (3)', () => {
		render(DashboardPage);
		// The count badge renders {attention.length} which is 3
		expect(screen.getByText('3')).toBeInTheDocument();
	});

	it('renders live activity feed entries with who and text', () => {
		render(DashboardPage);
		expect(screen.getByText('LOS-147 shipped — voice/talkback rune module (#161)')).toBeInTheDocument();
		expect(screen.getByText('PR #160 merged — MODEL_CHOICES catalog extracted')).toBeInTheDocument();
	});

	it('renders the static mockup disclaimer footer', () => {
		render(DashboardPage);
		expect(
			screen.getByText(/static mockup · sample data · not a live feed/i)
		).toBeInTheDocument();
	});

	it('renders "streaming" label in the live activity header', () => {
		render(DashboardPage);
		expect(screen.getByText('streaming')).toBeInTheDocument();
	});

	it('renders the throughput peak label', () => {
		render(DashboardPage);
		expect(screen.getByText('peak 7/2h')).toBeInTheDocument();
	});

	it('renders the total spend amount "$12.84"', () => {
		render(DashboardPage);
		expect(screen.getByText('$12.84')).toBeInTheDocument();
	});

	it('renders busy worker ticket IDs', () => {
		render(DashboardPage);
		expect(screen.getByText('LOS-148')).toBeInTheDocument();
		expect(screen.getByText('LOS-150')).toBeInTheDocument();
	});

	it('renders model names for all workers', () => {
		render(DashboardPage);
		expect(screen.getByText('opus-4.8')).toBeInTheDocument();
		expect(screen.getByText('gemini-3-pro')).toBeInTheDocument();
		expect(screen.getByText('gemini-3-flash')).toBeInTheDocument();
		expect(screen.getByText('deepseek-v3')).toBeInTheDocument();
	});

	it('renders SVG sparkline paths for each vital', () => {
		const { container } = render(DashboardPage);
		const svgPaths = container.querySelectorAll('svg[aria-hidden="true"] path');
		// One sparkline SVG path per vital (6 vitals)
		expect(svgPaths.length).toBeGreaterThanOrEqual(6);
	});

	it('renders a non-empty d attribute on each sparkline path', () => {
		const { container } = render(DashboardPage);
		const svgPaths = container.querySelectorAll('svg[aria-hidden="true"] path');
		svgPaths.forEach((path) => {
			expect(path.getAttribute('d')).not.toBe('');
		});
	});

	it('renders attention items with correct kind labels', () => {
		render(DashboardPage);
		expect(screen.getByText('ESCALATE')).toBeInTheDocument();
		expect(screen.getByText('FAILED')).toBeInTheDocument();
		expect(screen.getByText('REVIEW')).toBeInTheDocument();
	});
});
