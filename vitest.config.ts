import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vitest is intentionally split from `vite.config.ts` because the
 * dev/build config loads the full PWA + latex.js shim pipeline, which
 * inflates every test run with irrelevant plugins and pulls
 * plugin-only dependencies (like `vite-plugin-pwa`) into the test
 * environment. This config only mirrors the `@` alias so tests can
 * import from `src/...` the same way the app does.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Skip the browser bits — none of the current tests need a DOM.
    // If a future test needs `document`, switch that file to
    // `// @vitest-environment jsdom` (or happy-dom) at the top.
  },
});
