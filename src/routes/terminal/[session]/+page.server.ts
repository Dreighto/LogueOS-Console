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
	// Gate: reject any request that came in through Tailscale Funnel (the public
	// internet path). Tailscale sets the Tailscale-Funnel-Request header on every
	// Funnel-routed request — its presence is a hard signal "this came from the
	// public side." Direct tailnet access (raw 100.x IP), Tailscale-Serve-routed
	// access, and localhost all skip Funnel, so the header is absent and access
	// is allowed for any of those when the connecting peer is on the tailnet.
	const cameViaFunnel = !!request.headers.get('tailscale-funnel-request');
	const directIp = getClientAddress();

	const allowed = !cameViaFunnel && (isTailnetIp(directIp) || isLocalhost(directIp));

	if (!allowed) {
		throw error(
			403,
			'Terminal access requires Tailscale. Open this URL from a device with Tailscale active on the tailnet.'
		);
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
