# Doc Studio — Contributing guide

Setup, conventions, review expectations, and the shape of a good PR.

**Index**

1. [Setup](#1-setup)
2. [Working with PowerShell on Windows](#2-working-with-powershell-on-windows)
3. [Development loop](#3-development-loop)
4. [Coding conventions](#4-coding-conventions)
5. [Testing conventions](#5-testing-conventions)
6. [PR checklist](#6-pr-checklist)
7. [Change recipes](#7-change-recipes)
8. [Documentation policy](#8-documentation-policy)
9. [Review focus by directory](#9-review-focus-by-directory)
10. [Release cadence](#10-release-cadence)

---

## 1. Setup

Prereqs:

- Node 20 LTS.
- Rust toolchain (only for Tauri).
- Android Studio (only for Capacitor Android).
- Xcode + macOS (only for Capacitor iOS).

Clone + install:

```powershell
git clone https://github.com/<org>/MdToHtmlPdfConverter.git
cd MdToHtmlPdfConverter
npm ci
```

That's it — the `postinstall` script fixes latex.js's `.keep` files
automatically ([BUILD §8](BUILD.md#8-latexjs-postinstall-patch)).

---

## 2. Working with PowerShell on Windows

Recurring quirks and workarounds:

| Symptom | Fix |
|---------|-----|
| `npm.ps1 cannot be loaded because running scripts is disabled` | Use `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run <script>` |
| Terminal stuck at `>>` continuation prompt | Press `Ctrl+C` twice, or `Import-Module Microsoft.PowerShell.Management -Force` |
| `CommandNotFoundException` on basic cmdlets | Same — reload the management module |
| `Tee-Object` writes UTF-16LE by default | Read back with `Get-Content -Encoding Unicode` |
| Path with spaces breaks a command | Quote the whole path: `"C:\Path With Space\file.ts"` |

---

## 3. Development loop

```powershell
npm run dev            # Vite dev server on :5173 (with /__proxy mounted)
npm test               # Vitest one-shot
npm run test:watch     # Vitest interactive
npm run build          # Type check + production build
npm run build:single   # Single-file HTML bundle
npm run preview        # Serve dist/ locally
npm run server         # Serve dist/ + /__proxy in production mode
```

**Fast feedback loop for changes.** Run `npm run dev` in one terminal,
`npm run test:watch` in another. Type check comes for free via VS
Code — no need to run `tsc` manually.

---

## 4. Coding conventions

- **TypeScript strict.** No `any` unless annotated with a comment
  explaining why.
- **Functional React.** No class components. `forwardRef` + `memo`
  where genuinely useful, not everywhere.
- **Named exports** for shared modules; **default exports** only for
  React.lazy targets (currently `LatexPreview`).
- **JSDoc on exported functions in `src/lib/`** — the LLD depends on
  it. Purpose in one paragraph, quirks called out.
- **State mutations only through zustand actions.** No component
  mutates `useAppStore.getState()` directly.
- **No `console.log` in committed code.** Console usage inside
  `src/lib/` and store is fine but must be tagged: `console.warn('[latex] …')`.
- **CSS lives in Tailwind.** Free-standing CSS files only for
  third-party stylesheets and the latex.js style imports.
- **Import order** — external → aliased → relative.
- **File naming** — kebab-case is legal but the codebase uses
  camelCase for `.ts` helpers and PascalCase for `.tsx` components.
  Follow the convention of the surrounding directory.
- **Never invert layer boundaries.** `src/lib/*` never imports from
  `src/store/*` or `src/components/*`. See
  [HLD §6](HLD.md#6-architectural-layers).

### 4.1 Immutability discipline

`useAppStore` mutations follow one pattern:

```ts
setContent: (content) => {
  const state = get();
  const patch = withFile(state.workspace, state.activeId, { content });
  if (!patch) return;
  set({ workspace: patch.workspace, document: patch.document });
  scheduleWorkspaceSave(() => get().workspace);
}
```

- `withFile` returns a new workspace object.
- `set` publishes it — subscribers see one atomic transition.
- `scheduleWorkspaceSave` debounces the IO.

Never `Array.prototype.push` on a state array. Never mutate a nested
object in place.

### 4.2 Language routing

Widening `Language`, `ArchiveKind`, `Theme`, or any union type is a
breaking refactor: grep for every dispatch site first. Adding a new
value must touch:

- `src/types/index.ts` — union definition.
- Every `switch (lang)` / `Record<Language, X>` — get the compiler to
  list them.
- Detector + guesser in `src/lib/languageDetect.ts`.
- Archive mapping in `src/lib/archive.ts`.
- Editor language extension in `src/components/Editor/CodeEditor.tsx`.
- Badge in `EditorTabs.tsx` and `ActiveFiles.tsx`.
- Outline extractor in `src/lib/stats.ts` (if the language has
  structural navigation).

See [LLD §23.1](LLD.md#231-add-a-new-editor-language).

---

## 5. Testing conventions

- Test every pure helper in `src/lib/`. Colocate as `*.test.ts` next
  to the source.
- Prefer characterisation tests (input → expected output) over
  mock-heavy tests.
- For CSS-var round-trips or JSON serialisation, use
  round-trip snapshots (`toCssBlock` → `parseCssBlock` → equal).
- React component tests are optional today; Playwright browser tests
  are on the roadmap and preferred over unit-testing React.
- The test process must complete in under 3 s (currently ~1 s at 35
  tests).

Run:

```powershell
npm test
```

Add a test file → `npm test` picks it up automatically (glob
`src/**/*.{test,spec}.{ts,tsx}`).

---

## 6. PR checklist

Copy into the PR description:

```markdown
- [ ] `npm test` passes locally
- [ ] `npm run build` completes without warnings > 900 KB per chunk
- [ ] TypeScript is 0 errors (`tsc --noEmit`)
- [ ] New public helpers in `src/lib/` have JSDoc
- [ ] New public helpers have a Vitest
- [ ] Persisted-shape changes include a migration in `useAppStore.migrateXxx`
- [ ] External HTTP call goes through `proxyClient.fetchViaProxyOrDirect`
- [ ] UI-only chrome inside a preview has `data-ui-only`
- [ ] Docs updated:
  - [ ] HLD if a layer boundary shifts or an ADR is added
  - [ ] LLD if a file is added / removed / substantially rewritten
  - [ ] TDD if a new scenario or performance target changes
  - [ ] API if the proxy contract changes
  - [ ] STORAGE if a persisted key changes
  - [ ] DIAGRAMS if a new flow appears
```

---

## 7. Change recipes

Common changes and where to touch. Full extension points in
[LLD §23](LLD.md#23-extension-points).

| Change | Files to touch |
|--------|---------------|
| Add a new theme variant | `tailwind.config.js`, `useTheme.ts`, `types/index.ts`, `useMermaidTheme.ts` |
| Add a new keyboard shortcut | `useKeyboardShortcuts.ts` |
| Add a new preview toolbar action | `MarkdownPreview.tsx` (or per-preview), mark with `data-ui-only` |
| Add a new toast style | `Toast.tsx` — extend `kind` union |
| Add a new sidebar tab | `Sidebar.tsx` `TABS[]`, new panel under `src/components/Panels/` |
| Add a new file-drop type | `App.tsx` `fileToDoc`, plus `archive.ts` if it's a container |
| Add a new export format | `src/lib/converters/*`, wire in `ExportDialog.tsx` |
| Change PDF paper size | `src/lib/converters/mdToPdf.ts` constants |
| Bump a chunk warning limit | `vite.config.ts` `chunkSizeWarningLimit` |
| Add a new proxy security rule | `vite-plugins/dev-proxy.ts` `BLOCKED_HOST_PATTERNS` |

---

## 8. Documentation policy

- **Never create ad-hoc summary files.** Long-form docs live under
  `docs/` and follow the HLD / LLD / TDD / API / STORAGE / SECURITY /
  OPERATIONS / BUILD / DIAGRAMS / GLOSSARY structure documented in
  [`docs/README.md`](README.md).
- **A doc change is part of the PR.** If the code needs a doc
  update, ship both in the same commit — reviewers should never
  wonder whether the doc drifted.
- **Cross-link generously.** Every file mention in prose must be a
  markdown link to the source file.
- **Diagrams are Mermaid, in the doc.** Don't attach PNGs — Mermaid
  survives review comments and copy-paste.
- **Never assert timing estimates** in docs (the codebase policy
  bans them elsewhere too).

---

## 9. Review focus by directory

Rough guide for reviewers on what to look for:

| Directory | Watch for |
|-----------|-----------|
| `src/lib/proxyClient.ts` | Bypass of `isProxyAvailable`; direct fetch calls; missing base64 chunking |
| `vite-plugins/dev-proxy.ts` | SSRF blocklist changes; TLS agent scope; size caps |
| `src/lib/archive.ts` | Size cap regressions; missing `yieldToBrowser` in loops |
| `src/lib/storage.ts` | Missing namespace on new key; missing migration |
| `src/store/useAppStore.ts` | Non-immutable mutation; scheduleWorkspaceSave forgotten after mutation |
| `src/components/Preview/*` | `[data-ui-only]` missing on UI chrome; sanitiser bypass |
| `src/lib/converters/*` | New async work without `yieldToBrowser`; missing error path |
| `vite.config.ts` | Manual chunk duplication risk; plugin order regressions |
| `docs/*.md` | Cross-links; matching source signatures |

---

## 10. Release cadence

- **Patch releases** — as needed for bugs and security fixes.
- **Minor releases** — every 4–6 weeks when a feature batch is ready.
- **Major releases** — for breaking persistence shapes or removed
  channels (currently: none planned).

Release procedure:

1. `git checkout main && git pull`
2. `npm ci && npm test && npm run build`
3. `npm version <patch|minor|major>` (updates `package.json`).
4. `git push --follow-tags`
5. CI builds and publishes all channel artefacts.
6. Tag the release notes in GitHub Releases with a link to
   [TDD §10 roadmap](TDD.md#10-roadmap) diffs and CVE remediations.
