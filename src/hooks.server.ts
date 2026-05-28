// Tailscale identity auth (PR 1c — D13). Updated 2026-05-27 to support
// operator-token cookie for Funnel access (iOS Safari blocks non-standard
// HTTPS ports like 8767, so the tailnet-only-port workaround doesn't work
// for the iPhone PWA).
//
// Three classes of request:
//
//   tailnet-direct:  request comes from the operator's Tailscale IP, no
//                    Tailscale-Funnel-Request header. Automatically treated
//                    as authenticated operator.
//
//   Funnel + cookie: came through Funnel, but `cc_operator` cookie matches
//                    LOGUEOS_OPERATOR_TOKEN env var. Authenticated.
//                    Cookie is set once via /console/operator-auth?token=X
//                    and persists for a year (survives PWA reinstall on
//                    the same Safari profile).
//
//   Funnel anon:     came through Funnel, no valid cookie. Sensitive API
//                    routes return 401. Frontend pages are still served so
//                    the PWA shell loads and can hit /operator-auth.

import type { Handle } from '@sveltejs/kit';
import { startCompletionPoller } from '$lib/server/completion_poller';
import { env as privateEnv } from '$env/dynamic/private';

// Start the Web Push completion poller once at server boot (PR 6).
// Tails cc_completion_log.jsonl and fires push on new chat-dispatched completions.
startCompletionPoller();

// Routes that require tailnet-direct access OR a valid operator cookie.
// Note: event.url.pathname INCLUDES the SvelteKit `paths.base` ('/console'),
// so the prefix must too.
const SENSITIVE_PREFIXES = ['/console/api/chat/', '/api/chat/'];

export const OPERATOR_COOKIE = 'cc_operator';

function isAuthorizedViaCookie(event: Parameters<Handle>[0]['event']): boolean {
	const token = privateEnv.LOGUEOS_OPERATOR_TOKEN;
	if (!token) return false;
	const cookie = event.cookies.get(OPERATOR_COOKIE);
	return cookie === token;
}

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	const isSensitive = SENSITIVE_PREFIXES.some((prefix) => path.startsWith(prefix));

	if (isSensitive) {
		const funnelHeader = event.request.headers.get('Tailscale-Funnel-Request');
		if (funnelHeader !== null && !isAuthorizedViaCookie(event)) {
			return new Response(
				JSON.stringify({
					error: 'unauthorized',
					reason:
						'This endpoint is not accessible via Tailscale Funnel without operator auth. Visit /console/operator-auth?token=YOUR_TOKEN to set the cookie, or connect via Tailscale tailnet.'
				}),
				{
					status: 401,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}
		// tailnet-direct OR valid cookie → authenticated operator.
	}

	return resolve(event);
};
