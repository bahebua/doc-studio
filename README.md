# Doc Studio

A browser-first **document + API workbench**. One installable PWA that
edits Markdown / HTML / JSON / XML / **XFA-XDP**, exports PDFs, runs
cURL / Postman-style requests (including multipart uploads), and unpacks
downloaded archives inline — all client-side, with an optional server
proxy for CORS-locked APIs.

Ships to every device you own: browser, Docker/VM, Windows, macOS,
Linux, Android, iOS — and as a **single self-contained `index.html`**
you can AirDrop to a phone.

```text
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  PWA (any    │   │  Single-file │   │  Docker on   │   │  Native apps │
│  browser)    │   │  index.html  │   │  your VM     │   │  Win/Mac/    │
│              │   │              │   │              │   │  Linux/And/  │
│  install     │   │  ~2.9 MB     │   │  npm run     │   │  iOS         │
│  from URL    │   │  no server   │   │  docker:up   │   │  (Tauri/Cap) │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
             all built from the same dist/ bundle
```

---

## ✨ Features

**Editing**
- Multi-format editor: Markdown, HTML, JSON, XML, XFA/XDP, plain text
- CodeMirror 6 core (syntax highlight, search, folding, indent-aware)
- Drag & drop, paste, and file upload (`.md .html .htm .json .xml .xdp
  .xfd .xfdf .fdf .pdf .txt .docx`)
- Auto-continuation of lists & checklists, tab-indent, image-paste
- Undo / redo history, autosave (per workspace), recent documents

**Preview & Export**
- Live Markdown preview — GFM, syntax highlight, tables, task lists,
  footnotes, emoji, raw HTML, click-to-scroll TOC
- **Mermaid diagrams** — sequence, class, flowchart, ER, state, gantt,
  journey, gitgraph, C4, mindmap, quadrant, sankey and more; rendered
  as inline SVG with per-diagram download to **SVG (lossless vector)**
  or **PNG @ 3× (visually lossless raster)**
- Split / Editor / Preview view modes
- Export as **Markdown**, **HTML** (standalone, embedded CSS, or clean
  fragment), or **PDF** (A4 / Letter, header, footer, page numbers) —
  Mermaid diagrams flow through as SVG in HTML and raster in PDF
- Copy source / rendered HTML / one-click Print → Save as PDF

**Import & Conversion**
- HTML → Markdown (Turndown + GFM plugin)
- DOCX → Markdown (Mammoth)
- **PDF → XFA/XDP XML** — extracts embedded dynamic forms
  (raw + FlateDecode stream scan)
- **Archive unpack** — inspect ZIP / GZIP / TAR responses without leaving
  the app

**API workbench**
- Import a cURL / URL / raw request → editable request builder
- Postman-style runner: method, headers, params, body (raw / JSON / form
  / multipart), auth (Basic / Bearer / API key), collections, history
- **Multipart / file uploads** work reliably (undici-backed proxy — no
  more "415 Unsupported Media Type" surprises)
- Response viewer with MIME/extension detection, rename, download,
  inline unpack, XFA extract

**UX**
- Light / Dark / System theme
- **Multi-workspace** — each browser window / installed instance gets its
  own isolated storage; share via `?ws=<id>` URL
- Mobile-first responsive; keyboard shortcuts; zen mode
- Full PWA — installable, offline, cached
- Word count, reading time, characters, sentences, paragraphs

## 🧰 Tech Stack

- **React 18** + **TypeScript 5** + **Vite 5**
- **CodeMirror 6** editor · **TailwindCSS** + `@tailwindcss/typography` UI
- **react-markdown** stack (`remark-gfm` `remark-emoji` `rehype-highlight`
  `rehype-slug` `rehype-raw`) · **highlight.js**
- **html2pdf.js** for client-side PDF · **JSZip** for archive unpack
- **Turndown** (+ GFM) · **Mammoth** for DOCX
- **zustand** state · **localforage** IndexedDB persistence
- **vite-plugin-pwa** + Workbox · **@resvg/resvg-js** icon rasteriser
- **undici v8** + **Express** for the proxy server
- **Tauri 2** desktop shell · **Capacitor 6** mobile shell

---

## 🚀 Getting started

Requires Node.js **20+**.

```bash
npm install
npm run dev             # http://localhost:5173
npm run dev:lan         # bind on 0.0.0.0 so phones on Wi-Fi can hit it
npm run build           # production PWA → dist/
npm run preview         # serve dist/ locally
npm run lint
```

## 📦 Install / deploy options at a glance

Full instructions in **[DEPLOYMENT.md](DEPLOYMENT.md)**. Quick reference:

