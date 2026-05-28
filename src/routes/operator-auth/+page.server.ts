// Load handler for /console/operator-auth.
//
// Two modes:
//   GET /console/operator-auth?token=X  → validate, set cookie, redirect to /chat
//   GET /console/operator-auth          → render the +page.svelte form so the
//                                          operator can paste the token
//
// Why this lives in +page.server.ts instead of +server.ts: SvelteKit gives
// +server.ts precedence over +page.svelte for GET requests, so we can't have
// both at the same route. The page-load function is the canonical place for
// pre-render side-effects (cookie writes, redirects on validation success).

import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import { OPERATOR_COOKIE } from '../../hooks.server';

const ONE_YEAR = 60 * 60 * 24 * 365;

export const load: PageServerLoad = async ({ url, cookies }) => {
	const expected = privateEnv.LOGUEOS_OPERATOR_TOKEN;
	const supplied = url.searchParams.get('token');

	// No token → render the form via +page.svelte.
	if (!supplied) return {};

	if (!expected) {
		throw error(
			500,
			'LOGUEOS_OPERATOR_TOKEN is not configured on this Console. Set it in the canonical .env file and restart.'
		);
	}
	if (supplied !== expected) {
		throw error(401, 'invalid_token');
	}

	cookies.set(OPERATOR_COOKIE, expected, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: ONE_YEAR
	});

	throw redirect(302, '/console/chat');
};
