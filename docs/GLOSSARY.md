# Doc Studio — Glossary

Every domain-specific term used in the code and docs, with a canonical
definition and links to where it's implemented or discussed.

---

## A

**Archive.** Container file (`.docx`, `.xlsx`, `.pptx`, `.epub`, `.zip`,
`.tex`) unpacked into a browsable tree of entries. See
[HLD §8](HLD.md#8-core-data-model) and
[LLD §12.1](LLD.md#121-srclibarchivets).

**Archive entry.** A single item inside an archive — text, XML, image,
or a synthesised rendered preview. Shape: `ArchiveEntry` in
[src/types/index.ts](../src/types/index.ts).

**Archive kind.** Type discriminator on archives:
`'docx' | 'xlsx' | 'pptx' | 'epub' | 'zip' | 'tex'`. See
[LLD §16](LLD.md#16-types).

**Autosave.** 700 ms debounced write of the current workspace to
IndexedDB. See [TDD §4.4](TDD.md#44-300-ms-debounced-workspace-save--optimistic-ui).

## B

**Bundle chunk.** A JS file emitted by Rollup. Doc Studio uses
`manualChunks` for stable-name eager chunks and `React.lazy` /
dynamic `import()` for on-demand chunks. See
[BUILD §4](BUILD.md#4-manual-chunk-strategy).

## C

**Capacitor.** Ionic's cross-platform native runtime — hosts the SPA
inside an Android WebView / iOS WKWebView. See
[capacitor.config.ts](../capacitor.config.ts) and [BUILD §10](BUILD.md#10-capacitor-build).

**Chunk warning limit.** `chunkSizeWarningLimit: 900` in
[vite.config.ts](../vite.config.ts) — any single chunk above 900 KB
warns at build time.

**Collection.** User-created archive with `kind: 'zip'`. Doc Studio's
"folder" primitive. Stable id `col-unsaved` for the auto-created
safety-net bucket. See [LLD §15.1](LLD.md#151-srcstoreuseappstorets).

**Compartment.** CodeMirror 6 primitive for hot-swapping extensions
(e.g. changing language mode without recreating the view). Used in
[CodeEditor.tsx](../src/components/Editor/CodeEditor.tsx).

**Custom Highlight API.** Browser primitive (`CSS.highlights`) that
lets JavaScript register `Range[]` under named highlights and style
them with `::highlight(<name>)`. Used for preview search — see
[TDD §4.3](TDD.md#43-custom-highlight-api-for-preview-search).

**cURL envelope.** JSON document with `kind: 'doc-studio/curl-request'`
— serialised form of a saved request + optional response, storable in
a collection. See [API §10](API.md#10-curl-envelope-format).

## D

**Debounce.** Timer that fires only when the input stops changing.
Used in `useDebounced` (App.tsx, 180 ms) and `scheduleWorkspaceSave`
(useAppStore.ts, 700 ms).

**DND MIME constants.** `DND_ENTRY`, `DND_FOLDER`, `DND_DOC` — MIME
strings on `DataTransfer` for drag-and-drop of archive entries,
folders, and open document tabs. See
[LLD §8.4](LLD.md#84-srccomponentspanelsarchivepaneltsx) and
[TDD §4.9](TDD.md#49-archive-tree-drag-and-drop).

**Document.** Anything currently open in the editor. May or may not be
linked to an archive entry via `archiveId`. Shape in
[src/types/index.ts](../src/types/index.ts).

## E

**editorBus.** Module-level singleton exposing the current
`EditorView` so sidebar panels can move the cursor without prop
drilling. See [LLD §12.3](LLD.md#123-srclibeditorbusts).

**Envelope.** See *cURL envelope*.

## H

**HFILL sentinel.** `'\uE000HFILL\uE001'` — Private-Use-Area marker
that survives latex.js parsing and gets converted to a CSS flex
spacer by `applyHfillLayout`. See
[LLD §14.2](LLD.md#142-srcliblatexsanitizelatexforenginets).

**Hydration.** Cold-start restore of state from IndexedDB via
`useAppStore.hydrate()`. See [DIAGRAMS §6.1](DIAGRAMS.md#61-cold-start-hydration).

## I

**IndexedDB.** Browser-native structured storage. Doc Studio accesses
it via `localForage`.

**Insecure TLS.** `insecure: true` on a proxy request — accepts
self-signed certificates. Scoped to a dedicated undici `Agent`; global
TLS untouched. See [API §7](API.md#7-insecure-tls-policy) and
[SECURITY §9](SECURITY.md#9-insecure-tls-handling).

## L

**Language.** Editor mode:
`'markdown' | 'json' | 'xml' | 'html'`. LaTeX lives under `markdown`
and is content-detected at preview time.

**latex.js.** Real PEG-based LaTeX parser + HTML5 generator, running
in the browser. Lazy-loaded (~576 KB). See
[LLD §7.2](LLD.md#72-srccomponentspreviewlatexpreviewtsx).

**LatexStyleConfig.** 10-knob style configuration exposed via
`LatexStylePanel`. Persisted to `localStorage['docstudio.latexStyle.v1']`.
See [LLD §14.1](LLD.md#141-srcliblatexlatexstyleconfigts).

**Layer.** One of the four architectural layers (UI → State →
Services → IO). See [HLD §6](HLD.md#6-architectural-layers).

**LRU.** Least-recently-used eviction, applied to the recents list
(max 12 entries).

## M

**Mammoth.** Client-side DOCX → HTML converter. Loaded via UMD script
injection because Vite's ESM interop mangles it. See
[LLD §13.1](LLD.md#131-srclibconvertersdocxtomdts).

**MAX_BYTES.** 16 MB — proxy response cap. See
[API §9](API.md#9-size-limits).

**MAX_REQUEST_BODY.** 8 MB — proxy request body cap.

**MAX_DOCX_RENDER_BYTES.** 8 MB — larger DOCX skip mammoth rendering.

**MAX_INLINE_IMAGE_BYTES.** 3 MB — larger images become
download-only.

**MAX_TEXT_PRELOAD_BYTES.** 1 MB — larger text entries load on click.

**MermaidTheme.** `'default' | 'dark'` — feeds `mermaid.initialize`.

**Migration.** Idempotent shape upgrade performed at hydrate.
Currently only `migrateTexLanguage`. See
[STORAGE §8](STORAGE.md#8-migration-policy).

**MutationObserver.** DOM API used by `useMermaidTheme` to react to
Tailwind dark-mode class flips.

## N

**Namespace key.** `nsKey(scope, id)` — prefixes an IndexedDB key
with the workspace id. See [STORAGE §2](STORAGE.md#2-key-namespace).

## P

**Preview mode.** `'html' | 'pdf'`. HTML is the normal preview; PDF
is paper-boxed for PDF export capture. See
[DIAGRAMS §5.2](DIAGRAMS.md#52-preview-mode).

**previewBus.** Module-level singletons for the currently mounted
preview's search + focus APIs. See
[LLD §12.10](LLD.md#1210-srclibpreviewbusts).

**Primary path.** `Archive.primaryPath` — the entry the sidebar
opens first when the user clicks the archive.

**Proxy.** The optional `/__proxy` endpoint that bypasses CORS. See
[API §1](API.md#1-__proxy--http-contract).

**PWA.** Progressive Web App. Doc Studio's default delivery channel;
installable, offline-capable.

## R

**Recents.** LRU list of up to 12 recently-touched documents,
per-workspace. See [STORAGE §4](STORAGE.md#4-recents-shape).

**Rendered preview.** Synthetic archive entry
(`(rendered preview).md`) that contains the human-readable Markdown
extracted from a container archive. See
[API §11](API.md#11-rendered-preview-format).

**rehype-katex.** Rehype plugin turning `$…$` and `$$…$$` blocks
into KaTeX-rendered HTML.

**rehype-raw.** Rehype plugin that allows raw HTML in Markdown to
pass through (subject to sanitisation).

**remark-gfm.** Remark plugin adding GitHub-flavored Markdown
(tables, tasks, strikethrough, autolinks).

## S

**Sanitiser.** Function that strips dangerous content. Two in the
codebase:
- `HtmlPreview.sanitize` — strips `on*=` handlers and `javascript:`
  URLs.
- `sanitizeLatexForEngine` — strips unsupported LaTeX packages.

**scheduleWorkspaceSave.** 700 ms debounced coalescer in
`useAppStore.ts` that writes the workspace to IndexedDB.

**Session ws key.** `sessionStorage[WS_SESSION_KEY]` — the resolved
workspace id for this tab.

**Single-file.** Delivery channel that produces one self-contained
`dist-single/index.html`. See [BUILD §6](BUILD.md#6-single-file-build).

**Slugify.** `slugify(text)` in [stats.ts](../src/lib/stats.ts) —
matches rehype-slug's algorithm; used for LaTeX heading ids too.

**SSRF.** Server-Side Request Forgery. Mitigated by `isBlockedHost`
in [dev-proxy.ts](../vite-plugins/dev-proxy.ts). See
[SECURITY §3](SECURITY.md#3-full-threat-model).

**Stash-unsaved.** Behaviour of closing an unsaved orphan tab: its
content is auto-appended to the `col-unsaved` collection so it isn't
lost. See [DIAGRAMS §11.3](DIAGRAMS.md#113-stash-unsaved-on-close).

**stubKeepFilesPlugin.** Custom Vite plugin that resolves `.keep`
files as empty modules — belt-and-braces with the postinstall patch
for latex.js. See [BUILD §2](BUILD.md#2-vite-plugin-order).

## T

**Tauri.** Rust-based framework hosting the SPA in the system
WebView on Windows / macOS / Linux. See
[BUILD §9](BUILD.md#9-tauri-build).

**TocItem.** Table-of-contents item — shape covers markdown, LaTeX,
JSON, and XML outlines. See [LLD §16](LLD.md#16-types).

**Turndown.** HTML → Markdown converter. Used with `turndown-plugin-gfm`
for GFM tables and task lists.

## U

**UMD.** Universal Module Definition. Legacy JS module format that
sets a global when loaded via `<script>`. Doc Studio uses UMD script
injection to load Mammoth.

**Undici.** Node's low-level HTTP client. Used server-side for
`/__proxy` to enable per-request TLS overrides via dedicated
`Agent` instances. See [SECURITY §9](SECURITY.md#9-insecure-tls-handling).

**Unsaved collection.** The auto-created `col-unsaved` collection —
catches content from closed unsaved orphan tabs.

## V

**View mode.** `'split' | 'editor' | 'preview'` — pane layout. See
[DIAGRAMS §5.3](DIAGRAMS.md#53-view-mode).

**Vite.** Bundler + dev server. See [BUILD §2](BUILD.md#2-vite-plugin-order).

**Vitest.** Test runner with its own separate config
([vitest.config.ts](../vitest.config.ts)) to keep the PWA plugin out
of the test process.

## W

**Workbox.** Google's service-worker library, used via
`vite-plugin-pwa` to precache the app shell.

**Workspace.** The root persisted object: `{ files, activeId, archives }`.
One per `?ws=<id>` URL parameter. See
[STORAGE §3](STORAGE.md#3-workspace-shape).

**Workspace id.** Regex-validated string (`/^[a-zA-Z0-9_.-]{1,64}$/`)
used to namespace IndexedDB keys. Resolved once at module load into
`WORKSPACE_ID`.

**Workspace switcher.** Header menu that lists all workspaces on the
origin (`listWorkspaces`) and lets the user open, create, or delete
them.

## X

**XFA.** XML Forms Architecture — Adobe LiveCycle dynamic-form XML
packet embedded inside PDFs. Extracted client-side by
[pdfXfaExtract.ts](../src/lib/pdfXfaExtract.ts).

**XDP.** XML Data Package — the wrapper element around an XFA
payload (`<xdp:xdp>…</xdp:xdp>`).

## Y

**yieldToBrowser.** `await new Promise(r => setTimeout(r, 0))` —
lets the event loop paint between chunks. Called every
`YIELD_EVERY = 32` archive entries.

## Z

**Zen mode.** Fullscreen editor mode toggled with F11. Hides
sidebar, header, and status bar.

**Zustand.** Small state-management library. Two stores in Doc
Studio: `useAppStore` (main) and `useSearchStore` (search UI).
