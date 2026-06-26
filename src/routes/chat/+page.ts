import { redirect } from '@sveltejs/kit';

// Compatibility shim for iOS PWAs that were "Added to Home Screen" back when
// the Console had a /chat route. iOS captures the visible URL at install time
// and ignores manifest start_url updates; every PWA launch from those old
// shortcuts otherwise lands on a 404 (LOS-247).
//
// Sully is the operator's chat surface now; bouncing PWA traffic to the
// Console home page keeps the operator inside the standalone shell instead of
// stranding them on a dead route.
export const load = () => {
	throw redirect(307, '/');
};
