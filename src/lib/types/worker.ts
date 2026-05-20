export type WorkerState = 'idle' | 'busy' | 'offline';

export interface WorkerStatus {
	id: string; // registry worker id, e.g. 'backend-1' (see $lib/config/workers)
	state: WorkerState;
	trace_id?: string;
	pid?: number;
	since?: string;
	last_exit_status?: string;
	ticket_id?: string;
	step?: string;
	branch?: string;
	last_file_written?: string;
}
