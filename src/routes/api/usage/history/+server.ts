import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUsageHistory } from '$lib/server/usage';

export type { UsageHistory, UsageProjection, DailyUsage } from '$lib/server/usage';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const days = Math.min(Math.max(parseInt(url.searchParams.get('days') ?? '30', 10), 1), 365);
		const history = getUsageHistory(isNaN(days) ? 30 : days);
		return json(history);
	} catch (error) {
		console.error('Error fetching usage history:', error);
		return json({ error: 'failed_to_load_history' }, { status: 500 });
	}
};
