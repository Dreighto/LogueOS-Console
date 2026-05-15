// Vitest config — unit tests for Svelte components + lib utils.
// E2E tests live separately under tests/e2e/ via Playwright.
import { svelteTesting } from '@testing-library/svelte/vite';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), svelteTesting()],
	test: {
		// Use jsdom so Svelte components can mount in a DOM-like env.
		environment: 'jsdom',
		// Auto-load jest-dom matchers + cleanup from tests/setup.ts before
		// each suite. Keeps individual test files focused on assertions.
		setupFiles: ['./tests/setup.ts'],
		// Include only the unit-test directory; Playwright manages tests/e2e.
		include: ['tests/unit/**/*.{test,spec}.{ts,js}', 'src/**/*.{test,spec}.{ts,js}'],
		// Globals so test files don't need to import describe/it/expect.
		globals: true,
		// Coverage is optional; pre-configure but don't require it on every run.
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.{ts,svelte}'],
			exclude: ['src/**/*.d.ts', 'src/**/*.test.{ts,js}', 'src/**/*.spec.{ts,js}']
		}
	}
});
