// Playwright config for testing against the LIVE production server
// (already running on port 18767 via the LogueOS-Console scheduled task).
// No webServer block — we reuse the running adapter-node build, NOT vite dev.
//
// Use: `npx playwright test --config playwright-prod.config.ts <spec>`
//
// Why a separate config: the default playwright.config.ts probes
// http://127.0.0.1:18767/ which 404s (the app lives at /console/), so
// Playwright thinks no server is running and tries to start vite dev,
// which fails because the port is already taken.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 30_000,
	expect: { timeout: 5_000 },
	fullyParallel: false,
	retries: 0,
	reporter: 'list',
	use: {
		baseURL: 'http://127.0.0.1:18767/console/',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
	// no webServer — operator's LogueOS-RestartConsole task owns lifecycle
});
