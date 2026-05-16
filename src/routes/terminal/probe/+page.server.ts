import type { PageServerLoad } from './$types';

// Operator-facing diagnostic page: shows what the server actually saw on
// this request so we can debug "the terminal won't load on my phone" without
// SSH'ing into the box. Returns 200 unconditionally — the page itself
// surfaces whether the gate WOULD have allowed terminal access.
export const load: PageServerLoad = async ({ request, getClientAddress, url }) => {
	const headers = Object.fromEntries(request.headers.entries());
	const directIp = getClientAddress();
	const funnelHeader = headers['tailscale-funnel-request'] ?? null;
	const forwardedFor = headers['x-forwarded-for'] ?? null;

	// Mirror the same logic from /terminal/[session]/+page.server.ts.
	const cameViaFunnel = !!funnelHeader;
	const isTailnetIp = (ip: string) => {
		const plain = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
		const parts = plain.split('.');
		if (parts.length !== 4) return false;
		const a = Number.parseInt(parts[0], 10);
		const b = Number.parseInt(parts[1], 10);
		return a === 100 && b >= 64 && b <= 127;
	};
	const isLocalhost = (ip: string) => ip === '127.0.0.1' || ip === '::1';
	const gateAllowed = !cameViaFunnel && (isTailnetIp(directIp) || isLocalhost(directIp));

	return {
		url: url.href,
		directIp,
		funnelHeader,
		forwardedFor,
		gateAllowed,
		gateReason: cameViaFunnel
			? 'BLOCKED: Tailscale-Funnel-Request header present — you reached this via the public Funnel (port 443), not via the tailnet :8444 port.'
			: gateAllowed
				? 'ALLOWED: direct tailnet or localhost peer.'
				: `BLOCKED: peer IP ${directIp} is not in tailnet (100.64.0.0/10) or localhost.`,
		allHeaders: headers
	};
};
