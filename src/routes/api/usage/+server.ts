import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUsageMetrics } from '$lib/server/usage';
export type { UsageMetrics } from '$lib/server/usage';

export const GET: RequestHandler = async () => {
	try {
		const metrics = await getUsageMetrics();
		return json({ metrics });
	} catch (error) {
		console.error('Error parsing usage metrics:', error);
		return json({ error: 'failed_to_load_usage' }, { status: 500 });
	}
};
