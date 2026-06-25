import fs from 'node:fs';
import Database from 'better-sqlite3';
import { serverConfig } from './config';
import { emitObservation } from './observation_emit';
import type { 
	JudgmentSuggestion, 
	WorkerRun, 
	TriageSuggestion, 
	TriageResponse, 
	TriageSubmission,
	AllowedOperatorJudgment,
	ALLOWED_OPERATOR_JUDGMENTS 
} from '$lib/types/judgment';

function getDb(): Database.Database {
	return new Database(serverConfig.memoryDbPath, { readonly: false });
}

/**
 * Fetch the next batch of unconfirmed suggestions, ordered by 
 * operator_confirmed IS NULL, created_at ASC so reload = continue.
 */
export function getTriageSuggestions(limit = 25): TriageResponse {
	if (!fs.existsSync(serverConfig.memoryDbPath)) {
		return { 
			suggestions: [], 
			total_unconfirmed: 0, 
			progress: { reviewed: 0, total: 0 } 
		};
	}

	const db = getDb();
	try {
		// Get total counts for progress tracking
		const totalCount = db.prepare('SELECT COUNT(*) as count FROM worker_run_judgment_suggestions').get() as { count: number };
		const unconfirmedCount = db.prepare(
			'SELECT COUNT(*) as count FROM worker_run_judgment_suggestions WHERE operator_confirmed IS NULL'
		).get() as { count: number };

		// Get the next batch of unconfirmed suggestions with their associated runs
		const suggestions = db.prepare(`
			SELECT 
				s.id, s.run_id, s.trace_id, s.suggested_label, s.rationale, 
				s.derived_from, s.confidence, s.source, s.created_at,
				s.operator_confirmed, s.operator_label,
				r.id as run_id_check, r.trace_id as run_trace_id, r.worker, 
				r.project_id, r.status, r.outcome, r.exit_code, r.started_at, 
				r.completed_at, r.duration_ms, r.prompt_hash, r.escalation_category,
				r.task_shape, r.commit_sha, r.operator_judgment, r.stderr_tail,
				r.created_at as run_created_at
			FROM worker_run_judgment_suggestions s
			LEFT JOIN worker_runs r ON s.run_id = r.id
			WHERE s.operator_confirmed IS NULL
			ORDER BY s.created_at ASC
			LIMIT ?
		`).all(limit) as any[];

		const triageSuggestions: TriageSuggestion[] = suggestions.map(row => ({
			suggestion: {
				id: row.id,
				run_id: row.run_id,
				trace_id: row.trace_id,
				suggested_label: row.suggested_label,
				rationale: row.rationale,
				derived_from: row.derived_from,
				confidence: row.confidence,
				source: row.source,
				created_at: row.created_at,
				operator_confirmed: row.operator_confirmed,
				operator_label: row.operator_label
			} as JudgmentSuggestion,
			run: {
				id: row.run_id_check,
				trace_id: row.run_trace_id,
				worker: row.worker,
				project_id: row.project_id,
				status: row.status,
				outcome: row.outcome,
				exit_code: row.exit_code,
				started_at: row.started_at,
				completed_at: row.completed_at,
				duration_ms: row.duration_ms,
				prompt_hash: row.prompt_hash,
				escalation_category: row.escalation_category,
				task_shape: row.task_shape,
				commit_sha: row.commit_sha,
				operator_judgment: row.operator_judgment,
				stderr_tail: row.stderr_tail,
				created_at: row.run_created_at
			} as WorkerRun
		}));

		return {
			suggestions: triageSuggestions,
			total_unconfirmed: unconfirmedCount.count,
			progress: {
				reviewed: totalCount.count - unconfirmedCount.count,
				total: totalCount.count
			}
		};
	} catch (e: unknown) {
		console.error('getTriageSuggestions error:', e);
		return { 
			suggestions: [], 
			total_unconfirmed: 0, 
			progress: { reviewed: 0, total: 0 } 
		};
	} finally {
		db.close();
	}
}

/**
 * Submit a triage decision. Updates both tables in a transaction.
 * Returns true if successful, false otherwise.
 */
