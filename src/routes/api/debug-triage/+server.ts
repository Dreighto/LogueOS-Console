import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		// Test the server function import directly
		const { getTriageSuggestions } = await import('$lib/server/judgmentTriage.js');
		const result = getTriageSuggestions();
		
		return json({
			success: true,
			suggestionsCount: result.suggestions.length,
			totalUnconfirmed: result.total_unconfirmed,
			progress: result.progress
		});
	} catch (error) {
		return json({
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		});
	}
};