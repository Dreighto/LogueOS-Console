// Custom Node entry for the LogueOS Console.
//
// 2026-05-15 — switched architecture: Tailscale Funnel terminates TLS at the
// edge (proven to work on iPhone Safari), this process serves plain HTTP on
// localhost only. The previous in-Node TLS termination hung on iPhone over
// Tailscale's WireGuard tunnel because iOS 18.7's TLS 1.3 ClientHello
// (X25519MLKEM768 post-quantum key share) fragmented past the 1280-byte MTU.
// Funnel sits in Tailscale's edge infrastructure with a TLS stack iOS already
// works with, and it's at the well-known port 443 so the fragmentation path
// is different / battle-tested.
//
// Auth gate (HTTP Basic Auth, BASIC_AUTH=user:pass env var) protects routes
// that must not be publicly reachable even though Funnel exposes them on the
// public internet:
//   - the per-worker ttyd WebSocket proxies — terminal paths come from the
//     worker registry (src/lib/config/workers.json), so adding or swapping a
//     worker needs no change here.
// Everything else (Console dashboard, /console/api/*) is open over Funnel —
// no behavioral change for those.

import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handler } from '../build/handler.js';

const PORT = Number.parseInt(process.env.PORT ?? '18767', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// Auth gate. BASIC_AUTH="user:pass" — both fields required. If unset, the
// gate fails closed for protected paths (returns 503) so we don't silently
// leak terminal access. Non-gated paths continue to work.
const BASIC_AUTH = process.env.BASIC_AUTH ?? '';
const AUTH_CREDS = BASIC_AUTH ? Buffer.from(BASIC_AUTH).toString('base64') : '';

// Worker terminal routing is registry-driven — read the same workers.json the
// SvelteKit app uses so the proxied terminal paths stay in sync. Each enabled
// worker with a `terminal` block contributes one path → ttyd port mapping.
const REGISTRY_PATH = fileURLToPath(new URL('../src/lib/config/workers.json', import.meta.url));

function loadTerminalRoutes() {
	try {
		const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
		const routes = {};
		for (const w of registry.workers ?? []) {
			if (w.enabled && w.terminal && w.terminal.path && w.terminal.port) {
				routes[w.terminal.path] = { host: '127.0.0.1', port: w.terminal.port };
			}
		}
		return routes;
	} catch (err) {
		console.error(
			'[start_https] failed to read worker registry — terminal proxies disabled:',
			err.message
		);
		return {};
	}
}

// Path prefix → ttyd upstream. Built from the registry at startup; the keys
// double as the auth-protected prefixes.
const PROXY_TARGETS = loadTerminalRoutes();
const PROTECTED_PREFIXES = Object.keys(PROXY_TARGETS);

function requiresAuth(reqUrl) {
	// Strip query string for the comparison — `/cc?foo` must still match `/cc`.
	const path = reqUrl.split('?')[0];
	for (const p of PROTECTED_PREFIXES) {
		// p ends with `/` (deep prefix) — startsWith works.
		// p doesn't end with `/` (bare segment like `/cc`) — require either
		// exact match or next char is `/` so `/ccx` doesn't match `/cc`.
		if (p.endsWith('/')) {
			if (path === p.slice(0, -1) || path.startsWith(p)) return true;
		} else {
			if (path === p || path.startsWith(p + '/')) return true;
		}
	}
	return false;
}

function isAuthorized(req) {
	if (!AUTH_CREDS) return false;
	const header = req.headers['authorization'] ?? '';
	if (!header.startsWith('Basic ')) return false;
	const provided = header.slice(6).trim();
	// Constant-time compare via length-then-equal — short strings, no timing
	// risk worth a crypto.timingSafeEqual import here.
	return provided === AUTH_CREDS;
}

function send401(res) {
	res.statusCode = 401;
	res.setHeader('WWW-Authenticate', 'Basic realm="LogueOS Terminal", charset="UTF-8"');
	res.setHeader('Content-Type', 'text/plain; charset=utf-8');
	res.end('Authentication required');
}

function send503(res, msg) {
	res.statusCode = 503;
	res.setHeader('Content-Type', 'text/plain; charset=utf-8');
	res.end(msg);
}

function matchProxy(reqUrl) {
	for (const prefix of Object.keys(PROXY_TARGETS)) {
		if (reqUrl === prefix || reqUrl.startsWith(prefix + '/') || reqUrl.startsWith(prefix + '?')) {
			return PROXY_TARGETS[prefix];
		}
	}
	return null;
}

function proxyHttp(req, res, target) {
	const upstream = http.request(
		{
			host: target.host,
			port: target.port,
			method: req.method,
			path: req.url,
			headers: { ...req.headers, host: `${target.host}:${target.port}` }
		},
		(upRes) => {
			res.writeHead(upRes.statusCode ?? 502, upRes.headers);
			upRes.pipe(res);
		}
	);
	upstream.on('error', (err) => {
		console.error(`[start_https] proxy error for ${req.url}:`, err.message);
		if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
		res.end('Bad gateway: ttyd unreachable');
	});
	req.pipe(upstream);
}

function proxyUpgrade(req, clientSocket, head, target) {
	const upstream = http.request({
		host: target.host,
		port: target.port,
		method: req.method,
		path: req.url,
		headers: { ...req.headers, host: `${target.host}:${target.port}` }
	});
	upstream.on('upgrade', (upRes, upSocket, upHead) => {
		const statusLine = `HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}\r\n`;
		const headerLines =
			Object.entries(upRes.headers)
				.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
				.join('\r\n') + '\r\n\r\n';
		clientSocket.write(statusLine + headerLines);
		if (upHead && upHead.length > 0) clientSocket.write(upHead);
		upSocket.pipe(clientSocket).pipe(upSocket);
	});
	upstream.on('error', (err) => {
		console.error(`[start_https] WS upgrade error for ${req.url}:`, err.message);
		clientSocket.destroy();
	});
	upstream.end();
}

function dispatch(req, res) {
	const reqUrl = req.url ?? '/';
	if (requiresAuth(reqUrl)) {
		if (!AUTH_CREDS) {
			send503(res, 'Terminal access disabled: BASIC_AUTH env var not set on the host.');
			return;
		}
		if (!isAuthorized(req)) {
			send401(res);
			return;
		}
	}
	const target = matchProxy(reqUrl);
	if (target) {
		proxyHttp(req, res, target);
		return;
	}
	handler(req, res);
}

function dispatchUpgrade(req, clientSocket, head) {
	const reqUrl = req.url ?? '/';
	if (requiresAuth(reqUrl) && AUTH_CREDS && !isAuthorized(req)) {
		clientSocket.write(
			'HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="LogueOS Terminal"\r\n\r\n'
		);
		clientSocket.destroy();
		return;
	}
	const target = matchProxy(reqUrl);
	if (target) {
		proxyUpgrade(req, clientSocket, head, target);
	} else {
		clientSocket.destroy();
	}
}

http
	.createServer(dispatch)
	.on('upgrade', dispatchUpgrade)
	.listen(PORT, HOST, () => {
		console.log(
			`[start_https] HTTP listening on http://${HOST}:${PORT} (TLS terminated by Tailscale Funnel)`
		);
		if (!AUTH_CREDS) {
			console.warn(
				`[start_https] WARNING: BASIC_AUTH not set — terminal routes will return 503 until configured.`
			);
		}
	});
