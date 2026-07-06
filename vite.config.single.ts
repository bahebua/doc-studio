/**
 * Alternative Vite config that produces ONE self-contained `index.html` in
 * `dist-single/` — no separate JS/CSS chunks, no service worker, no asset
 * folders. Everything is inlined so you can email/AirDrop/drop the file in
 * a phone's Files app and open it in any browser that permits `file://`
 * scripting.
 *
 * Trade-offs vs the normal PWA build:
 *   - No service worker (SWs need http/https; file:// is a hard block).
 *   - No "Add to Home Screen" install prompt.
 *   - Larger initial download (~1.5 MB) — normally split across chunks.
 *   - iOS Safari refuses to run scripts from Files.app in iOS 15+;
 *     Android Chrome / Firefox handle local HTML fine.
 *
 * Usage: `npm run build:single` — output at `dist-single/index.html`.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'es2020',
    sourcemap: false,
    outDir: 'dist-single',
    // vite-plugin-singlefile inlines assets — bump the warning limits so it
    // doesn't complain about the (expected) large single bundle.
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false,
    rollupOptions: {
      // Force everything into one chunk — dynamic imports become inlined.
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
