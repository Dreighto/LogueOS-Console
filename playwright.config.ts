// Playwright config — E2E browser tests against the SvelteKit dev server.
// Single browser (chromium) to keep local runs fast; CI can fan out later.
// The webServer block starts `npm run dev` on the dev port (18767, per
// vite.config.ts) and waits for /__health probe before running tests.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PW_PORT ?? 18768);
const BASE_URL = `http://127.0.0.1:${PORT}`;
// Console mounts at /console/ via kit.paths.base — root returns 404. Probe
// the real mount point so reuseExistingServer works when the Console is
// already running; otherwise webServer tries to spawn its own and the port
// bind collides.
const HEALTH_URL = `${BASE_URL}/`;

// iphone-webkit is an OPT-IN local project — the WebKit browser is a local
// install (~/.cache/ms-playwright/webkit-2287, 2026-06-01) and is NOT present
// in CI, so running it by default fails every test on a missing browser. Enable
// it explicitly for local iOS spot-checks: `PW_IPHONE=1 npx playwright test`.
const INCLUDE_IPHONE = process.env.PW_IPHONE === '1';

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
		// Opt-in only (PW_IPHONE=1) — see INCLUDE_IPHONE above. Desktop WebKit on
		// Linux catches engine-level issues; it is NOT iOS Mobile Safari. For real
		// iOS behaviour (URL-bar resize, input-zoom), verify on the iPhone over
		// Tailscale. Uses the iPhone 15 Pro Max descriptor (latest Playwright ships).
		...(INCLUDE_IPHONE
			? [
					{
						name: 'iphone-webkit',
						use: { ...devices['iPhone 15 Pro Max'] }
					}
				]
			: [])
	],
	webServer: {
		// In CI, run against the production build (no HMR, no hydration race).
		// Local dev uses `vite dev` so HMR keeps working when iterating on tests.
		// The workflow runs `npm run build` BEFORE test:e2e so preview has output.
		command: process.env.CI
			? `LOGUEOS_CONSOLE_BASELESS=1 SVELTE_INSPECTOR_OPTIONS=false npm run preview -- --port ${PORT}`
			: `LOGUEOS_CONSOLE_BASELESS=1 SVELTE_INSPECTOR_OPTIONS=false npm run dev -- --port ${PORT}`,
		url: HEALTH_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
		stdout: 'pipe',
		stderr: 'pipe'
	}
});
