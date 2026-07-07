/**
 * Clean-exit synthetic backfills are bookkeeping, not run outcomes: spawn.js
 * writes them when a session ends cleanly but produced no PR (interactive CC
 * sessions, probes, analysis-only dispatches). Counting them as failures put
 * a false "38 agents are stuck" alarm on the Sully Ops board (2026-07-07).
 *
 * Keyed on the structured `synthetic` flag (exposed by /api/runs) plus the
 * exit_clean reason; the reason still lives in the summary text because the
 * ledger's synthetic_reason field is not consistently populated. Timeout
 * backfills stay visible — a worker that died mid-run is a real signal.
 * Root-cause reclassification is tracked kernel-side as LOS-261.
 */
/** Minimal shape the noise check needs — route-local Run types qualify. */
export interface NoiseCheckableRun {
	status: string;
	summary: string;
	synthetic?: boolean;
}

export function isBookkeepingNoise(run: NoiseCheckableRun): boolean {
	return run.synthetic === true && run.summary.includes('reason=exit_clean');
}

/** FAILED/ESCALATE runs that represent real failures (noise stripped). */
export function realFailures<T extends NoiseCheckableRun>(runs: T[]): T[] {
	return runs.filter(
		(r) => (r.status === 'FAILED' || r.status === 'ESCALATE') && !isBookkeepingNoise(r)
	);
}

/** INCONCLUSIVE/unknown runs that genuinely await review (noise stripped). */
export function realReviews<T extends NoiseCheckableRun>(runs: T[]): T[] {
	return runs.filter(
		(r) => (r.status === 'INCONCLUSIVE' || r.status === 'unknown') && !isBookkeepingNoise(r)
	);
}
