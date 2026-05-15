import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMemoryData } from '$lib/server/memory';

export const GET: RequestHandler = async () => {
	try {
		const data = await getMemoryData();
		return json(data);
	} catch (error) {
		console.error('Error reading memory data:', error);
		return json({ error: 'failed_to_load_memory' }, { status: 500 });
	}
};
