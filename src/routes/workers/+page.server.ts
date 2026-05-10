import type { PageServerLoad } from './$types';
import { clientSafeConfig } from '$lib/server/config';

export const load: PageServerLoad = async ({ fetch }) => {
	const response = await fetch('/api/workers');
	const { workers } = await response.json();

	return {
		workers,
		config: clientSafeConfig
	};
};
