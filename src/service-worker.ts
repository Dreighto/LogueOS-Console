/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

const CACHE_NAME = `cache-${version}`;

// Combine build artifacts (JS, CSS, static files) for comprehensive pre-caching
const ASSETS = [
	...build,
	...files
];

self.addEventListener('install', (event: any) => {
	async function preCache() {
		const cache = await caches.open(CACHE_NAME);
		await cache.addAll(ASSETS);
	}
	event.waitUntil(preCache());
});

self.addEventListener('activate', (event: any) => {
	async function deleteOldCaches() {
		const keys = await caches.keys();
		for (const key of keys) {
			if (key !== CACHE_NAME) {
				await caches.delete(key);
			}
		}
	}
	// Claim immediate control to enable offline shell booting on first visit
	self.clients.claim();
	event.waitUntil(deleteOldCaches());
});

// Push notification handler (PR 6 — iOS 2026 hardenings).
//
// event.waitUntil wrapping is NON-NEGOTIABLE: iOS Safari kills the push
// subscription after 3 consecutive silent pushes if showNotification is not
// wrapped in waitUntil. Verified per Decision Log entry 10.
//
// iOS 18.4+ Declarative Web Push: Apple displays notifications directly from
// the payload (title/body/icon at root level) without invoking this handler.
// This handler remains as the fallback for older iOS, Chrome, and Firefox.
self.addEventListener('push', (event: any) => {
	event.waitUntil(
		(async () => {
			const data = event.data?.json() ?? {};
			await (self as any).registration.showNotification(data.title || 'LogueOS', {
				body: data.body || '',
				icon: '/console/favicon.png',
				vibrate: [100, 50, 100],
				data: { url: data.data?.url || data.url || '/console' }
			});
		})()
	);
});

self.addEventListener('notificationclick', (event: any) => {
	event.notification.close();
	event.waitUntil(
		(self as any).clients.openWindow(
			event.notification.data?.url || '/console'
		)
	);
});

self.addEventListener('fetch', (event: any) => {
	// Skip non-GET requests (e.g. POST for dispatch actions)
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);

	// Check if this is a static build asset or a pre-cached file
	const isAsset = ASSETS.includes(url.pathname) || url.pathname.startsWith('/console/_app/immutable/');

	if (isAsset) {
		// Cache-first strategy: serve cached copy directly for instant loading
		event.respondWith(
			caches.match(event.request).then((cachedResponse) => {
				return cachedResponse || fetch(event.request);
			})
		);
	} else {
		// Network-first strategy for APIs and active routing HTML
		event.respondWith(
			fetch(event.request)
				.then((response) => {
					// Cache the last known successful response for dynamic pages
					const isHttp = url.protocol.startsWith('http');
					const isStaticOrApi = !url.pathname.includes('/@vite/') && !url.pathname.includes('/node_modules/') && !url.pathname.includes('/ws');
					if (response.status === 200 && isHttp && isStaticOrApi) {
						const clone = response.clone();
						caches.open(CACHE_NAME).then((cache) => {
							cache.put(event.request, clone);
						});
					}
					return response;
				})
				.catch(async () => {
					// Network is offline / down. Fallback to cached pages and dynamic data
					const cachedResponse = await caches.match(event.request);
					if (cachedResponse) {
						return cachedResponse;
					}

					// Return fallback response for un-cached endpoints when network is down
					return new Response('Network connection unavailable.', {
						status: 503,
						statusText: 'Service Unavailable',
						headers: { 'Content-Type': 'text/plain' }
					});
				})
		);
	}
});
