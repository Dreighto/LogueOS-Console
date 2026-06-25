export interface JudgmentSuggestion {
	id: number;
	run_id: number;
	trace_id: string;
	suggested_label: string;
	rationale: string | null;
	derived_from: string | null;
	confidence: string;
	source: string;
	created_at: string;
	operator_confirmed: number | null;
	operator_label: string | null;
}

export interface WorkerRun {
	id: number;
	trace_id: string;
	worker: string;
	project_id: string | null;
	status: string | null;
	outcome: string;
	exit_code: number | null;
	started_at: string;
	completed_at: string | null;
	duration_ms: number | null;
	prompt_hash: string | null;
	escalation_category: string | null;
	task_shape: string | null;
	commit_sha: string | null;
	operator_judgment: string | null;
	stderr_tail: string | null;
	created_at: string;
}

export interface TriageSuggestion {
	suggestion: JudgmentSuggestion;
	run: WorkerRun;
}

export interface TriageResponse {
	suggestions: TriageSuggestion[];
	total_unconfirmed: number;
	progress: {
		reviewed: number;
		total: number;
	};
}

export type JudgmentDecision = 'accept' | 'reject' | 'edit';

export interface TriageSubmission {
	suggestion_id: number;
	decision: JudgmentDecision;
	operator_label?: string;
	note?: string;
}

export const ALLOWED_OPERATOR_JUDGMENTS = ['accepted', 'rejected', 'edited'] as const;
export type AllowedOperatorJudgment = typeof ALLOWED_OPERATOR_JUDGMENTS[number];