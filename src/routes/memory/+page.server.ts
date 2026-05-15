import type { PageServerLoad } from './$types';
import { getMemoryData } from '$lib/server/memory';

export const load: PageServerLoad = async () => {
	const data = await getMemoryData();
	return {
		...data
	};
};
