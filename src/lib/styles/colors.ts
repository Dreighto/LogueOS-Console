import type { RunStatus } from '$lib/types/run';

export const statusColors: Record<RunStatus, string> = {
	CONFIRMED_WORKING: '#3FB950',
	INCONCLUSIVE: '#F5A623',
	FAILED: '#F85149',
	ESCALATE: '#3B82F6',
	unknown: '#6B7280'
};

export const workerColors: Record<string, string> = {
	'claude-code': '#D97757',
	gemini: '#AD89EB',
	cursor: '#3B82F6',
	codex: '#64748B',
	operator: '#F5A623'
};
