import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET, POST } from '../../../src/routes/api/triage/+server';
import { RequestEvent } from '@sveltejs/kit';
import * as judgmentTriage from '../../../src/lib/server/judgmentTriage';

// Mock the judgment triage module
vi.mock('../../../src/lib/server/judgmentTriage', () => ({
	getTriageSuggestions: vi.fn(),
	submitTriageDecision: vi.fn(),
	getSuggestionById: vi.fn()
}));

describe('Triage API Endpoints', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	describe('GET /api/runs/triage', () => {
	describe('GET /api/triage', () => {
		it('returns triage suggestions with default limit', async () => {
			const mockData = {
				suggestions: [
					{
						suggestion: {
							id: 1,
							run_id: 1,
							trace_id: 'test-trace',
							suggested_label: 'accepted',
							rationale: 'Test rationale',
							derived_from: null,
							confidence: 'high',
							source: 'derived',
							created_at: '2024-01-01T00:00:00Z',
							operator_confirmed: null,
							operator_label: null
						},
						run: {
							id: 1,
							trace_id: 'test-trace',
							worker: 'test-worker',
							project_id: 'test-project',
							status: 'success',
							outcome: 'CONFIRMED_WORKING',
							exit_code: 0,
							started_at: '2024-01-01T00:00:00Z',
							completed_at: '2024-01-01T00:01:00Z',
							duration_ms: 60000,
							prompt_hash: null,
							escalation_category: null,
							task_shape: null,
							commit_sha: null,
							operator_judgment: null,
							stderr_tail: null,
							created_at: '2024-01-01T00:00:00Z'
						}
					}
				],
				total_unconfirmed: 1,
				progress: { reviewed: 0, total: 1 }
			};

			vi.mocked(judgmentTriage.getTriageSuggestions).mockReturnValue(mockData);

			const mockEvent = {
				url: new URL('http://localhost/api/triage')
			} as RequestEvent;

			const response = await GET(mockEvent);
			const data = await response.json();

			expect(judgmentTriage.getTriageSuggestions).toHaveBeenCalledWith(25);
			expect(data).toEqual(mockData);
		});

		it('respects custom limit parameter', async () => {
			const mockData = {
				suggestions: [],
				total_unconfirmed: 0,
				progress: { reviewed: 0, total: 0 }
			};

			vi.mocked(judgmentTriage.getTriageSuggestions).mockReturnValue(mockData);

			const mockEvent = {
				url: new URL('http://localhost/api/triage?limit=50')
			} as RequestEvent;

			const response = await GET(mockEvent);

			expect(judgmentTriage.getTriageSuggestions).toHaveBeenCalledWith(50);
		});
	});

	});

	describe('POST /api/triage', () => {
		it('successfully submits an accept decision', async () => {
			const mockSuggestion = {
				id: 1,
				run_id: 1,
				trace_id: 'test-trace',
				suggested_label: 'accepted',
				rationale: 'Test rationale',
				derived_from: null,
				confidence: 'high',
				source: 'derived',
				created_at: '2024-01-01T00:00:00Z',
				operator_confirmed: null,
				operator_label: null
			};

			const mockProgressData = {
				suggestions: [],
				total_unconfirmed: 0,
				progress: { reviewed: 1, total: 1 }
			};

			vi.mocked(judgmentTriage.getSuggestionById).mockReturnValue(mockSuggestion);
			vi.mocked(judgmentTriage.submitTriageDecision).mockReturnValue(true);
			vi.mocked(judgmentTriage.getTriageSuggestions).mockReturnValue(mockProgressData);

			const mockEvent = {
				request: {
					json: () => Promise.resolve({
						suggestion_id: 1,
						decision: 'accept'
					})
				}
			} as RequestEvent;

			const response = await POST(mockEvent);
			const data = await response.json();

			expect(judgmentTriage.getSuggestionById).toHaveBeenCalledWith(1);
			expect(judgmentTriage.submitTriageDecision).toHaveBeenCalledWith({
				suggestion_id: 1,
				decision: 'accept'
			});
			expect(data.success).toBe(true);
			expect(data.progress).toEqual(mockProgressData.progress);
		});

		it('requires operator_label for edit decisions', async () => {
			const mockEvent = {
				request: {
					json: () => Promise.resolve({
						suggestion_id: 1,
						decision: 'edit'
					})
				}
			} as RequestEvent;

			const response = await POST(mockEvent);
			const data = await response.json();

			expect(response.status).toBe(400);
			expect(data.error).toBe('operator_label is required for edit decisions');
		});

		it('validates decision values', async () => {
			const mockEvent = {
				request: {
					json: () => Promise.resolve({
						suggestion_id: 1,
						decision: 'invalid'
					})
				}
			} as RequestEvent;

			const response = await POST(mockEvent);
			const data = await response.json();

			expect(response.status).toBe(400);
			expect(data.error).toBe('decision must be one of: accept, reject, edit');
		});

		it('returns 404 for non-existent suggestions', async () => {
			vi.mocked(judgmentTriage.getSuggestionById).mockReturnValue(null);

			const mockEvent = {
				request: {
					json: () => Promise.resolve({
						suggestion_id: 999,
						decision: 'accept'
					})
				}
			} as RequestEvent;

			const response = await POST(mockEvent);
			const data = await response.json();

			expect(response.status).toBe(404);
			expect(data.error).toBe('suggestion_id not found');
		});

		it('returns 409 for already confirmed suggestions', async () => {
			const mockSuggestion = {
				id: 1,
				run_id: 1,
				trace_id: 'test-trace',
				suggested_label: 'accepted',
				rationale: 'Test rationale',
				derived_from: null,
				confidence: 'high',
				source: 'derived',
				created_at: '2024-01-01T00:00:00Z',
				operator_confirmed: 1, // Already confirmed
				operator_label: 'accepted'
			};

			vi.mocked(judgmentTriage.getSuggestionById).mockReturnValue(mockSuggestion);

			const mockEvent = {
				request: {
					json: () => Promise.resolve({
						suggestion_id: 1,
						decision: 'accept'
					})
				}
			} as RequestEvent;

			const response = await POST(mockEvent);
			const data = await response.json();

			expect(response.status).toBe(409);
			expect(data.error).toBe('suggestion already confirmed');
		});
	});
});