import { describe, it, expect } from 'vitest';
import { dedupeRuns } from '../../src/lib/utils/runs';
import type { Run } from '../../src/lib/types/run';

describe('dedupeRuns', () => {
	const mockRun = (overrides: Partial<Run> = {}): Run => ({
		timestamp: '2026-05-11T10:00:00Z',
		ticket_id: 'LOS-1',
		status: 'CONFIRMED_WORKING',
		summary: 'Fixed something',
		worker: 'gemini',
		trace_id: 'trace-1',
		duration_ms: 1000,
		pr_number: 1,
		branch: 'feature/los-1',
		files_touched: ['src/index.ts'],
		...overrides
	});

	it('should keep the latest row for the same trace_id', () => {
		const runs: Run[] = [
			mockRun({ trace_id: 'trace-1', summary: 'First' }),
			mockRun({ trace_id: 'trace-1', summary: 'Second' }),
			mockRun({ trace_id: 'trace-2', summary: 'Third' })
		];

		const result = dedupeRuns(runs);

		expect(result).toHaveLength(2);
		expect(result.find(r => r.trace_id === 'trace-1')?.summary).toBe('Second');
		expect(result.find(r => r.trace_id === 'trace-2')?.summary).toBe('Third');
	});

	it('should keep both rows if null trace_id but different ticket_id', () => {
		const runs: Run[] = [
			mockRun({ trace_id: null, ticket_id: 'LOS-2', summary: 'LOS-2 Run' }),
			mockRun({ trace_id: null, ticket_id: 'LOS-3', summary: 'LOS-3 Run' })
		];

		const result = dedupeRuns(runs);

		expect(result).toHaveLength(2);
		expect(result.some(r => r.ticket_id === 'LOS-2')).toBe(true);
		expect(result.some(r => r.ticket_id === 'LOS-3')).toBe(true);
	});

	it('should dedupe null trace_id if same (ticket_id, branch, pr_number)', () => {
		const common = {
			trace_id: null,
			ticket_id: 'LOS-4',
			branch: 'main',
			pr_number: 4
		};

		const runs: Run[] = [
			mockRun({ ...common, summary: 'First' }),
			mockRun({ ...common, summary: 'Second' })
		];

		const result = dedupeRuns(runs);

		expect(result).toHaveLength(1);
		expect(result[0].summary).toBe('Second');
	});

	it('should handle mixture of trace_id and null trace_id', () => {
		const runs: Run[] = [
			mockRun({ trace_id: 'trace-1', summary: 'T1-V1' }),
			mockRun({ trace_id: null, ticket_id: 'LOS-5', summary: 'L5-V1' }),
			mockRun({ trace_id: 'trace-1', summary: 'T1-V2' }),
			mockRun({ trace_id: null, ticket_id: 'LOS-5', summary: 'L5-V2' })
		];

		const result = dedupeRuns(runs);

		expect(result).toHaveLength(2);
		expect(result.find(r => r.trace_id === 'trace-1')?.summary).toBe('T1-V2');
		expect(result.find(r => r.ticket_id === 'LOS-5')?.summary).toBe('L5-V2');
	});

	it('should move re-inserted keys to the end to preserve chronological order', () => {
		const runs: Run[] = [
			mockRun({ trace_id: 'trace-1', summary: 'Old Trace 1' }),
			mockRun({ trace_id: 'trace-2', summary: 'Trace 2' }),
			mockRun({ trace_id: 'trace-1', summary: 'New Trace 1' })
		];

		const result = dedupeRuns(runs);

		expect(result).toHaveLength(2);
		expect(result[0].trace_id).toBe('trace-2');
		expect(result[1].trace_id).toBe('trace-1');
		expect(result[1].summary).toBe('New Trace 1');
	});
});
