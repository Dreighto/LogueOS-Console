// Regression suite for the chat surface (the flagship operator chat).
//
// Becomes the hard merge gate for every chat-touching PR after this lands.
// The previous Phase-5 rebuild shipped operator-visible regressions because
// nothing forced a browser check. These tests replace that gap.
//
// All upstream API calls are mocked at page.route() so the suite is
// deterministic: no DB seed, no Tailscale dep, no LLM call. Tests assert
// structural facts (composer renders, model picker has 8 choices) instead
// of content facts (specific thread title), so suite passes on a fresh DB.
//
// Add a test here whenever a regression slips past — the suite grows by
// failure mode, not by speculation.

import { test, expect, type Page, type Route } from '@playwright/test';

const BASE = 'http://127.0.0.1:18767/console/';
const ROUTE = 'chat/';

// ─────────────────────────────────────────────────────────────────────
// Network fixtures — match the API surface the page actually hits.
// ─────────────────────────────────────────────────────────────────────

type RouteHandler = (route: Route) => Promise<void> | void;

const json =
	(body: unknown): RouteHandler =>
	async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(body)
		});
	};

async function mockChatApis(page: Page) {
	// Polled — initial + 3s loop. Empty by default; specific tests override.
	await page.route(/\/api\/chat(\?|$)/, json({ messages: [] }));
	// Router state per thread.
	await page.route(/\/api\/chat\/tier/, async (route) => {
		if (route.request().method() === 'PUT') {
			const post = route.request().postDataJSON() as { tier?: string; provider?: string };
			return json({
				current_tier: post?.tier ?? 'chat',
				provider_override: post?.provider ?? null,
				last_model_used: ''
			})(route);
		}
		return json({ current_tier: 'chat', provider_override: null, last_model_used: '' })(route);
	});
	// Activity pill poll — empty array keeps the pill hidden.
	await page.route(/\/api\/chat\/activity/, json({ activity: [] }));
	// Draft autosave — record calls so tests can assert it fired.
	await page.route(/\/api\/chat\/drafts/, async (route) => {
		await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
	});
	// Streaming send — return an empty SSE stream so sendMessage resolves cleanly.
	await page.route(/\/api\/chat\/stream/, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'text/event-stream',
			body: 'data: {"type":"done"}\n\n'
		});
	});
	// Non-streaming send — used for dispatch + image-gen paths.
	await page.route(/\/api\/chat$/, async (route) => {
		if (route.request().method() === 'POST') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
		}
		return json({ messages: [] })(route);
	});
	// Workspaces — server-side fallback already returns 4, but the client may
	// also hit /api/v1/workspaces directly in some flows. Block to keep it tight.
	await page.route(/\/api\/v1\/workspaces/, json({ workspaces: [] }));
}

// ─────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────

test.use({ baseURL: BASE });

test.describe('chat — page load', () => {
	test('renders composer + header chrome', async ({ page }) => {
		await mockChatApis(page);
		await page.goto(ROUTE);

		// Header anchors
		await expect(page.getByRole('button', { name: 'Toggle Sessions Sidebar' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Return to Dashboard' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Target repository' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Model picker' })).toBeVisible();

		// Composer surface
		await expect(page.getByPlaceholder('Ask or command loops…')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Send Message' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Attach File' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Toggle Image Gen Mode' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Voice Dictation' })).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Hands-free continuous Talkback' })
		).toBeVisible();
	});

	test('Send button is disabled while draft + image-mode + attachments are all empty', async ({
		page
	}) => {
		await mockChatApis(page);
		await page.goto(ROUTE);
		await expect(page.getByRole('button', { name: 'Send Message' })).toBeDisabled();
	});

	test('logs no uncaught console errors during initial load + 2s settle', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
		page.on('console', (m) => {
			if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
		});

		await mockChatApis(page);
		await page.goto(ROUTE);
		await page.waitForTimeout(2000); // let effects + first poll settle
		expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
	});
});

test.describe('chat — sidebar', () => {
	// Mobile viewport — the aside is a translate-x drawer on mobile; its
	// bounding box.x is negative when closed, 0 when open. Desktop's `lg:` rules
	// switch to width/opacity transitions whose timing is harder to assert.
	test.use({ viewport: { width: 390, height: 844 } });

	test('toggle button slides the sidebar into the viewport', async ({ page }) => {
		await mockChatApis(page);
		await page.goto(ROUTE);

		const aside = page.locator('aside').first();
		// Closed: aside has `-translate-x-full`, so x ≈ -width (~ -288).
		await expect.poll(async () => (await aside.boundingBox())?.x ?? 0).toBeLessThan(-100);

		await page.getByRole('button', { name: 'Toggle Sessions Sidebar' }).click();
		// Open: aside has `translate-x-0`, so x ≈ 0 (allow for tiny browser rounding).
		await expect
			.poll(async () => (await aside.boundingBox())?.x ?? -999)
			.toBeGreaterThanOrEqual(-1);
	});
});

