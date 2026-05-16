import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const response = await fetch(`${serverConfig.gatewayUrl}/api/v1/dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tool_profile: 'standard_worker', ...body })
		});

		if (!response.ok) {
			const errorData = await response.json();
			return json({ error: errorData.error || 'Gateway dispatch failed' }, { status: response.status });
		}

		const data = await response.json();
		return json(data);
	} catch (error) {
		console.error('Dispatch API error:', error);
		return json({ error: String(error) }, { status: 500 });
	}
};
