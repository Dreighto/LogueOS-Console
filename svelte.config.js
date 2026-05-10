import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// adapter-node produces a standalone Node.js server (build/index.js).
		// Launch with:
		//   POSIX:      PORT=18767 HOST=0.0.0.0 LOGUEOS_CONSOLE_BASE_PATH=/console node build/index.js
		//   PowerShell: $env:PORT='18767'; $env:HOST='0.0.0.0'; $env:LOGUEOS_CONSOLE_BASE_PATH='/console'; node build/index.js
		// In production this is wrapped by windows\start_logueos_console.ps1 which sets the env.
		adapter: adapter(),
		paths: {
			// Console is exposed via Tailscale Serve at
			//   https://<tailnet>/console  →  proxy http://localhost:18767  (strips /console)
			// (n8n owns the root path; can't move it without breaking the operator's
			// existing claude.ai connector setup at /mcp/...).
			//
			// Setting base='/console' so:
			//   - SvelteKit generates internal hrefs like /console/runs/abc
			//   - Vite generates /console/@fs/... module URLs in dev mode
			//   - Browser at https://<tailnet>/console/foo requests /console/foo
			//   - Tailscale strips → forwards /foo to localhost
			//   - Vite/SvelteKit (base=/console) sees /foo... wait, this is the dual-strip problem
			//
			// Actually SvelteKit dev server WITH base=/console listens at /console/* and
			// returns 404 on /. So when Tailscale strips and forwards /foo to localhost,
			// SvelteKit doesn't match. THIS DOESN'T WORK.
			//
			// Real fix: Vite has its own `base` config (separate from SvelteKit kit.paths.base).
			// Setting Vite base='/console' makes Vite generate /console-prefixed module URLs
			// for the BROWSER, but Vite's own server still listens at root. So:
			//   - Vite generates <script src="/console/@fs/..."> in HTML
			//   - Browser fetches /console/@fs/... from Tailscale
			//   - Tailscale strips → forwards /@fs/... to local Vite
			//   - Vite serves the file
			// THIS works. SvelteKit's kit.paths.base STILL needs to be '/console' so
			// internal hrefs (resolve('/runs/abc')) come out as /console/runs/abc.
			// The combination is: kit.paths.base for app links + vite.base for asset URLs.
			base: '/console'
		}
	}
};

export default config;