| Target | Command | Output |
|--------|---------|--------|
| PWA (any host) | `npm run build` | `dist/` static site — drop on nginx / S3 / Cloudflare Pages / GitHub Pages |
| Single-file bundle | `npm run build:single` | `dist-single/index.html` (~2.9 MB, no server, no SW) |
| Docker on your VM | `npm run docker:up` | `http://<vm>:8080` with `/__proxy` for CORS-locked APIs |
| Windows / macOS / Linux desktop | `npm run tauri:build` | `.msi` `.exe` `.dmg` `.AppImage` `.deb` under `src-tauri/target/release/bundle/` |
| Android | `npm run cap:run:android` | Debug APK via Android Studio |
| iOS | `npm run cap:run:ios` | `.app` / `.ipa` via Xcode (macOS host) |

### Install as an app

- **Desktop Chrome/Edge/Safari** — install icon in the address bar
- **Android** — Chrome menu → *Install app*
- **iOS Safari** — Share → *Add to Home Screen* (PNG icons + status-bar
  meta tags are shipped for a native look)
- **From `dist-single/index.html`** — email / AirDrop / Files.app; opens
  in any browser on desktop and Android. iOS is finicky about `file://`
  scripts — host it or use a tunnel for iPhone. Editor + PDF + XFA all
  work offline; the cURL runner needs a hosted deployment because of
  browser CORS on `null` origins.

## 🤖 CI / release (GitHub Actions)

Four workflows in [.github/workflows/](.github/workflows) build every
target on push and draft a GitHub Release on `v*.*.*` tags:

- **[web-and-docker.yml](.github/workflows/web-and-docker.yml)** —
  lint + build the PWA, push multi-arch image to `ghcr.io/<owner>/<repo>`
- **[tauri-desktop.yml](.github/workflows/tauri-desktop.yml)** —
  matrix Windows / macOS-universal / Linux bundles
- **[android.yml](.github/workflows/android.yml)** — Capacitor + Gradle
  debug APK (release AAB steps commented in)
- **[ios.yml](.github/workflows/ios.yml)** — Capacitor + Xcode unsigned
  simulator build (TestFlight IPA steps commented in)

No secrets required for unsigned builds. Code-signing secrets are
documented inline in each workflow.

## 🗂 Multi-workspace model

Every window owns a **workspace id** that namespaces its IndexedDB
storage. Resolution order:

1. `?ws=<id>` in the URL wins — share workspaces via link.
2. Otherwise the tab reads its id from `sessionStorage` — persists
   across reloads and duplications, resets on new-window.
3. Otherwise a fresh id is minted and written back to the URL.

Effect:

| Action | Workspace |
|--------|-----------|
| Reload tab | same |
| Duplicate tab | same (browser copies sessionStorage) |
| New window / new install / new device | fresh |
| Paste `?ws=<id>` anywhere | jump to that workspace |

Use the **Workspaces** switcher (box icon, top-right) to list, create,
open in new window, or delete workspaces.

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` / `Ctrl+Y` | Redo |
| `Ctrl/Cmd + B` | Toggle editor / preview |
| `Ctrl/Cmd + /` | Split view |
| `F11` | Zen mode |
| `Tab` / `Shift+Tab` | Indent / outdent selection |
| `Enter` inside a list | Continue the list |

## 🗂 Project structure

```
src/
├── App.tsx                       # Main app shell
├── main.tsx                      # React entry
├── index.css                     # Global styles + prose theme
├── types/                        # Shared TypeScript types
├── hooks/                        # useTheme, useKeyboardShortcuts
├── store/useAppStore.ts          # Zustand store: doc, history, settings
├── lib/
│   ├── storage.ts                # localForage + per-workspace namespace
│   ├── stats.ts                  # word count + TOC extraction
│   ├── mimeExt.ts                # MIME↔extension + Content-Disposition
│   ├── pdfXfaExtract.ts          # XFA/XDP extraction from PDFs
│   ├── archive.ts                # ZIP/GZIP/TAR detect + unpack
│   └── converters/               # md ↔ html · docx · pdf export
├── components/
│   ├── Layout/                   # Header, Sidebar, StatusBar,
│   │                              # WorkspaceSwitcher
│   ├── Editor/                   # CodeMirror wrappers
│   ├── Preview/                  # Live Markdown/HTML preview
│   ├── Panels/                   # TOC, Search, Stats, Recents,
│   │                              # ArchivePanel, RequestPanel
│   ├── Dialogs/                  # ExportDialog, ImportDialog
│   └── ui/                       # Button, Modal, Tooltip, Toast

server/index.ts                   # Express + /__proxy for prod
vite-plugins/dev-proxy.ts         # Same proxy for dev + reused by server
src-tauri/                        # Rust shell (desktop)
android/  ios/                    # Generated by cap add (native shells)
scripts/gen-icons.ts              # SVG → PNG rasteriser (prebuild hook)
.github/workflows/                # CI: web, docker, tauri, android, ios
```

## 🧭 Roadmap

Architecture is intentionally modular — these slot in cleanly:

- PDF → Markdown (text extraction + optional OCR)
- Multiple in-app tabs per workspace
- Export to DOCX / EPUB / JSON
- Optional AI helpers (grammar, summarise, TOC generation)
- Real-time collaboration via CRDTs

## 📄 License

MIT. Do whatever you like with it.
