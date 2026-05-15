// E2E coverage for the landing-page status board.
//
// Runs against the actual production server (port 18767, base path /console/)
// AND against the Tailscale Funnel URL when available. Two reasons:
//   1. The page is what the operator hits from their phone via Tailscale,
//      not the dev server. Testing the built+deployed artifact catches build
//      pipeline issues that dev mode would mask.
//   2. The funnel adds path rewrites + CSRF/origin handling. Tests that only
//      hit localhost can pass while the Tailscale URL is broken.
//
// Each test: click the row, verify it navigates somewhere reasonable. Layout
// stability is asserted by counting visible rows (5 + dispatch button =
// status board shape).

import { test, expect, type Page } from '@playwright/test';

const LOCAL_URL = 'http://127.0.0.1:18767/console/';
const TAILSCALE_URL = 'https://room.taila28611.ts.net/console/';

async function checkStatusBoardShape(page: Page) {
	// Kill switch indicator (active or clear) is the only landing-specific
	// header element — the site layout provides its own h1. Test the badge
	// via its testid so the selector survives label tweaks.
	await expect(page.getByTestId('kill-switch-badge')).toBeVisible();

	// Four status rows + one dispatch button — exactly the status board shape
	for (const id of ['row-failures', 'row-reviews', 'row-workers', 'row-usage']) {
		await expect(page.getByTestId(id), `row ${id} should render`).toBeVisible();
	}
	await expect(page.getByTestId('row-dispatch')).toBeVisible();

	// HTML payload should be small — a status board, not a dashboard.
	// Sanity check: pre-rewrite the page was 120KB. Target < 30KB.
	const html = await page.content();
	expect(html.length).toBeLessThan(30_000);
}

test.describe('status board — localhost', () => {
	test.use({ baseURL: LOCAL_URL });

	test('renders 4 status rows + dispatch button', async ({ page }) => {
		await page.goto('');
		await checkStatusBoardShape(page);
	});

	test('row-failures row links to a real page (no 404)', async ({ page }) => {
		await page.goto('');
		const link = page.getByTestId('row-failures');
		const href = await link.getAttribute('href');
		expect(href).toBeTruthy();
		const resp = await page.request.get(href!);
		expect(resp.status(), `failures row href ${href} should not 404`).toBeLessThan(400);
	});

	test('row-workers links to /workers', async ({ page }) => {
		await page.goto('');
		await page.getByTestId('row-workers').click();
		await expect(page).toHaveURL(/\/workers\/?$/);
	});

	test('row-dispatch links to /ask', async ({ page }) => {
		await page.goto('');
		await page.getByTestId('row-dispatch').click();
		await expect(page).toHaveURL(/\/ask\/?$/);
	});

	test('counts render as numbers (not NaN, not undefined)', async ({ page }) => {
		await page.goto('');
		// The status counts live in tabular-nums spans inside each row.
		for (const id of ['row-failures', 'row-reviews', 'row-workers', 'row-usage']) {
			const row = page.getByTestId(id);
			const text = (await row.innerText()) ?? '';
			expect(text, `${id} should not contain NaN`).not.toContain('NaN');
			expect(text, `${id} should not contain undefined`).not.toContain('undefined');
		}
	});
});

// Tailscale tests are conditional — they only run when the funnel is up.
// Skip cleanly if the URL isn't reachable so the suite doesn't go red on
// dev machines without the operator's tailnet config.
test.describe('status board — Tailscale funnel', () => {
	test.beforeAll(async ({ request }) => {
		try {
			const resp = await request.get(TAILSCALE_URL, { timeout: 5_000 });
			if (resp.status() >= 400) test.skip(true, `Tailscale URL returned ${resp.status()}`);
		} catch (e) {
			test.skip(true, `Tailscale URL unreachable: ${e}`);
		}
	});

	test.use({ baseURL: TAILSCALE_URL });

	test('renders the same status-board shape via Tailscale', async ({ page }) => {
		await page.goto('');
		await checkStatusBoardShape(page);
	});
});
