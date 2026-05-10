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

  console.log('Navigating to https://room.taila28611.ts.net/console/ ...');
  await page.goto('https://room.taila28611.ts.net/console/', { waitUntil: 'networkidle' });
  
  console.log('Taking screenshot...');
  await page.screenshot({ path: 'los-7-iphone-verified.png' });
  
  expect(errors).toHaveLength(0);
});