export function submitTriageDecision(submission: TriageSubmission): boolean {
	if (!fs.existsSync(serverConfig.memoryDbPath)) {
		return false;
	}

	// Validate decision
	if (!['accept', 'reject', 'edit'].includes(submission.decision)) {
		return false;
	}

	// For edit decisions, operator_label is required
	if (submission.decision === 'edit' && !submission.operator_label?.trim()) {
		return false;
	}

	const db = getDb();
	try {
		// Start transaction
		const updateSuggestion = db.prepare(`
			UPDATE worker_run_judgment_suggestions 
			SET operator_confirmed = 1, operator_label = ?
			WHERE id = ?
		`);

		const updateRun = db.prepare(`
			UPDATE worker_runs 
			SET operator_judgment = ?
			WHERE id = (
				SELECT run_id FROM worker_run_judgment_suggestions WHERE id = ?
			)
		`);

		// Determine the final operator_judgment value
		let operatorJudgment: AllowedOperatorJudgment;
		let operatorLabel: string;

		if (submission.decision === 'accept') {
			// Use the suggested_label from the database
			const suggestion = db.prepare(
				'SELECT suggested_label FROM worker_run_judgment_suggestions WHERE id = ?'
			).get(submission.suggestion_id) as { suggested_label: string } | undefined;
			
			if (!suggestion) {
				return false; // suggestion_id not found
			}
			
			operatorJudgment = 'accepted';
			operatorLabel = suggestion.suggested_label;
		} else if (submission.decision === 'reject') {
			operatorJudgment = 'rejected';
			operatorLabel = 'rejected'; // Standard rejected label
		} else { // edit
			operatorJudgment = 'edited';
			operatorLabel = submission.operator_label!; // Already validated above
		}

		// Validate operator_label is one of allowed values for accept/reject,
		// or non-empty string for edit
		if (submission.decision !== 'edit') {
			// For accept/reject, we control the operator_label value
		} else {
			// For edit, just ensure it's not empty (already checked above)
		}

		// Execute in transaction
		db.transaction(() => {
			updateSuggestion.run(operatorLabel, submission.suggestion_id);
			updateRun.run(operatorJudgment, submission.suggestion_id);
		})();

		// Emit Tier 0 observation for the triage decision
		const suggestion = db.prepare(
			'SELECT trace_id, suggested_label FROM worker_run_judgment_suggestions WHERE id = ?'
		).get(submission.suggestion_id) as { trace_id: string; suggested_label: string } | undefined;

		if (suggestion) {
			const body = `Operator ${submission.decision} worker run judgment for trace ${suggestion.trace_id}. ` +
				`Suggested: "${suggestion.suggested_label}", Decision: "${operatorJudgment}", Final: "${operatorLabel}".`;

			emitObservation({
				source: 'console_triage',
				thread_id: 'judgment-triage-ui',
				tier_at_emit: 'tier-0',
				models_used: [],
				project_id: 'logueos-console',
				task_shape: ['judgment-triage', 'operator-decision', 'corpus-building'],
				body,
				observation_kind: 'what-worked'
			});
		}

		return true;
	} catch (e: unknown) {
		console.error('submitTriageDecision error:', e);
		return false;
	} finally {
		db.close();
	}
}

/**
 * Get a single suggestion by ID for validation
 */
export function getSuggestionById(suggestionId: number): JudgmentSuggestion | null {
	if (!fs.existsSync(serverConfig.memoryDbPath)) {
		return null;
	}

	const db = getDb();
	try {
		const row = db.prepare(`
			SELECT * FROM worker_run_judgment_suggestions WHERE id = ?
		`).get(suggestionId) as any;

		if (!row) return null;

		return {
			id: row.id,
			run_id: row.run_id,
			trace_id: row.trace_id,
			suggested_label: row.suggested_label,
			rationale: row.rationale,
			derived_from: row.derived_from,
			confidence: row.confidence,
			source: row.source,
			created_at: row.created_at,
			operator_confirmed: row.operator_confirmed,
			operator_label: row.operator_label
		} as JudgmentSuggestion;
	} catch (e: unknown) {
		console.error('getSuggestionById error:', e);
		return null;
	} finally {
		db.close();
	}
}