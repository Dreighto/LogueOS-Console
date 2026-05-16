import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { serverConfig } from '$lib/server/config';

// Tailscale CGNAT: 100.64.0.0/10 → 100.64–100.127.*.*
function isTailnetIp(ip: string): boolean {
	const plain = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
	const parts = plain.split('.');
	if (parts.length !== 4) return false;
	const a = Number.parseInt(parts[0], 10);
	const b = Number.parseInt(parts[1], 10);
	return a === 100 && b >= 64 && b <= 127;
}

function isLocalhost(ip: string): boolean {
	return ip === '127.0.0.1' || ip === '::1';
}

// Map session names to their configured ttyd URLs. An empty string means the
// operator hasn't set the env var yet; the load() below returns 503 in that case.
function sessionUrl(session: string): string | undefined {
	const urls: Record<string, string> = {
		'cc-con': serverConfig.ttydCcUrl,
		'gmi-con': serverConfig.ttydGmiUrl
	};
	return urls[session];
}

export const load: PageServerLoad = async ({ params, request, getClientAddress }) => {
	// Gate: allow only tailnet peers (Tailscale Serve sets X-Forwarded-For to
	// the peer's 100.x.x.x address) or direct localhost connections (dev / SSH).
	// Funnel requests from the public internet carry a public IP in
	// X-Forwarded-For and are rejected with 403.
	const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
	const directIp = getClientAddress();

	const allowed =
		isTailnetIp(forwardedFor) || // via Tailscale Serve, tailnet peer
		(forwardedFor === '' && isLocalhost(directIp)); // direct / dev access

	if (!allowed) {
		throw error(403, 'Terminal access is restricted to the tailnet.');
	}

	const { session } = params;
	const ttydUrl = sessionUrl(session);

	if (ttydUrl === undefined) {
		throw error(404, `Unknown terminal session: ${session}`);
	}

	if (!ttydUrl) {
		const envVar = session === 'cc-con' ? 'TTYD_CC_URL' : 'TTYD_GMI_URL';
		throw error(503, `Session '${session}' is not configured. Set ${envVar} in the environment.`);
	}

	return { session, ttydUrl };
};
