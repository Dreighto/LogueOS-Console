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
	add: (message: string, type: ToastType = 'info', duration = 3000) => {
		const id = crypto.randomUUID();
		update((all) => [{ id, message, type, duration }, ...all]);
		if (duration > 0) {
			setTimeout(() => {
				toasts.remove(id);
			}, duration);
		}
	},
	remove: (id: string) => {
		update((all) => all.filter((t) => t.id !== id));
	}
};
