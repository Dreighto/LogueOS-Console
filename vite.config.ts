import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Build-time identifiers surfaced in /settings footer (LOS-73). Lets the
// operator know exactly which build is running when triaging Console issues.
// All three values are inlined as constants at build time via Vite's `define`,
// so they cost nothing at runtime and never need a network round-trip.
function getBuildVersion(): string {
	try {
		const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
		return String(pkg.version || '0.0.0');
	} catch {
		return '0.0.0';
	}
}
function getBuildSha(): string {
	try {
		return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
	} catch {
		// Fallback for non-git contexts (e.g., a tarball deploy).
		return 'unknown';
	}
}
const BUILD_VERSION = getBuildVersion();
const BUILD_SHA = getBuildSha();
const BUILD_TS = new Date().toISOString();

// Port 18767 — slot allocated in the LogueOS 18xxx family alongside PM
// (18080), Miru AI (18765), and the MCP Gateway (18766). Bound to 0.0.0.0 so the
// operator's phone can reach it over Tailscale at room.taila28611.ts.net:18767
// without needing localhost forwarding. This is the dev-server config; LOS-4
// will replace `pnpm dev` with a built `node build/index.js` running under a
// scheduled-task watchdog like the other LogueOS services.
// Vite 5+ blocks unrecognized Host headers with HTTP 403 by default. For a
// dev server intended to be reached from any device on the operator's tailnet
// (room.taila28611.ts.net, plus iPhone / iPad / NAS / additional machines we
// might add), allowing every Host header is the pragmatic call. Production
// (LOS-4) will use adapter-node behind a real reverse proxy with proper host
// validation. This is the dev-mode shortcut.
export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	define: {
		__BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
		__BUILD_SHA__: JSON.stringify(BUILD_SHA),
		__BUILD_TS__: JSON.stringify(BUILD_TS)
	},
	server: {
		host: '0.0.0.0',
		port: 18767,
		strictPort: true,
		allowedHosts: true
	},
	preview: {
		host: '0.0.0.0',
		port: 18767,
		strictPort: true,
		allowedHosts: true
	}
});
