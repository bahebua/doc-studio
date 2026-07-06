# Doc Studio — Build system deep dive

Complete reference for the build, bundling, chunking, PWA, single-file,
icon, and native shell pipelines.

**Index**

1. [Build tool matrix](#1-build-tool-matrix)
2. [Vite plugin order](#2-vite-plugin-order)
3. [Path aliases](#3-path-aliases)
4. [Manual chunk strategy](#4-manual-chunk-strategy)
5. [PWA + Workbox](#5-pwa--workbox)
6. [Single-file build](#6-single-file-build)
7. [Icon rasterisation](#7-icon-rasterisation)
8. [`latex.js` postinstall patch](#8-latexjs-postinstall-patch)
9. [Tauri build](#9-tauri-build)
10. [Capacitor build](#10-capacitor-build)
11. [Docker build](#11-docker-build)
12. [Vitest build](#12-vitest-build)
13. [TypeScript config](#13-typescript-config)
14. [PostCSS + Tailwind](#14-postcss--tailwind)
15. [Bundle inspection](#15-bundle-inspection)
16. [Reproducibility](#16-reproducibility)

---

## 1. Build tool matrix

| Tool | Version | Purpose |
|------|---------|---------|
| Vite | 5.4 | Bundler + dev server |
| Rollup | (via Vite) | Production bundling |
| esbuild | (via Vite) | Dev + dep pre-bundle |
| PostCSS | 8 | CSS pipeline |
| Tailwind | 3.4 | Utility CSS + JIT |
| TypeScript | 5.6 | Static type check (build gate) |
| Vitest | 4 | Test runner (separate config) |
| Workbox | (via vite-plugin-pwa) | Service worker generation |
| vite-plugin-singlefile | 2 | Single-file bundle |
| @resvg/resvg-js | latest | SVG → PNG icon rasterisation |
| Tauri CLI | 2 | Desktop shell build |
| Capacitor CLI | 6 | Mobile shell build |

---

## 2. Vite plugin order

Plugin order matters — a resolver early in the chain shadows later
ones.

```mermaid
flowchart LR
  input[source] --> alias[@ alias]
  alias --> stub[stubKeepFilesPlugin<br/>enforceStart · resolveId + load]
  stub --> css[latex.js CSS regex alias]
  css --> react[@vitejs/plugin-react]
  react --> post[postcss · tailwind]
  post --> rollup[Rollup manualChunks]
  rollup --> pwa[vite-plugin-pwa]
  pwa --> out[dist/]
```

**Why `stubKeepFilesPlugin` is `enforceStart`.** latex.js's dynamic
`require('./documentclasses/…')` gets expanded by Vite's esbuild
pre-bundle into a glob import that includes the two `.keep` marker
files. `enforceStart` ensures our stub resolves `.keep` before
esbuild tries to load it. Combined with the belt-and-braces
[patch-latexjs.mjs](../scripts/patch-latexjs.mjs) postinstall, both
layers keep working even if one bug regresses.

**Why the CSS regex alias.** latex.js ships its stylesheets under
`dist/css/*` — a non-standard subpath that Vite's default resolver
doesn't traverse. A regex alias forces the resolution to the on-disk
path.

---

## 3. Path aliases

Single source of truth: `tsconfig.json` `paths`. Vite mirrors it in
`resolve.alias`; Vitest mirrors it again in `vitest.config.ts`.

```jsonc
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  }
}
```

Never introduce aliases in Vite that aren't also in tsconfig — the
IDE would light up with red squiggles.

---

## 4. Manual chunk strategy

The intent behind manual chunking is to make PWA precache stable and
lazy chunks predictable, without duplication.

| Chunk | Members | Gzipped | Load |
|-------|---------|---------|------|
| `react-vendor` | react, react-dom | ~45 KB | Eager |
| `markdown` | react-markdown, remark-*, rehype-* (except katex) | ~200 KB | Eager |
| `converters` | mammoth (UMD script split), turndown | Lazy (~1.1 MB total for mammoth) | Lazy |
| `codemirror` | @codemirror/state/view/commands/search/language | ~90 KB | Eager |
| `codemirror-langs` | @codemirror/lang-* | Split per language | Lazy per language |
| `pdf` | jspdf, html2canvas | ~180 KB | Lazy |
| `mermaid` | mermaid | ~667 KB | Lazy |
| `latex.js` | (implicit — dynamic import) | ~576 KB | Lazy |
| `katex` | katex core + fonts | Auto-split | Auto |

**Explicit non-chunk for katex.** A previous experiment produced two
copies of katex in the bundle (once via rehype-katex, once via
explicit chunk). Reverting the manual chunk let Rollup auto-split
cleanly.

`chunkSizeWarningLimit: 900` in `vite.config.ts` — any single chunk
crossing 900 KB warns. Heavy chunks are lazy so they don't count
against interactive time.

---

## 5. PWA + Workbox

Configured via `vite-plugin-pwa`. Highlights:

| Option | Value |
|--------|-------|
| `registerType` | `'autoUpdate'` — new SW takes over on next reload |
| `manifest.name` | `'Doc Studio'` |
| `manifest.theme_color` | Matches Tailwind `brand-600` |
| `manifest.icons` | 192 / 512 / maskable / apple-touch |
| Workbox precache | Shell + fonts + katex fonts |
| Workbox runtime cache | External images `NetworkFirst` |

Service worker lifecycle covered in
[DIAGRAMS §18.3](DIAGRAMS.md#183-pwa-lifecycle).

---

## 6. Single-file build

`vite.config.single.ts` overrides:

| Option | Value | Reason |
|--------|-------|--------|
| `viteSingleFile()` plugin | on | Inlines all JS/CSS/assets into `index.html` |
| `cssCodeSplit` | `false` | Prevents separate `<link rel="stylesheet">` |
| `assetsInlineLimit` | `100_000_000` | Inline every asset |
| `chunkSizeWarningLimit` | `100_000_000` | Silence warnings |
| `reportCompressedSize` | `false` | Speeds up build |
| `inlineDynamicImports` | `true` | Collapse lazy chunks into the sync main bundle |
| `outDir` | `'dist-single'` | Don't clobber the PWA build |
| PWA plugin | **disabled** | Service workers can't register from `file://` |

Result: one `dist-single/index.html`, ~7–9 MB, self-contained.

Constraints of the single-file channel:

- No lazy chunks → first paint slower.
- No service worker → no offline caching beyond browser HTTP cache.
- iOS Safari has a per-file execution limit — very large scripts may
  fail to eval; work around by trimming the LaTeX / Mermaid dependency
  if you know you don't need them.

---

## 7. Icon rasterisation

Runs via `npm run prebuild:icons`
([scripts/gen-icons.ts](../scripts/gen-icons.ts)):

| Source SVG | Output PNG | Size |
|------------|-----------|------|
| `public/icons/icon.svg` | `icon-192.png` | 192×192 |
| `public/icons/icon.svg` | `icon-512.png` | 512×512 |
| `public/icons/icon-maskable.svg` | `icon-192-maskable.png` | 192×192 |
| `public/icons/icon-maskable.svg` | `icon-512-maskable.png` | 512×512 |
| `public/icons/icon.svg` | `apple-touch-icon.png` | 180×180 |
| `public/icons/icon.svg` | `favicon-32.png` | 32×32 |
| `public/icons/icon.svg` | `favicon-16.png` | 16×16 |

`gen-icons.ts` uses `@resvg/resvg-js` (native, deterministic
rasterisation — unlike `sharp` which requires a native build). Icons
land in `public/icons/`; Vite copies them into `dist/`.

---

## 8. `latex.js` postinstall patch

Runs via `postinstall` script → [scripts/patch-latexjs.mjs](../scripts/patch-latexjs.mjs).

**Problem.** `latex.js@0.12.6` ships two placeholder `.keep` files:
- `node_modules/latex.js/dist/documentclasses/.keep`
- `node_modules/latex.js/dist/packages/.keep`

Vite's esbuild pre-bundler expands the dynamic `require()` in
latex.js into a glob import that matches those `.keep` files. No
loader is registered for `.keep`, so the pre-bundle fails.

**Fix.** Delete the two files on `postinstall`. Idempotent — survives
`npm ci` / `npm install`. The runtime dynamic requires now return
`undefined` for the missing entries and latex.js's own try/catch
fallback handles it.

The `stubKeepFilesPlugin` in `vite.config.ts` covers the same case
at the Vite layer as belt-and-braces.

---

## 9. Tauri build

Prerequisites: Rust toolchain, platform-specific dependencies (see
Tauri docs).

```powershell
npm run build
npm run tauri:build
```

Produces per-target installers:

| OS | Targets |
|----|---------|
| Windows | `.msi`, `.exe` (NSIS) |
| macOS | `.dmg`, `.app` |
| Linux | `.deb`, `.AppImage` |

Configuration in [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json).
Icons for the installer under `src-tauri/icons/` — separate from
the web PWA icons.

Capabilities file in `src-tauri/capabilities/` gates the Rust APIs
the WebView can call — least-privilege from day one.

---

## 10. Capacitor build

```powershell
npm run build
npx cap sync            # copy dist/ into android/ and ios/
npx cap open android    # launches Android Studio
npx cap open ios        # launches Xcode
```

Native project directories (`android/`, `ios/`) are `.gitignore`d;
generated on demand.

For CI:

- `android.yml` runs Gradle build headlessly.
- `ios.yml` requires a macOS runner + Xcode + a signing profile.

Bundle-id / version bumps happen in native config
(`android/app/build.gradle`, `ios/App/App.xcodeproj/project.pbxproj`).

---

## 11. Docker build

Two-stage; see [Dockerfile](../Dockerfile).

**Stage 1 — builder**
```
FROM node:20-bookworm-slim AS builder
npm ci --no-audit --no-fund
COPY . .
npm run build
```

**Stage 2 — runner**
```
FROM node:20-bookworm-slim
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/vite-plugins ./vite-plugins
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "--loader", "ts-node/esm", "server/index.ts"]
```

Compose:
```powershell
docker compose up -d --build
```

Health check hits `/healthz` inside the container.

---

## 12. Vitest build

Vitest has its own config, separate from `vite.config.ts` (see
[TDD §7 ADR-014](TDD.md#7-architectural-decisions-adrs)):

```ts
// vitest.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
```

**Why separate.** `vite-plugin-pwa` writes files to `dist/` during
Vite's config phase — undesirable in tests. `stubKeepFilesPlugin` and
the latex.js CSS alias aren't needed for unit tests either.

Run:
```powershell
npm test                 # one-shot (CI)
npm run test:watch       # interactive
npm run test:ui          # Vitest dashboard in browser
```

---

## 13. TypeScript config

Two configs:

- `tsconfig.json` — main app + tests. `strict: true`,
  `moduleResolution: 'bundler'`, `noEmit: true` (Vite handles emit;
  tsc is used as a **build gate** only).
- `tsconfig.node.json` — for `vite.config.ts` and `scripts/`, extends
  the main config with `module: 'ESNext'`, `target: 'ES2022'`, and
  `allowSyntheticDefaultImports`.

`npm run build` runs `tsc --noEmit` first — any type error blocks
the Vite build.

---

## 14. PostCSS + Tailwind

`postcss.config.js`:
```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

`tailwind.config.js` highlights:

- `content: ['./index.html', './src/**/*.{ts,tsx}']` — JIT scans
  these paths only.
- `darkMode: 'class'` — toggled by `useTheme` writing `dark` on
  `<html>`.
- `theme.extend.colors.brand` — 50→900 palette; `night-soft` and
  `night-muted` for dark backgrounds.
- `theme.extend.boxShadow.soft` — the ubiquitous soft shadow used
  across buttons and panels.
- Plugin: `@tailwindcss/typography` — used by `MarkdownPreview` and
  the preview root's `.prose` classes.

---

## 15. Bundle inspection

```powershell
npx vite-bundle-visualizer
```

Produces a treemap at `stats.html`. Useful after a dep upgrade:

- Duplicate copies → check `manualChunks` or dep versions.
- Unexpected chunk-size growth → investigate the top contributors.
- Small helpers dragging in huge deps → refactor to isolate the
  import at a lazy-loaded boundary.

Sanity budget (see [TDD §8](TDD.md#8-performance-budgets)):

| Chunk | Target gzipped size |
|-------|---------------------|
| App shell (react + Layout + UI) | ≤ 120 KB |
| Markdown pipeline | ≤ 220 KB |
| Any single CodeMirror language | ≤ 50 KB |
| PDF chunk | ≤ 200 KB |
| Mermaid chunk | ≤ 700 KB |
| latex.js chunk | ≤ 600 KB |

---

## 16. Reproducibility

- Lockfile: `package-lock.json` committed.
- CI uses `npm ci` (deterministic install).
- `npm audit fix --force` never runs in CI — deps changes go through
  PR review.
- `node_modules` deleted between builds in Docker.
- Icons regenerated from SVG source on every build → deterministic
  PNGs (resvg is bit-exact).
- Build output timestamps stripped by Vite (`build.rollupOptions.output.assetFileNames`
  is content-hashed).