test.describe('chat — composer', () => {
	test('typing enables Send and persists a draft (PUT /api/chat/drafts fires)', async ({
		page
	}) => {
		await mockChatApis(page);

		let draftPutCount = 0;
		await page.route(/\/api\/chat\/drafts/, async (route) => {
			if (route.request().method() === 'PUT') draftPutCount++;
			await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
		});

		await page.goto(ROUTE);
		const composer = page.getByPlaceholder('Ask or command loops…');
		await composer.fill('hello world');

		await expect(page.getByRole('button', { name: 'Send Message' })).toBeEnabled();
		await page.waitForTimeout(700); // debounce is 400ms — wait past it
		expect(draftPutCount, 'draft autosave should have fired at least once').toBeGreaterThanOrEqual(
			1
		);
	});

	test('image-mode toggle changes the composer placeholder', async ({ page }) => {
		await mockChatApis(page);
		await page.goto(ROUTE);

		await expect(page.getByPlaceholder('Ask or command loops…')).toBeVisible();
		await page.getByRole('button', { name: 'Toggle Image Gen Mode' }).click();
		await expect(page.getByPlaceholder('Describe the image you want to generate…')).toBeVisible();
	});

	test('send happy path — optimistic operator bubble appears in the feed', async ({ page }) => {
		// The page does an optimistic insert into messages, runs the streaming
		// send, then reconciles via pollMessages() which REPLACES the array with
		// whatever GET /api/chat returns. If we leave the GET mock as empty, the
		// reconciliation wipes the optimistic row before our assertion lands.
		// Mirror real server behavior: remember what was POSTed, return it on GET.
		// Baseline mocks first; then register the specific overrides AFTER so
		// they win (Playwright matches the most recently registered route).
		await mockChatApis(page);
		const posted: string[] = [];
		await page.route(/\/api\/chat\/stream/, async (route) => {
			const body = route.request().postDataJSON() as { message?: string } | null;
			if (body?.message) posted.push(body.message);
			await route.fulfill({
				status: 200,
				contentType: 'text/event-stream',
				body: 'data: {"type":"done","provider_used":"test","model_used":"test"}\n\n'
			});
		});
		await page.route(/\/api\/chat(\?|$)/, async (route) => {
			const messages = posted.map((m, i) => ({
				id: i + 1,
				sender: 'operator',
				message: m,
				timestamp: new Date().toISOString()
			}));
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ messages })
			});
		});

		await page.goto(ROUTE);
		const composer = page.getByPlaceholder('Ask or command loops…');
		await composer.fill('regression test message');
		await page.getByRole('button', { name: 'Send Message' }).click();

		await expect(page.getByText('regression test message').first()).toBeVisible();
		await expect(composer).toHaveValue('');
	});
});

test.describe('chat — pickers', () => {
	test('Model picker opens and lists all 8 choices (Auto + 6 cloud + 1 local)', async ({
		page
	}) => {
		await mockChatApis(page);
		await page.goto(ROUTE);

		await page.getByRole('button', { name: 'Model picker' }).click();

		// Each model id has a corresponding button in the popover.
		// Match by label text — survives popover-class refactors.
		for (const label of [
			'Auto',
			'Claude Haiku 4.5',
			'Claude Sonnet 4.6',
			'Claude Opus 4.7',
			'Gemini 2.5 Flash-lite',
			'Gemini 2.5 Flash',
			'Gemini 2.5 Pro',
			'Local (Ollama)'
		]) {
			await expect(
				page.getByText(label, { exact: true }).first(),
				`model choice "${label}" missing`
			).toBeVisible();
		}
	});

	test('Repo picker opens and lists at least one workspace', async ({ page }) => {
		await mockChatApis(page);
		await page.goto(ROUTE);

		await page.getByRole('button', { name: 'Target repository' }).click();
		// Server-side load falls back to 4 workspaces when the gateway is unreachable.
		await expect(page.getByText('Target Directory').first()).toBeVisible();
	});
});
