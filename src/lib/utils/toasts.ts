import { writable } from 'svelte/store';

export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface Toast {
	id: string;
	message: string;
	type: ToastType;
	duration?: number;
}

const { subscribe, update } = writable<Toast[]>([]);

export const toasts = {
	subscribe,
	add: (message: string, type: ToastType = 'info', duration?: number) => {
		const id = crypto.randomUUID();
		const defaultDuration = type === 'error' ? 8000 : 5000;
		const actualDuration = duration !== undefined ? duration : defaultDuration;

		update((all) => {
			const next = [{ id, message, type, duration: actualDuration }, ...all];
			return next.slice(0, 3);
		});

		if (actualDuration > 0) {
			setTimeout(() => {
				toasts.remove(id);
			}, actualDuration);
		}
	},
	remove: (id: string) => {
		update((all) => all.filter((t) => t.id !== id));
	}
};
