import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Port 18767 — slot allocated in the project-miru 18xxx family alongside PM
// (18080), Miru AI (18765), MCP Gateway (18766). Bound to 0.0.0.0 so the
// operator's phone can reach it over Tailscale at room.taila28611.ts.net:18767
// without needing localhost forwarding. This is the dev-server config; LOS-4
// will replace `pnpm dev` with a built `node build/index.js` running under a
// scheduled-task watchdog like the other Miru services.
export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		host: '0.0.0.0',
		port: 18767,
		strictPort: true
	},
	preview: {
		host: '0.0.0.0',
		port: 18767,
		strictPort: true
	}
});
