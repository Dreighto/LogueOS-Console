import type { PageServerLoad } from './$types';
import { clientSafeConfig } from '$lib/server/config';

export const load: PageServerLoad = async ({ fetch }) => {
	// Fetch workers and system health in parallel
	try {
		const [workersRes, systemRes] = await Promise.all([
			fetch('/api/workers').catch(() => null),
			fetch('/api/system').catch(() => null)
		]);

		const workersData = workersRes ? await workersRes.json() : { workers: [] };
		const systemData = systemRes ? await systemRes.json() : { services: [] };

		return {
			workers: workersData.workers || [],
			services: systemData.services || [],
			config: clientSafeConfig
		};
	} catch (error) {
		console.error('Settings load error:', error);
		return {
			workers: [],
			services: [],
			config: clientSafeConfig
		};
	}
};
