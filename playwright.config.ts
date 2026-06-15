// Playwright config — E2E browser tests against the SvelteKit dev server.
// Single browser (chromium) to keep local runs fast; CI can fan out later.
// The webServer block starts `npm run dev` on the dev port (18767, per
// vite.config.ts) and waits for /__health probe before running tests.
import { defineConfig, devices } from '@playwright/test';

const PORT = 18767;
const BASE_URL = `http://127.0.0.1:${PORT}`;
// Console mounts at /console/ via kit.paths.base — root returns 404. Probe
// the real mount point so reuseExistingServer works when the Console is
// already running; otherwise webServer tries to spawn its own and the port
// bind collides.
const HEALTH_URL = `${BASE_URL}/console/`;

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 30_000,
	expect: { timeout: 5_000 },
	// Sequential by default — easier debugging. Parallelize if suites grow.
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: BASE_URL,
		// Capture trace + screenshot only on failure — cheap when green,
		// rich when red.
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		},
		{
			// WebKit binary lives at ~/.cache/ms-playwright/webkit-2287 (installed 2026-06-01).
			// Desktop WebKit on Linux — catches engine-level issues; NOT iOS Mobile Safari.
			// For iOS-specific behavior (URL-bar resize, input-zoom), verify on the real
			// iPhone 16 Pro Max over Tailscale.
			name: 'iphone-webkit',
			use: { ...devices['iPhone 15 Pro Max'] }
		}
	],
	webServer: {
		// In CI, run against the production build (no HMR, no hydration race).
		// Local dev uses `vite dev` so HMR keeps working when iterating on tests.
		// The workflow runs `npm run build` BEFORE test:e2e so preview has output.
		command: process.env.CI ? 'npm run preview' : 'npm run dev',
		url: HEALTH_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
		stdout: 'pipe',
		stderr: 'pipe'
	}
});
