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

export const load: PageServerLoad = async ({ params, request, url, getClientAddress }) => {
	// Gate moved out of SvelteKit and into the start_https.js HTTP Basic Auth
	// middleware (gates /console/terminal/* + /cc + /gmi). The Funnel-header
	// "no public access" check was retired 2026-05-15 because iPhone Safari
	// can only reach the Console via the Funnel — the tunnel-direct HTTPS
	// path hangs on the PQ ClientHello fragmentation issue.
	void request;
	void getClientAddress;
	void isTailnetIp;
	void isLocalhost;

	const { session } = params;
	if (session !== 'cc-con' && session !== 'gmi-con') {
		throw error(404, `Unknown terminal session: ${session}`);
	}

	// Build the ttyd URL on the SAME origin as the current request — Funnel
	// terminates TLS, forwards plain HTTP to start_https.js, which proxies
	// /cc and /gmi to the ttyd processes. Returning the relative origin
	// guarantees we match Safari's same-origin model.
	const base = `${url.origin}`;
	const ttydUrl = session === 'cc-con' ? `${base}/cc/` : `${base}/gmi/`;

	return { session, ttydUrl };
};
