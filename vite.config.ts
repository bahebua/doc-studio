import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { devProxyPlugin } from './vite-plugins/dev-proxy';

/**
 * latex.js contains dynamic `require("./documentclasses/" + name)` and
 * `require("./packages/" + name)` calls. Vite's dep scanner (esbuild)
 * resolves those as glob imports and pulls in every file under those
 * folders, including the empty `.keep` marker files — which esbuild
 * refuses to load because no loader is registered for that extension.
 *
 * `optimizeDeps.esbuildOptions.loader` only applies to the pre-bundle
 * pass, not the scanner. This plugin short-circuits `.keep` files at
 * resolve/load time everywhere so both passes succeed.
 */
const stubKeepFilesPlugin = (): Plugin => ({
  name: 'stub-keep-files',
  enforce: 'pre',
  resolveId(source) {
    if (source.endsWith('.keep')) return `\0stub-keep:${source}`;
  },
  load(id) {
    if (id.startsWith('\0stub-keep:')) return 'export default {};';
  },
});

export default defineConfig({
  resolve: {
    alias: [
      // Standard app alias.
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // latex.js ships CSS under `dist/css/` but its package.json `exports`
      // field only exposes the JS entry, so a bare `latex.js/dist/css/*`
      // import cannot be resolved. Route those imports directly at the
      // filesystem so Vite can pick the CSS up like any other stylesheet.
      {
        find: /^latex\.js\/dist\/css\/(.+)$/,
        replacement: fileURLToPath(new URL('./node_modules/latex.js/dist/css/$1', import.meta.url)),
      },
    ],
  },
  plugins: [
    react(),
    devProxyPlugin(),
    stubKeepFilesPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'robots.txt'],
      manifest: {
        name: 'Doc Studio',
        short_name: 'Doc Studio',
        description:
          'A modern editor & API scratchpad for Markdown, HTML, JSON, XML, XFA/XDP, and cURL requests — with PDF export and a built-in Postman-style runner.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        lang: 'en',
        categories: ['productivity', 'developer', 'utilities'],
        icons: [
          // Raster PNG icons — mandatory for iOS Safari's Add-to-Home
          // Screen and for most Android launchers. Generated from the
          // source SVGs by `scripts/gen-icons.ts` (run pre-build).
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-192-maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          // SVG icons kept as `any` for browsers that prefer vector.
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          {
            src: 'icons/icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
    // Raise from the default 500 KB — mermaid, latex.js, pdf, and
    // cytoscape are all far heavier than that and *already* lazy-loaded
    // via `React.lazy` / dynamic `import()`. The warning is noise for
    // chunks users only download when they open the corresponding
    // feature. 900 KB still catches genuinely accidental blowups.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          markdown: ['react-markdown', 'remark-gfm', 'rehype-highlight', 'rehype-raw', 'rehype-slug', 'remark-emoji'],
          converters: ['turndown', 'turndown-plugin-gfm', 'jszip'],
          codemirror: [
            'codemirror',
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/commands',
            '@codemirror/search',
            '@codemirror/language',
            '@codemirror/theme-one-dark',
          ],
          'codemirror-langs': [
            '@codemirror/lang-markdown',
            '@codemirror/lang-json',
            '@codemirror/lang-xml',
            '@codemirror/lang-html',
          ],
          pdf: ['jspdf', 'html2canvas'],
          mermaid: ['mermaid'],
        },
      },
    },
  },
  optimizeDeps: {
    entries: ['index.html'],
    // See `stubKeepFilesPlugin` above for the full explanation. That
    // Rollup-side plugin handles Vite's dev transform pipeline. The
    // dep pre-bundler is a *separate* esbuild instance that does not
    // see Vite/Rollup plugins, so we register an esbuild-native plugin
    // + loader here to cover it too.
    esbuildOptions: {
      loader: { '.keep': 'empty' },
      plugins: [
        {
          name: 'stub-keep-files',
          setup(build) {
            build.onResolve({ filter: /\.keep$/ }, (args) => ({
              path: args.path,
              namespace: 'stub-keep',
            }));
            build.onLoad({ filter: /.*/, namespace: 'stub-keep' }, () => ({
              contents: '',
              loader: 'js',
            }));
          },
        },
      ],
    },
  },
});
