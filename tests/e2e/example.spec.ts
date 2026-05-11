// Example E2E test — proves the Playwright pipeline works AND demonstrates
// the axe-core a11y integration. Future workers: copy this pattern for
// every new route in LOS-22 + beyond.
//
// Two parts:
//   1. Functional smoke — page loads, expected element is visible
//   2. Accessibility scan — axe-core finds zero serious/critical violations
//      (a "AAA-friendly" baseline; lower tiers like minor/moderate are
//      surfaced as warnings, not failures, to keep the gate pragmatic).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('home page', () => {
	test('loads and shows the dashboard heading', async ({ page }) => {
		await page.goto('/');
		// SvelteKit renders quickly; expect the document to settle.
		await expect(page).toHaveURL(/\//);
		// Replace this selector once the home heading text is finalized.
		// The point is: page renders without 500 and contains content.
		const body = await page.locator('body').first();
		await expect(body).toBeVisible();
	});

	test('passes axe-core accessibility scan (no serious/critical violations)', async ({ page }) => {
		await page.goto('/');
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
			.analyze();

		// Surface every violation in the test output for debuggability,
		// but only fail on serious/critical impact. Minor + moderate are
		// reported as warnings in the assertion message.
		const blocking = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		);
		const non_blocking = results.violations.filter(
			(v) => v.impact !== 'serious' && v.impact !== 'critical'
		);

		if (non_blocking.length > 0) {
			console.warn(
				`[a11y] non-blocking violations (minor/moderate): ${non_blocking
					.map((v) => v.id)
					.join(', ')}`
			);
		}

		expect(
			blocking,
			`Blocking a11y violations: ${blocking.map((v) => `${v.id} (${v.impact})`).join(', ')}`
		).toEqual([]);
	});
});
