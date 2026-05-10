import adapter from '@sveltejs/adapter-auto';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
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
