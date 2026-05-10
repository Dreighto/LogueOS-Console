export type RunStatus = 'CONFIRMED_WORKING' | 'INCONCLUSIVE' | 'FAILED' | 'ESCALATE' | string;

export interface Run {
	timestamp: string;
	ticket_id: string | null;
	status: RunStatus;
	summary: string;
	worker: string | null;
	trace_id: string | null;
	duration_ms: number | null;
	pr_number: number | null;
	branch: string | null;
	files_touched: string[];
}

export interface RunsResponse {
	runs: Run[];
	total_in_log: number;
	truncated: boolean;
}
