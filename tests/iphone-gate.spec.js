import { test, expect } from '@playwright/test';

test.use({
  viewport: { width: 440, height: 956 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
});

test('iPhone gate verification', async ({ page }) => {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  console.log('Navigating to /console/ ...');
  await page.goto('/console/', { waitUntil: 'networkidle' });

  console.log('Taking screenshot...');
  await page.screenshot({ path: 'los-7-iphone-verified.png' });

  // LOS-7 acceptance criteria: verify em-dash timestamp fallback and worker badges
  const timestampElements = await page.locator('span:has-text("—")').all();
  expect(timestampElements.length).toBeGreaterThan(0);

  const workerBadges = await page.locator('span:has-text("claude-code"), span:has-text("gemini"), span:has-text("cursor"), span:has-text("operator"), span:has-text("unknown")').all();
  expect(workerBadges.length).toBeGreaterThan(0);

  expect(errors).toHaveLength(0);
});
