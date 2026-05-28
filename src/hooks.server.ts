// Tailscale identity auth.
//
// Two access paths to the Console:
//
//   tailnet-direct:  no Tailscale-Funnel-Request header → operator on tailnet
//                    → automatically trusted, no further check.
//
//   Funnel:          Tailscale-Funnel-Request header present → came through the
//                    public Funnel URL (also set for tailnet clients using the
//                    public hostname). Sensitive API routes require a valid
//                    cc_operator cookie set by /console/operator-auth.
//                    Frontend pages always served so the PWA shell loads.

import type { Handle } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { startCompletionPoller } from '$lib/server/completion_poller';

startCompletionPoller();

const SENSITIVE_PREFIXES = ['/console/api/chat/', '/api/chat/'];
export const OPERATOR_COOKIE = 'cc_operator';

function isAuthorizedViaCookie(event: Parameters<Handle>[0]['event']): boolean {
	const token = privateEnv.LOGUEOS_OPERATOR_TOKEN;
	if (!token) return false;
	return event.cookies.get(OPERATOR_COOKIE) === token;
}

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const isSensitive = SENSITIVE_PREFIXES.some((prefix) => path.startsWith(prefix));

	if (isSensitive && event.request.headers.get('Tailscale-Funnel-Request') !== null) {
		if (!isAuthorizedViaCookie(event)) {
			return new Response(
				JSON.stringify({
					error: 'unauthorized',
					reason:
						'Visit /console/operator-auth?token=YOUR_TOKEN from your phone to set the auth cookie, then retry.'
				}),
				{ status: 401, headers: { 'Content-Type': 'application/json' } }
			);
		}
	}

	return resolve(event);
};
