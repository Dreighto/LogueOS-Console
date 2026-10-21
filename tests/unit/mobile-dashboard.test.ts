// Unit coverage for the /mobile-dashboard sample-data module. The page itself
// is a static mockup (no fetch, no API), so the logic worth testing lives
// entirely in these pure functions: the tallies that drive the stat tiles,
// the success-rate/spend math, the formatters, and the "Refresh" control's
// randomize function.
import { describe, it, expect } from 'vitest';
import {
	initialSnapshot,
	randomizeSnapshot,
	tallyFleetStates,
	tallyServiceStates,
	computeSuccessRate,
	computeTotalSpend,
	formatCurrency,
	formatMinutesAgo,
	type RunOutcome
} from '$lib/components/mobile-dashboard/data';

describe('tallyFleetStates', () => {
	it('counts busy/idle/error from the fixed initial snapshot', () => {
		const tally = tallyFleetStates(initialSnapshot().fleet);
		expect(tally).toEqual({ busy: 2, idle: 2, error: 1 });
	});

	it('sums to the total worker count', () => {
		const fleet = initialSnapshot().fleet;
		const tally = tallyFleetStates(fleet);
		expect(tally.busy + tally.idle + tally.error).toBe(fleet.length);
	});

	it('returns all zeros for an empty fleet', () => {
		expect(tallyFleetStates([])).toEqual({ busy: 0, idle: 0, error: 0 });
	});
});

describe('tallyServiceStates', () => {
	it('counts good/warning/critical from the fixed initial snapshot', () => {
		const tally = tallyServiceStates(initialSnapshot().services);
		expect(tally).toEqual({ good: 3, warning: 1, critical: 1 });
	});

	it('sums to the total service count', () => {
		const services = initialSnapshot().services;
		const tally = tallyServiceStates(services);
		expect(tally.good + tally.warning + tally.critical).toBe(services.length);
	});
});

describe('computeSuccessRate', () => {
	it('computes percentage of success among terminal (success+failed) runs only', () => {
		const runs: RunOutcome[] = [
			mkRun('success'),
			mkRun('success'),
			mkRun('failed'),
			mkRun('running'), // excluded from denominator
			mkRun('queued') // excluded from denominator
		];
		// 2 success / 2 terminal(success) + 1 terminal(failed) = 2/3 => 67%
		expect(computeSuccessRate(runs)).toBe(67);
	});

	it('returns 0 when there are no terminal runs', () => {
		expect(computeSuccessRate([mkRun('running'), mkRun('queued')])).toBe(0);
	});

	it('returns 0 for an empty run list', () => {
		expect(computeSuccessRate([])).toBe(0);
	});

	it('returns 100 when every terminal run succeeded', () => {
		expect(computeSuccessRate([mkRun('success'), mkRun('success')])).toBe(100);
	});
});

describe('computeTotalSpend', () => {
	it('sums the fixed initial snapshot spend to cents precision', () => {
		expect(computeTotalSpend(initialSnapshot().spend)).toBeCloseTo(8.37, 2);
	});

	it('returns 0 for an empty spend list', () => {
		expect(computeTotalSpend([])).toBe(0);
	});
});

describe('formatCurrency', () => {
	it('formats to two decimal places with a dollar sign', () => {
		expect(formatCurrency(4.8)).toBe('$4.80');
		expect(formatCurrency(0)).toBe('$0.00');
		expect(formatCurrency(12.345)).toBe('$12.35'); // rounds, doesn't truncate
	});
});

describe('formatMinutesAgo', () => {
	it('shows "just now" for sub-minute values', () => {
		expect(formatMinutesAgo(0)).toBe('just now');
		expect(formatMinutesAgo(0.5)).toBe('just now');
	});

	it('shows minutes for under an hour', () => {
		expect(formatMinutesAgo(1)).toBe('1m ago');
		expect(formatMinutesAgo(45)).toBe('45m ago');
	});

	it('shows hours with no minutes remainder cleanly', () => {
		expect(formatMinutesAgo(60)).toBe('1h ago');
		expect(formatMinutesAgo(120)).toBe('2h ago');
	});

	it('shows hours and minutes together', () => {
		expect(formatMinutesAgo(90)).toBe('1h 30m ago');
		expect(formatMinutesAgo(174)).toBe('2h 54m ago');
	});
});

describe('randomizeSnapshot', () => {
	it('preserves ids, labels and colors while re-rolling state', () => {
		const before = initialSnapshot();
		const after = randomizeSnapshot(before);

		expect(after.fleet.map((w) => w.id)).toEqual(before.fleet.map((w) => w.id));
		expect(after.services.map((s) => s.id)).toEqual(before.services.map((s) => s.id));
		expect(after.runs.map((r) => r.id)).toEqual(before.runs.map((r) => r.id));
		expect(after.spend.map((w) => w.id)).toEqual(before.spend.map((w) => w.id));

		for (const w of after.spend) {
			const match = before.spend.find((b) => b.id === w.id)!;
			expect(w.color).toBe(match.color);
			expect(w.label).toBe(match.label);
		}
	});

	it('keeps every value within its valid domain after many re-rolls', () => {
		let snapshot = initialSnapshot();
		const validFleetStates = new Set(['busy', 'idle', 'error']);
		const validServiceStates = new Set(['good', 'warning', 'critical']);
		const validRunStates = new Set(['success', 'failed', 'running', 'queued']);

		for (let i = 0; i < 25; i++) {
			snapshot = randomizeSnapshot(snapshot);

			for (const w of snapshot.fleet) {
				expect(validFleetStates.has(w.state)).toBe(true);
				// A busy worker always has a task; a non-busy worker never does —
				// the randomizer must keep these in sync on every re-roll.
				if (w.state === 'busy') expect(w.task).not.toBeNull();
				else expect(w.task).toBeNull();
			}
			for (const s of snapshot.services) {
				expect(validServiceStates.has(s.state)).toBe(true);
			}
			for (const r of snapshot.runs) {
				expect(validRunStates.has(r.state)).toBe(true);
				expect(r.durationMin).toBeGreaterThanOrEqual(0);
				expect(r.minutesAgo).toBeGreaterThanOrEqual(0);
				if (r.state === 'queued') expect(r.durationMin).toBe(0);
			}
			for (const w of snapshot.spend) {
				expect(w.spend).toBeGreaterThan(0);
			}
		}
	});

	it('updates generatedAt on every call', () => {
		const before = initialSnapshot();
		const t0 = before.generatedAt.getTime();
		const after = randomizeSnapshot(before);
		expect(after.generatedAt.getTime()).toBeGreaterThanOrEqual(t0);
	});

	it('does not mutate the input snapshot (returns new arrays)', () => {
		const before = initialSnapshot();
		const beforeFleetSnapshot = before.fleet.map((w) => ({ ...w }));
		randomizeSnapshot(before);
		expect(before.fleet).toEqual(beforeFleetSnapshot);
	});
});

// --- test helpers ---------------------------------------------------------

let runCounter = 0;
function mkRun(state: RunOutcome['state']): RunOutcome {
	runCounter++;
	return {
		id: `test-run-${runCounter}`,
		ticket: `LOS-${runCounter}`,
		workerId: 'cc-backend-1',
		workerLabel: 'Claude Backend',
		workerColor: '#D97757',
		state,
		durationMin: 5,
		minutesAgo: 10,
		summary: 'test run'
	};
}
