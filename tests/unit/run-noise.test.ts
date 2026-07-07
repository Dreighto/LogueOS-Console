import { describe, expect, it } from 'vitest';
import { isBookkeepingNoise, realFailures, realReviews } from '$lib/utils/runNoise';

const base = { status: 'FAILED', summary: '', synthetic: false };

describe('isBookkeepingNoise', () => {
	it('flags synthetic clean-exit backfills regardless of ticket', () => {
		expect(
			isBookkeepingNoise({
				...base,
				synthetic: true,
				summary: '[spawn.js synthetic backfill, reason=exit_clean] no ticket_id parseable'
			})
		).toBe(true);
		expect(
			isBookkeepingNoise({
				...base,
				synthetic: true,
				summary: '[spawn.js synthetic backfill, reason=exit_clean] no PR found for SUL-159'
			})
		).toBe(true);
	});

	it('keeps timeout backfills and real failures visible', () => {
		expect(
			isBookkeepingNoise({
				...base,
				synthetic: true,
				summary: '[spawn.js synthetic backfill, reason=timeout] no ticket_id parseable'
			})
		).toBe(false);
		expect(isBookkeepingNoise({ ...base, summary: 'worker crashed mid-run' })).toBe(false);
	});

	it('does not trust summary text alone — the structured flag is required', () => {
		expect(
			isBookkeepingNoise({ ...base, synthetic: false, summary: 'mentions reason=exit_clean' })
		).toBe(false);
	});
});

describe('realFailures / realReviews', () => {
	const runs = [
		{ status: 'FAILED', summary: 'real crash', synthetic: false },
		{
			status: 'FAILED',
			summary: '[spawn.js synthetic backfill, reason=exit_clean] noise',
			synthetic: true
		},
		{ status: 'ESCALATE', summary: 'needs human', synthetic: false },
		{ status: 'INCONCLUSIVE', summary: 'no PR yet', synthetic: false },
		{
			status: 'unknown',
			summary: '[spawn.js synthetic backfill, reason=exit_clean] noise',
			synthetic: true
		},
		{ status: 'CONFIRMED_WORKING', summary: 'shipped', synthetic: false }
	];

	it('filters noise from both tiles', () => {
		expect(realFailures(runs).map((r) => r.summary)).toEqual(['real crash', 'needs human']);
		expect(realReviews(runs).map((r) => r.summary)).toEqual(['no PR yet']);
	});
});
