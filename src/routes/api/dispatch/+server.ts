import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const {
			track_in_linear,
			linear_title,
			linear_description,
			linear_team,
			linear_project,
			linear_priority,
			...dispatchBody
		} = body;

		let ticket_id: string | null = dispatchBody.ticket_id ?? null;
		let ticket_url: string | null = null;

		if (track_in_linear) {
			const linearRes = await fetch(`${serverConfig.gatewayUrl}/api/v1/linear/file`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: linear_title,
					description: linear_description,
					team: linear_team,
					project: linear_project ?? null,
					priority: linear_priority ?? 2
				})
			});

			if (!linearRes.ok) {
				const errData = await linearRes.json().catch(() => ({}));
				return json(
					{ error: errData.error || 'Linear ticket creation failed' },
					{ status: linearRes.status }
				);
			}

			const linearData = await linearRes.json();
			ticket_id = linearData.ticket_id ?? null;
			ticket_url = linearData.ticket_url ?? null;
		}

		const response = await fetch(`${serverConfig.gatewayUrl}/api/v1/dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...dispatchBody, ticket_id })
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			return json({ error: errorData.error || 'Gateway dispatch failed' }, { status: response.status });
		}

		const data = await response.json();
		return json({ ...data, ticket_id, ticket_url });
	} catch (error) {
		console.error('Dispatch API error:', error);
		return json({ error: String(error) }, { status: 500 });
	}
};
