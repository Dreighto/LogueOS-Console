// Playwright config — E2E browser tests against the SvelteKit dev server.
// Single browser (chromium) to keep local runs fast; CI can fan out later.
// The webServer block starts `npm run dev` on the dev port (18767, per
// vite.config.ts) and waits for /__health probe before running tests.
import { defineConfig, devices } from '@playwright/test';

const PORT = 18767;
const BASE_URL = `http://127.0.0.1:${PORT}`;

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
		}
	],
	webServer: {
		command: 'npm run dev',
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
		stdout: 'pipe',
		stderr: 'pipe'
	}
});
