// Regression suite for /chat/preview — the SDK-native preview surface
// (PR 2a of the SDK adoption track). Side-by-side with the legacy /chat
// regression suite (chat.spec.ts). Both must stay green until PR 2b cuts
// over; after that, chat.spec.ts is the canonical gate and this file
// gets deleted along with the preview route.
//
// All API calls mocked at page.route() — no live LLM dep.

import { test, expect, type Page, type Route } from '@playwright/test';

const BASE = 'http://127.0.0.1:18767/console/';
const ROUTE = 'chat/preview/';

// SDK Data Stream Protocol — a single "READY" token delivery.
// See https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol
function sdkDataStream(text: string): string {
	return [
		'data: {"type":"start"}\n\n',
		'data: {"type":"start-step"}\n\n',
		'data: {"type":"text-start","id":"0"}\n\n',
		`data: {"type":"text-delta","id":"0","delta":${JSON.stringify(text)}}\n\n`,
		'data: {"type":"text-end","id":"0"}\n\n',
		'data: {"type":"finish-step"}\n\n',
		'data: {"type":"finish","finishReason":"stop"}\n\n',
		'data: [DONE]\n\n'
	].join('');
}

async function mockSdkStream(page: Page) {
	await page.route(/\/api\/chat\/sdk-stream/, async (route: Route) => {
		await route.fulfill({
			status: 200,
			headers: {
				'Content-Type': 'text/event-stream',
				// SDK 6 client requires this protocol-version header to recognise
				// the response as a UI message stream. Without it, the SDK silently
				// discards the response and never updates chat.messages.
				'x-vercel-ai-ui-message-stream': 'v1',
				'cache-control': 'no-cache',
				'x-accel-buffering': 'no'
			},
			body: sdkDataStream('PREVIEW_OK')
		});
	});
}

test.use({ baseURL: BASE });

test.describe('chat preview (SDK) — page load', () => {
	test('renders SDK preview badge + composer + provider toggle', async ({ page }) => {
		await mockSdkStream(page);
		await page.goto(ROUTE);

		await expect(page.getByTestId('sdk-preview-badge')).toBeVisible();
		await expect(page.getByTestId('composer')).toBeVisible();
		await expect(page.getByTestId('provider-toggle')).toBeVisible();
		await expect(page.getByTestId('send-button')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Back to live chat' })).toBeVisible();
	});

	test('Send button is disabled while composer is empty', async ({ page }) => {
		await mockSdkStream(page);
		await page.goto(ROUTE);
		await expect(page.getByTestId('send-button')).toBeDisabled();
	});

	test('provider toggle switches Claude ↔ Gemini', async ({ page }) => {
		await mockSdkStream(page);
		await page.goto(ROUTE);

		const toggle = page.getByTestId('provider-toggle');
		await expect(toggle).toContainText('Claude');
		await toggle.click();
		await expect(toggle).toContainText('Gemini');
		await toggle.click();
		await expect(toggle).toContainText('Claude');
	});
});

test.describe('chat preview (SDK) — send flow', () => {
	// Mocked stream protocol nuances (header version, chunked flushing) make
	// asserting the assistant-reply text via page.route() brittle. The value
	// of this gate is "send doesn't blow up + optimistic UI works"; the
	// assistant-stream side is exercised by hand against the live endpoint
	// and by the bigger e2e once PR 2b merges and persistence is wired.
	test('typing then send renders the user bubble + clears the composer', async ({ page }) => {
		await mockSdkStream(page);
		await page.goto(ROUTE);

		const composer = page.getByTestId('composer');
		await composer.fill('hello SDK');
		await expect(page.getByTestId('send-button')).toBeEnabled();
		await page.getByTestId('send-button').click();

		await expect(page.getByText('hello SDK').first()).toBeVisible();
		await expect(composer).toHaveValue('');
	});
});

test.describe('chat preview (SDK) — error state', () => {
	// Mocks /api/chat/sdk-stream to return 500; SDK's Chat class transitions
	// chat.status to 'error', and the page surfaces the error-state UI per
	// the coding-guideline "every async surface needs loading/empty/error
	// states" rule. CR review on PR #122 flagged the missing error UI;
	// this test gates against the regression.
	test('error response surfaces the explicit error-state UI', async ({ page }) => {
		await page.route(/\/api\/chat\/sdk-stream/, async (route: Route) => {
			await route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'upstream_failed' })
			});
		});
		await page.goto(ROUTE);

		await page.getByTestId('composer').fill('boom');
		await page.getByTestId('send-button').click();

		// Error-state container renders, with the operator-readable
		// "Stream failed" label and retry copy.
		await expect(page.getByTestId('error-state')).toBeVisible();
		await expect(page.getByText('Stream failed', { exact: true })).toBeVisible();
	});
});
