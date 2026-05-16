// Custom Node entry that wraps SvelteKit adapter-node's connect-style
// handler in an HTTPS server using a Tailscale-minted Let's Encrypt cert,
// and reverse-proxies /cc and /gmi paths to the ttyd processes running in
// WSL2 (via the netsh portproxy on 127.0.0.1:7681 / :7682). Single origin
// over a real public-CA cert — iOS Safari trusts it, no Tailscale Serve
// TLS layer in the way (which had iOS interop bugs on non-standard ports).
//
// Layout:
//   build/handler.js   — adapter-node's connect-style request handler
//   D:\ts-certs\       — Tailscale-minted Let's Encrypt cert + key
//
// Listens:
//   HTTP  on PORT       (default 18767) — localhost / legacy callers
//   HTTPS on HTTPS_PORT (default 18768) — what tailnet clients hit

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handler } from '../build/handler.js';

// HTTPS lives on the same port (18767) that proved iPhone-reachable in
// testing — picking a different port (e.g. 18768) timed out from iPhone
// Safari for reasons we couldn't pin down (MTU? port ACL? Safari quirk?).
// HTTP listener moved to a localhost-only debug port so nothing on the
// LAN/tailnet sees plain text.
const HTTPS_PORT = Number.parseInt(process.env.HTTPS_PORT ?? '18767', 10);
const HTTP_PORT = Number.parseInt(process.env.PORT ?? '18769', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const HTTP_HOST = '127.0.0.1';
const CERT_DIR = process.env.TLS_CERT_DIR ?? 'D:\\ts-certs';
const CERT_FILE = path.join(CERT_DIR, 'room-cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'room-key.pem');

// Path prefix → ttyd upstream. ttyd listens with base-path /cc and /gmi, so
// the request path is passed through unchanged.
const PROXY_TARGETS = {
	'/cc': { host: '127.0.0.1', port: 7681 },
	'/gmi': { host: '127.0.0.1', port: 7682 }
};

function matchProxy(reqUrl) {
	for (const prefix of Object.keys(PROXY_TARGETS)) {
		if (reqUrl === prefix || reqUrl.startsWith(prefix + '/') || reqUrl.startsWith(prefix + '?')) {
			return PROXY_TARGETS[prefix];
		}
	}
	return null;
}

// Forward an HTTP request to the ttyd upstream and pipe the response back.
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

// Forward a WebSocket upgrade to the ttyd upstream and tunnel both directions.
// ttyd uses a WebSocket subprotocol — must pass the Upgrade headers through.
function proxyUpgrade(req, clientSocket, head, target) {
	const upstream = http.request({
		host: target.host,
		port: target.port,
		method: req.method,
		path: req.url,
		headers: { ...req.headers, host: `${target.host}:${target.port}` }
	});
	upstream.on('upgrade', (upRes, upSocket, upHead) => {
		// Write the upgrade response to the client.
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

// Top-level request handler — checks proxy paths first, falls through to
// the SvelteKit handler.
function dispatch(req, res) {
	const target = matchProxy(req.url ?? '/');
	if (target) {
		proxyHttp(req, res, target);
		return;
	}
	handler(req, res);
}

function dispatchUpgrade(req, clientSocket, head) {
	const target = matchProxy(req.url ?? '/');
	if (target) {
		proxyUpgrade(req, clientSocket, head, target);
	} else {
		// SvelteKit doesn't currently use WebSockets; close cleanly.
		clientSocket.destroy();
	}
}

function readCert() {
	return {
		cert: fs.readFileSync(CERT_FILE),
		key: fs.readFileSync(KEY_FILE)
	};
}

// HTTP listener — localhost-only for dev / smoke tests. Tailnet clients
// use the HTTPS port below.
http
	.createServer(dispatch)
	.on('upgrade', dispatchUpgrade)
	.listen(HTTP_PORT, HTTP_HOST, () => {
		console.log(`[start_https] HTTP  listening on http://${HTTP_HOST}:${HTTP_PORT}`);
	});

// HTTPS listener — Tailscale-issued Let's Encrypt cert.
try {
	const tls = readCert();
	const httpsServer = https
		.createServer(tls, dispatch)
		.on('upgrade', dispatchUpgrade)
		.listen(HTTPS_PORT, HOST, () => {
			console.log(`[start_https] HTTPS listening on https://${HOST}:${HTTPS_PORT}`);
		});

	// Hot-reload TLS context when `tailscale cert` rewrites the files (renewal
	// scheduled task overwrites in place). fs.watch fires multiple times for
	// one write — debounce.
	let reloadTimer = null;
	const scheduleReload = () => {
		if (reloadTimer) clearTimeout(reloadTimer);
		reloadTimer = setTimeout(() => {
			try {
				httpsServer.setSecureContext(readCert());
				console.log('[start_https] reloaded TLS context');
			} catch (err) {
				console.error('[start_https] failed to reload TLS context:', err.message);
			}
		}, 2000);
	};
	fs.watch(CERT_DIR, (_, filename) => {
		if (filename === 'room-cert.pem' || filename === 'room-key.pem') scheduleReload();
	});
} catch (err) {
	console.error(`[start_https] HTTPS disabled — could not read cert at ${CERT_FILE}:`, err.message);
	console.error(`[start_https] run: tailscale cert --cert-file=${CERT_FILE} --key-file=${KEY_FILE} room.taila28611.ts.net`);
}
