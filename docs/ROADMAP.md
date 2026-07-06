# Doc Studio — Roadmap

Living roadmap. Items are ordered by ROI within each tier. Complexity:
**S** ≤ 1 day, **M** ~1 week, **L** ~2–4 weeks, **XL** > 1 month.

**Index**

1. [Now (in flight)](#1-now-in-flight)
2. [Next (short term)](#2-next-short-term)
3. [Later (medium term)](#3-later-medium-term)
4. [Speculative](#4-speculative)
5. [Explicit non-goals](#5-explicit-non-goals)
6. [Change history](#6-change-history)

---

## 1. Now (in flight)

| # | Item | Complexity | Motivating scenario |
|---|------|-----------|---------------------|
| N-1 | Full documentation set (HLD / LLD / TDD / DIAGRAMS / API / STORAGE / SECURITY / OPERATIONS / BUILD / CONTRIBUTING / GLOSSARY / ROADMAP / TESTING) | M | Onboarding cost |
| N-2 | Vitest coverage for pure helpers | S ongoing | Confidence during refactors |

---

## 2. Next (short term)

| # | Item | Complexity | Motivating scenario | Notes |
|---|------|-----------|---------------------|-------|
| 1 | Playwright browser-side smoke tests | S | Regression safety-net beyond unit tests | Cover load, hydrate, drop-to-open, export |
| 2 | Cross-tab store sync via `BroadcastChannel` | S | Two tabs on same `?ws=main` currently diverge | Reactive re-hydrate on channel message |
| 3 | DOMPurify layer in `HtmlPreview` | S | Hardening against hostile third-party HTML | Behind an opt-in prop; default off (keeps bundle lean) |
| 4 | Storage quota introspection + 90 % toast | S | Users hitting IndexedDB quota get cryptic errors | `navigator.storage.estimate()`; toast at 90 % |
| 5 | Bundle-visualizer artefact in CI | S | Catch regressions in chunk size | Attach `stats.html` per PR |
| 6 | Add `sanitizeLatexForEngine` snapshot tests | S | Regression protection for the sanitiser | Fixtures under `src/lib/latex/__tests__/` |
| 7 | Add `curlParser` tests for Postman + DevTools exports | S | High input variance, no coverage today | Randomised generative tests |
| 8 | Add `jsonXml` round-trip tests | S | Same | Property-based via `fast-check` |
| 9 | Port `scripts/test-xfa-extract.ts` to Vitest | S | Node-only script escapes CI test runs | Move to `src/lib/pdfXfaExtract.test.ts` |

---

## 3. Later (medium term)

| # | Item | Complexity | Motivating scenario | Notes |
|---|------|-----------|---------------------|-------|
| 10 | Extend `curlParser` for Python `requests` and Node `fetch` snippets | M | Same "paste-and-go" UX for two more toolchains | Same `ParsedCurl` shape |
| 11 | `.rtf` / `.odt` container support | M | Users hit "unsupported" when opening OpenOffice docs | New converters + archive kinds |
| 12 | EPUB chapter-by-chapter navigation | M | Currently one big rendered preview | Sidebar tree using `META-INF/container.xml` + `content.opf` |
| 13 | Table editor overlay for GFM tables | M | Editing large tables is painful in raw markdown | CodeMirror overlay decoration |
| 14 | Live collaboration cursor indicator (single doc, single origin) | M | Feels-alive polish for the two-tab use case | Uses BroadcastChannel from item 2 |
| 15 | Per-workspace theme override | M | Workspaces sometimes benefit from a distinct theme | Extend `settings` per-workspace with fall-through to global |
| 16 | Custom keybinding editor | M | Power users want vim / emacs-style bindings | Settings tab; persist via `settings` |
| 17 | Server-side rendering for the landing page | M | SEO on the marketing surface | Distinct from the app runtime; separate build |
| 18 | Optional `@capacitor/updates` for OTA web updates | M | Currently mobile users must reinstall for web changes | Adds a signing step |

---

## 4. Speculative

| # | Item | Complexity | Motivating scenario | Notes |
|---|------|-----------|---------------------|-------|
| 19 | Real TeX Live via WASM (opt-in) | XL | Full LaTeX fidelity for academic users | Ships as separate lazy chunk; 50 MB+ |
| 20 | End-to-end encrypted cloud sync | XL | Users wanting cross-device state | User-supplied key; libsodium; server never sees plaintext |
| 21 | Real-time collaboration via CRDT | XL | Multiple editors on one doc | Requires opt-in server (from item 20) |
| 22 | AI-assisted authoring (opt-in local model) | L | Modern feature parity | Local LLM (llama.cpp WASM); no network |
| 23 | Plugin API | L | Community extensions | Sandbox + capability model |
| 24 | Notebook-style code-execution cells | L | Blend of docs + REPL | Iframe sandbox or web worker; language runtimes lazy |
| 25 | Native filesystem workspace mounting | M (Tauri only) | Edit files in place on disk | Tauri `fs` API + capability grant |
| 26 | Diff view between two archive entries | M | Version comparison inside archives | Reuse CodeMirror's `@codemirror/merge` |
| 27 | Git-style workspace snapshots | L | Time-travel within a workspace | Content-addressable store inside IndexedDB |
| 28 | Multi-cursor for Mermaid live edit | M | Editing complex diagrams | Sidecar mini-editor |

---

## 5. Explicit non-goals

Cross-reference [HLD §14](HLD.md#14-boundaries-and-non-goals).

- Multi-user real-time collaboration by default. (Only if cloud sync
  ships opt-in, and even then off-by-default.)
- Cloud sync / accounts by default. Same reason.
- Full LaTeX rendering fidelity in the default bundle. (Would need
  50 MB WASM; opt-in via item 19.)
- Server-side rendering of the app itself. (Client-first; SSR adds
  infrastructure with no user-visible benefit.)
- Native plugins / extension model in the near term. (Adds a huge
  maintenance surface; not requested. See item 23 for the speculative
  form.)
- Persistent undo history across reloads. In-memory stack is enough
  for the session; persistence would balloon storage.
- Hosting user-submitted content by default. App is single-tenant per
  install; if this changes, add DOMPurify + strict CSP.

---

## 6. Change history

Snapshot of roadmap deltas by release. Update this section on every
release; superseded items get moved into "shipped" retrospectively.

| Release | Shipped | Added | Deferred |
|---------|---------|-------|----------|
| _(placeholder — fill in on first release)_ | | | |
