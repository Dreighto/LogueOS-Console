// Example unit test — proves the vitest pipeline works.
// Future workers: copy this pattern. Import the unit under test, exercise
// its data shaping / pure logic, assert on the output. Save Svelte
// component rendering for tests that genuinely need DOM (use
// @testing-library/svelte for those).
import { describe, it, expect } from 'vitest';

// Trivial data-shaping example — replace with a real util import once
// the /usage page has utils to test.
function totalTokens(usage: { prompt: number; completion: number; cache_read?: number }): number {
	return usage.prompt + usage.completion + (usage.cache_read ?? 0);
}

describe('totalTokens', () => {
	it('sums prompt + completion when cache is omitted', () => {
		expect(totalTokens({ prompt: 100, completion: 50 })).toBe(150);
	});

	it('includes cache_read when present', () => {
		expect(totalTokens({ prompt: 100, completion: 50, cache_read: 200 })).toBe(350);
	});

	it('handles zero values', () => {
		expect(totalTokens({ prompt: 0, completion: 0 })).toBe(0);
	});
});
