// Vitest setup — runs before every unit-test suite.
// Adds @testing-library/jest-dom matchers (toBeInTheDocument, etc.) and
// auto-cleans up Svelte component mounts between tests so DOM state
// doesn't leak across files.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

afterEach(() => {
	cleanup();
});
