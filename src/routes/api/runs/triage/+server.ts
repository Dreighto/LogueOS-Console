import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTriageSuggestions, submitTriageDecision, getSuggestionById } from '$lib/server/judgmentTriage';
import type { TriageSubmission } from '$lib/types/judgment';

export const GET: RequestHandler = async ({ url }) => {
	const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
	const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 25;

	try {
		const data = getTriageSuggestions(limit);
		return json(data);
	} catch (e: unknown) {
		console.error('Triage API GET error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { suggestion_id, decision, operator_label, note } = body;

		// Validate required fields
		if (typeof suggestion_id !== 'number' || !suggestion_id) {
			return json({ error: 'suggestion_id is required and must be a number' }, { status: 400 });
		}

		if (!decision || !['accept', 'reject', 'edit'].includes(decision)) {
			return json({ error: 'decision must be one of: accept, reject, edit' }, { status: 400 });
		}

		// For edit decisions, operator_label is required
		if (decision === 'edit' && (!operator_label || typeof operator_label !== 'string' || !operator_label.trim())) {
			return json({ error: 'operator_label is required for edit decisions' }, { status: 400 });
		}

		// Verify the suggestion exists and isn't already confirmed
		const suggestion = getSuggestionById(suggestion_id);
		if (!suggestion) {
			return json({ error: 'suggestion_id not found' }, { status: 404 });
		}

		if (suggestion.operator_confirmed !== null) {
			return json({ error: 'suggestion already confirmed' }, { status: 409 });
		}

		// Submit the decision
		const submission: TriageSubmission = {
			suggestion_id,
			decision,
			operator_label: decision === 'edit' ? operator_label : undefined,
			note
		};

		const success = submitTriageDecision(submission);
		if (!success) {
			return json({ error: 'failed to save decision' }, { status: 500 });
		}

		// Return success with updated progress
		const updatedData = getTriageSuggestions(25);
		return json({ 
			success: true, 
			progress: updatedData.progress,
			total_unconfirmed: updatedData.total_unconfirmed
		});
	} catch (e: unknown) {
		console.error('Triage API POST error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};