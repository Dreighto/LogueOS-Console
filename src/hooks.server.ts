// Tailscale identity auth (PR 1c — D13).
//
// The Console is only served over Tailscale. Two classes of request:
//
//   tailnet-direct:  request comes from the operator's Tailscale IP, no
//                    Tailscale-Funnel-Request header. Automatically treated
//                    as authenticated operator.
//
//   Funnel:          request came through Tailscale Funnel (public internet).
//                    The Tailscale-Funnel-Request header is set. Sensitive
//                    API routes (/api/chat/*) return 401. Frontend pages are
//                    still served so the PWA shell loads.
//
// This is the minimal auth gate needed before paid-API endpoints go live.
// Future PRs can add session tokens or HMAC-signed requests for multi-user.

import type { Handle } from '@sveltejs/kit';
import { startCompletionPoller } from '$lib/server/completion_poller';

// Start the Web Push completion poller once at server boot (PR 6).
// Tails cc_completion_log.jsonl and fires push on new chat-dispatched completions.
startCompletionPoller();

// Routes that require tailnet-direct access. Funnel requests to these
// paths return 401 with a JSON error body.
const SENSITIVE_PREFIXES = ['/api/chat/'];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	const isSensitive = SENSITIVE_PREFIXES.some((prefix) => path.startsWith(prefix));

	if (isSensitive) {
		const funnelHeader = event.request.headers.get('Tailscale-Funnel-Request');
		if (funnelHeader !== null) {
			// Request came through Funnel (public internet). Reject.
			return new Response(
				JSON.stringify({
					error: 'unauthorized',
					reason: 'This endpoint is not accessible via Tailscale Funnel. Connect via Tailscale tailnet.'
				}),
				{
					status: 401,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}
		// No Funnel header → tailnet-direct → automatically authenticated as operator.
	}

	return resolve(event);
};
