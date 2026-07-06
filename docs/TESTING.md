# Doc Studio — Testing strategy

Everything about test tiers, current coverage, gaps, and the target
end state.

**Index**

1. [Test tiers](#1-test-tiers)
2. [Current unit tests (inventory)](#2-current-unit-tests-inventory)
3. [Coverage gaps and priorities](#3-coverage-gaps-and-priorities)
4. [Playwright plan](#4-playwright-plan)
5. [Manual QA scripts](#5-manual-qa-scripts)
6. [Fixture strategy](#6-fixture-strategy)
7. [Coverage aims by module](#7-coverage-aims-by-module)
8. [Fail-open vs fail-closed conventions](#8-fail-open-vs-fail-closed-conventions)
9. [Test data etiquette](#9-test-data-etiquette)
10. [Debugging failing tests](#10-debugging-failing-tests)

---

## 1. Test tiers

| Tier | Framework | Runtime | When it runs | Blocking? |
|------|-----------|---------|--------------|-----------|
| Unit — pure helpers | Vitest 4 | Node | `npm test`, `test:watch`, CI | Yes |
| Type check | `tsc --noEmit` | Node | `npm run build`, CI | Yes |
| Build verification | `vite build` | Node | `npm run build`, CI | Yes |
| Node-side sanity | `tsx scripts/*.ts` | Node | Manually / opt-in CI | No today |
| Browser smoke | Playwright | Chromium / WebKit / Firefox | Roadmap | Planned yes |
| Manual QA scripts | PowerShell | Windows shell | Manual | No |

---

## 2. Current unit tests (inventory)

Total: **35 tests** across 3 files, ~1 s to run.

### 2.1 [`src/lib/latex/latexStyleConfig.test.ts`](../src/lib/latex/latexStyleConfig.test.ts)

10 tests covering:

- `toCssVars` produces every expected variable name (`--font-size`,
  `--line-height`, `--page-padding`, …).
- `toCssBlock` output is a valid `:root { … }` block.
- Round-trip: `toCssBlock → parseCssBlock` yields the original
  config.
- All three presets (`Overleaf-Tight`, `Balanced`, `Roomy`) are
  round-trip-safe.
- `parseCssBlock` returns a warning entry for unknown vars.
- `parseCssBlock` returns partial config when only some vars are
  present.
- `loadFromStorage()` returns `null` on missing key.
- `loadFromStorage()` returns `null` on corrupted JSON (doesn't
  throw).
- `saveToStorage(cfg)` is idempotent.
- Numeric bounds respected (values outside `KNOB` ranges clamp).

### 2.2 [`src/lib/languageDetect.test.ts`](../src/lib/languageDetect.test.ts)

12 tests covering:

- JSON: object, array, primitive with whitespace.
- XML: with declaration, without, self-closing root.
- HTML: with `<html>`, without (fragment).
- Markdown: heading, list, plain text.
- LaTeX-inside-markdown: `\documentclass` detected as markdown so
  the LatexPreview path activates.
- Returns `null` for inputs < 20 chars.
- Ambiguous inputs (JSON-like number, quoted string) return `null`.
- `guessFileExtension`: markdown+LaTeX → `tex`, plain markdown →
  `md`, JSON → `json`, XML → `xml`, HTML → `html`.

### 2.3 [`src/lib/stats.test.ts`](../src/lib/stats.test.ts)

13 tests covering:

- `slugify('Hello World!')` → `'hello-world'`.
- `slugify` handles Unicode diacritics.
- `slugify` collapses multi-dash runs.
- `slugify` matches rehype-slug exactly (parity test).
- `computeStats` — word count on plain prose.
- `computeStats` — read time in minutes (rounded up).
- `computeStats` — heading count from markdown ATX.
- `extractToc` — markdown ATX headings with depth 1–6.
- `extractToc` — LaTeX `\section` / `\subsection` etc.
- `extractJsonOutline` — top-level keys of an object.
- `extractJsonOutline` — root array yields per-index outline.
- `extractXmlOutline` — nested elements, self-closing tags.
- `annotateOccurrence` — per-hint occurrence numbering.

---

## 3. Coverage gaps and priorities

### 3.1 High priority

| Target | Reason |
|--------|--------|
| `curlParser` | Highest input variance in the codebase; no coverage |
| `jsonXml` round-trip | Two-way converter with subtle escaping; property-based tests belong here |
| `pdfXfaExtract` | Already has `scripts/test-xfa-extract.ts` — port to Vitest so CI runs it |
| `proxyClient.arrayBufferToBase64` | Stack-safety guarantee needs a large-input test |
| `sanitizeLatexForEngine` | Real-world `.tex` fixtures; snapshot tests |
| `mimeExt.resolveResponseFormat` | Content-Disposition / URL / MIME priority ordering is fiddly |

### 3.2 Medium priority

| Target | Reason |
|--------|--------|
| `archive.unpackArchive` | Synthetic zips; verify size-cap behaviour |
| `mermaidAutoDetect.looksLikeMermaid` | Full directive matrix |
| `formatters.formatJson` / `formatXml` | Deterministic pretty-print |
| `useAppStore` action tests | Focus on `withFile`, `closeFilesHelper`, `migrateTexLanguage` |

### 3.3 Low priority

| Target | Reason |
|--------|--------|
| React components | Playwright is a better tool; skip unit tests |
| CodeMirror wiring | Effectively integration — cover via Playwright |

---

## 4. Playwright plan

Target for CI: 6–10 smoke scenarios in Chromium, WebKit, and Firefox.

Suggested initial suite:

1. Cold-load home page → renders scratch document.
2. Type text → preview updates within 250 ms.
3. Drop a `.md` file → opens in new tab.
4. Drop a `.docx` file → archive tree visible, rendered preview
   opened.
5. Import a cURL command → RequestEditor populated correctly.
6. Send request via proxy (needs a fixture server) → response viewer
   populated.
7. Export standalone HTML → downloaded file byte-equal to a snapshot.
8. Toggle theme → `<html>` class flips.
9. Open two `?ws=<id>` values → verify independent state.
10. Reload → hydrate restores active tab.

Runtime target: < 3 minutes on CI.

---

## 5. Manual QA scripts

Some scenarios are easier to trigger by shell than by browser
automation. Track them under `test-*.ps1` at repo root when they
exist. Suggested set:

- `test-startup.ps1` — build + start server + curl `/healthz` +
  `/__proxy` probe.
- `test-single-file.ps1` — build single-file and open it.
- `test-tauri-build.ps1` — build Tauri for the current OS.

Manual scripts do **not** substitute for Vitest / Playwright — they're
smoke-level.

---

## 6. Fixture strategy

- **Text fixtures** live next to their tests: `foo.test.ts` gets a
  sibling `foo.fixtures.ts` exporting constants.
- **Binary fixtures** (tiny synthetic zips, PDFs) live under
  `src/lib/__fixtures__/` and are checked in.
- **No downloaded fixtures at test time.** Tests must be
  deterministic and offline-safe.
- **Regenerating fixtures** — if a fixture becomes stale (e.g. new
  LaTeX package added), regenerate deterministically via a script,
  never by hand.

Fixture size discipline: keep any fixture under 30 KB. Larger inputs
belong in Playwright.

---

## 7. Coverage aims by module

Aim is not a global % — it's per-module intent. Aim column values:
**★** = every branch, **●** = happy path + top failure modes, **○** =
manual / integration only.

| Module | Aim | Rationale |
|--------|-----|-----------|
| `src/lib/*.ts` (helpers) | ★ | Pure, cheap, high leverage |
| `src/lib/converters/*.ts` | ● | Third-party libs handle much; test wiring + edge extractors |
| `src/lib/latex/*.ts` | ● | Sanitiser has known edge cases; style config has ★ |
| `src/store/useAppStore.ts` | ● | Actions are pure but many; cover mutation invariants |
| `vite-plugins/dev-proxy.ts` | ● | SSRF + size caps must be tested |
| `server/index.ts` | ○ | Boot smoke via manual script |
| `src/components/**` | ○ | Playwright |
| `scripts/*.ts` | ○ | Dev tooling |

---

## 8. Fail-open vs fail-closed conventions

- **Fail-closed** (throw): parse errors in `parseCurl`, `jsonXml`,
  `formatters.formatJson`, `formatters.formatXml` — the dialog turns
  the error into a user-visible message.
- **Fail-open** (return null/undefined, log a warning): storage
  reads (`loadFromStorage`, `loadWorkspace`, `loadSettings`) — a
  corrupted key must not brick the app; the store falls back to a
  fresh state.
- **Fail-safe** (return best-effort partial result): `sanitizeLatexForEngine`,
  `HtmlPreview.sanitize`, `mimeExt.resolveResponseFormat`.

Tests must exercise each of these three paths.

---

## 9. Test data etiquette

- **No real user data.** Never commit anonymised production dumps as
  fixtures — synthesise instead.
- **No secrets.** Fixtures must not contain real API keys, JWTs, or
  session cookies. Use `Bearer <token>` placeholders.
- **No fetches at test time.** Tests must be network-free — Vitest
  fails a test suite that calls `fetch()` without mock.

---

## 10. Debugging failing tests

- `npm run test:watch` — re-runs on change.
- `npm run test:ui` — Vitest browser dashboard for inspecting AST +
  console output.
- `it.only(...)` and `describe.only(...)` to focus.
- `console.log` in a test is fine; the runner shows it inline.
- If a test flakes on CI but passes locally, first suspect timers or
  the file's ordering assumptions (Vitest randomises file order —
  don't rely on cross-file state).
