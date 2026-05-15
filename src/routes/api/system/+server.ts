import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import http from 'node:http';

// Health-check targets. Mirrors the active LogueOS service set after the
// 2026-05-15 PR #48 sentinel narrowing — `pm` and `miru_ai` were dropped
// because the project-miru payload is parked. Keep this list in sync with
// `tools/sentinel/health_check.py:_HEALTH_ENDPOINTS` in the orchestrator
// repo. Adding a service here without adding it there (or vice versa) means
// the operator sees inconsistent up/down signals across surfaces.
const SERVICES = [
	{ id: 'mcp_gateway', name: 'Automation gateway', url: 'http://127.0.0.1:18766/health' },
	{ id: 'dispatch_listener', name: 'Dispatch system', url: 'http://127.0.0.1:19100/health' },
	{ id: 'n8n', name: 'Workflow engine', url: 'http://127.0.0.1:15678/healthz' }
];

async function checkHealth(url: string): Promise<boolean> {
	return new Promise((resolve) => {
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
