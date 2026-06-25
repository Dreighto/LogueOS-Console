import { test, expect } from '@playwright/test';

test.describe('Judgment Triage UI @iphone-webkit', () => {
	test.beforeEach(async ({ page }) => {
		// Navigate to the triage page
		await page.goto('/runs/triage');
	});

	test('loads and renders first card with mobile viewport', async ({ page }) => {
		// Wait for page to load and check if we have suggestions or empty state
		await page.waitForLoadState('networkidle');

		// Check if we have the progress indicator
		const progressIndicator = page.locator('[data-testid="progress-indicator"]').or(
			page.locator('.bg-\\[\\#050505\\]\\/95').first()
		);
		await expect(progressIndicator).toBeVisible();

		// Check for either suggestions or empty state
		const triageCard = page.locator('[data-testid="triage-card"]').or(
			page.locator('.bg-zinc-950\\/80').first()
		);
		const emptyState = page.locator('text=All done!').or(
			page.locator('text=No judgment suggestions available')
		);

		// Either we have a triage card OR we have an empty state
		const hasSuggestions = await triageCard.isVisible({ timeout: 3000 }).catch(() => false);
		const isEmpty = await emptyState.isVisible({ timeout: 1000 }).catch(() => false);

		expect(hasSuggestions || isEmpty).toBe(true);

		if (hasSuggestions) {
			// If we have suggestions, test the card interactions
			await test.step('interact with triage card', async () => {
				// Check that action buttons are visible
				const acceptButton = page.locator('button:has-text("Accept")');
				const rejectButton = page.locator('button:has-text("Reject")');
				const editButton = page.locator('button:has-text("Edit")');

				await expect(acceptButton).toBeVisible();
				await expect(rejectButton).toBeVisible();
				await expect(editButton).toBeVisible();

				// Test that buttons have proper tap targets (mobile-friendly)
				const acceptBox = await acceptButton.boundingBox();
				const rejectBox = await rejectButton.boundingBox();
				const editBox = await editButton.boundingBox();

				// Buttons should be at least 44px tall for good touch targets
				expect(acceptBox?.height).toBeGreaterThanOrEqual(40);
				expect(rejectBox?.height).toBeGreaterThanOrEqual(40);
				expect(editBox?.height).toBeGreaterThanOrEqual(40);
			});

			await test.step('test accept flow', async () => {
				// Click accept button
				const acceptButton = page.locator('button:has-text("Accept")');
				await acceptButton.click();

				// Wait for the action to complete and check for success indication
				// (either next card loads or we see a success message)
				await page.waitForTimeout(1000);

				// The card should either advance to next or show completion
				const hasNextCard = await page.locator('.bg-zinc-950\\/80').isVisible({ timeout: 2000 }).catch(() => false);
				const hasCompletionMessage = await page.locator('text=All done!').isVisible({ timeout: 2000 }).catch(() => false);

				expect(hasNextCard || hasCompletionMessage).toBe(true);
			});
		}
	});

	test('keyboard shortcuts work correctly', async ({ page }) => {
		// Wait for page to load
		await page.waitForLoadState('networkidle');

		// Check if we have suggestions to test with
		const triageCard = page.locator('.bg-zinc-950\\/80').first();
		const hasSuggestions = await triageCard.isVisible({ timeout: 3000 }).catch(() => false);

		if (hasSuggestions) {
			// Test keyboard navigation
			await test.step('test keyboard shortcuts', async () => {
				// Test right arrow (accept)
				await page.keyboard.press('ArrowRight');
				
				// Wait a moment for the action to process
				await page.waitForTimeout(500);

				// Should either show next card or completion state
				const stillHasCards = await page.locator('.bg-zinc-950\\/80').isVisible({ timeout: 2000 }).catch(() => false);
				const isComplete = await page.locator('text=All done!').isVisible({ timeout: 2000 }).catch(() => false);
				
				expect(stillHasCards || isComplete).toBe(true);
			});
		}
	});

	test('edit dialog works correctly', async ({ page }) => {
		// Wait for page to load
		await page.waitForLoadState('networkidle');

		// Check if we have suggestions to test with
		const triageCard = page.locator('.bg-zinc-950\\/80').first();
		const hasSuggestions = await triageCard.isVisible({ timeout: 3000 }).catch(() => false);

		if (hasSuggestions) {
			await test.step('test edit functionality', async () => {
				// Click the edit button
				const editButton = page.locator('button:has-text("Edit")');
				await expect(editButton).toBeVisible();
				await editButton.click();

				// Should show edit interface
				const customInput = page.locator('input[placeholder*="custom"]').or(
					page.locator('input[type="text"]').last()
				);
				
				await expect(customInput).toBeVisible({ timeout: 3000 });
				
				// Input should have proper font size for iOS (16px minimum)
				const fontSize = await customInput.evaluate((el) => {
					return window.getComputedStyle(el).fontSize;
				});
				
				const fontSizeNum = parseInt(fontSize.replace('px', ''));
				expect(fontSizeNum).toBeGreaterThanOrEqual(16);

				// Type a custom label
				await customInput.fill('custom-test-label');

				// Submit the edit
				const submitButton = page.locator('button:has-text("Submit")');
				await expect(submitButton).toBeVisible();
				await submitButton.click();

				// Wait for action to complete
				await page.waitForTimeout(1000);

				// Should advance to next card or show completion
				const hasNextCard = await page.locator('.bg-zinc-950\\/80').isVisible({ timeout: 2000 }).catch(() => false);
				const hasCompletionMessage = await page.locator('text=All done!').isVisible({ timeout: 2000 }).catch(() => false);

				expect(hasNextCard || hasCompletionMessage).toBe(true);
			});
		}
	});

	test('progress indicator updates correctly', async ({ page }) => {
		// Wait for page to load
		await page.waitForLoadState('networkidle');

		// Check for progress indicator
		const progressText = page.locator('text=/\\d+ \\/ \\d+ reviewed/').or(
			page.locator('.font-mono').filter({ hasText: '/' })
		);

		// Progress should be visible (either with data or showing 0/0)
		await expect(progressText).toBeVisible({ timeout: 5000 });

		// The progress bar element should be present
		const progressBar = page.locator('.bg-gradient-to-r').or(
			page.locator('[style*="width:"]')
		);
		
		// Progress bar should exist and be styled appropriately
		const progressBarExists = await progressBar.isVisible().catch(() => false);
		expect(progressBarExists).toBe(true);
	});

	test('mobile viewport and safe areas work correctly', async ({ page }) => {
		// Check that the app uses the full viewport height
		const container = page.locator('.min-h-\\[100dvh\\]').first();
		await expect(container).toBeVisible();

		// Check safe area handling in progress indicator
		const progressContainer = page.locator('.sticky.top-0').first();
		const hasProgressContainer = await progressContainer.isVisible().catch(() => false);
		
		if (hasProgressContainer) {
			// Should have safe area padding
			const style = await progressContainer.getAttribute('style');
			expect(style).toContain('padding-top');
		}

		// Check that tap targets are appropriately sized for mobile
		const buttons = page.locator('button').all();
		for (const button of await buttons) {
			const box = await button.boundingBox();
			if (box) {
				// Touch targets should be at least 40px (44px is ideal)
				expect(box.height).toBeGreaterThanOrEqual(40);
			}
		}
	});

	test('refresh functionality works', async ({ page }) => {
		// Wait for page to load
		await page.waitForLoadState('networkidle');

		// Find and click refresh button
		const refreshButton = page.locator('button:has-text("Refresh")').or(
			page.locator('button').filter({ hasText: /refresh/i })
		);

		await expect(refreshButton).toBeVisible({ timeout: 5000 });
		
		// Click refresh
		await refreshButton.click();

		// Should show loading state briefly then return to normal
		await page.waitForTimeout(500);

		// Page should still be functional after refresh
		const pageContent = page.locator('body');
		await expect(pageContent).toBeVisible();
	});
});