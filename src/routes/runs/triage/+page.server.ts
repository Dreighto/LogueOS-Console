import type { PageServerLoad } from './$types';
import type { TriageResponse } from '$lib/types/judgment';
import { getTriageSuggestions } from '$lib/server/judgmentTriage.js';

export const load: PageServerLoad = async (): Promise<TriageResponse> => {
	return getTriageSuggestions();
};