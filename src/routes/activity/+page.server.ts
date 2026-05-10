import type { PageServerLoad } from './$types';
import { clientSafeConfig } from '$lib/server/config';

export const load: PageServerLoad = async ({ fetch }) => {
    try {
        const response = await fetch('/api/activity');
        if (response.ok) {
            const { events } = await response.json();
            return {
                events,
                clientSafeConfig
            };
        }
    } catch (error) {
        console.error('Error in activity page load:', error);
    }

    return {
        events: [],
        clientSafeConfig
    };
};
