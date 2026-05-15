import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import http from 'node:http';

// Matches APPROVED_HEALTH_ENDPOINTS in LogueOS-Orchestrator
const SERVICES = [
	{ id: 'mcp_gateway', name: 'MCP Gateway', url: 'http://127.0.0.1:18766/health' },
	{ id: 'pm', name: 'Process Manager', url: 'http://127.0.0.1:18080/__pm_health' },
	{ id: 'miru_ai', name: 'Miru AI', url: 'http://127.0.0.1:18765/api/health' },
	{ id: 'dispatch_listener', name: 'Dispatch Listener', url: 'http://127.0.0.1:19100/health' },
	{ id: 'n8n', name: 'n8n (Docker)', url: 'http://127.0.0.1:15678/' }
];

async function checkHealth(url: string): Promise<boolean> {
	return new Promise((resolve) => {
		// Special case for MCP Gateway to avoid deadlock if called locally,
		// but here we are in the Console app, so we can just fetch it.
		const req = http.get(url, { timeout: 2000 }, (res) => {
			resolve(res.statusCode ? res.statusCode >= 200 && res.statusCode < 400 : false);
			res.resume();
		});
		req.on('error', () => resolve(false));
		req.on('timeout', () => {
			req.destroy();
			resolve(false);
		});
	});
}

export const GET: RequestHandler = async () => {
	const healthPromises = SERVICES.map(async (service) => {
		const isUp = await checkHealth(service.url);
		return {
			...service,
			status: isUp ? 'online' : 'offline'
		};
	});

	const statuses = await Promise.all(healthPromises);

	return json({
		services: statuses
	});
};
