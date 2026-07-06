# Doc Studio — Frequently asked questions

Answers to the questions that come up most often, grouped by audience.

**Index**

1. [End users](#1-end-users)
2. [Contributors](#2-contributors)
3. [Operators](#3-operators)
4. [Reviewers & auditors](#4-reviewers--auditors)

---

## 1. End users

### 1.1 Where is my data stored?

Only in your browser (IndexedDB) — nothing goes to a server unless
you explicitly send a request via the API workbench. See
[STORAGE.md](STORAGE.md).

### 1.2 Can I sync between devices?

Not today. See [ROADMAP §4 item 20](ROADMAP.md#4-speculative) for
the planned opt-in end-to-end-encrypted sync.

### 1.3 What happens if my browser wipes storage?

Everything Doc Studio knows is gone. Export important collections via
**Archives → export** to keep a backup. See
[STORAGE §12](STORAGE.md#12-backup-and-restore).

### 1.4 Can I use multiple isolated workspaces?

Yes — append `?ws=<name>` to the URL. Two tabs open at
`?ws=work` and `?ws=notes` have entirely independent stores. See
[HLD §10.3](HLD.md#103-workspace-id-resolution).

### 1.5 Why does the PDF export take a few seconds?

We rasterise the preview page-by-page in the browser (via
`html2canvas`) — this avoids a browser canvas limit that would cause
blank pages for long docs, at the cost of ~90 ms per page. See
[TDD §4.8](TDD.md#48-pdf-export-per-page-capture).

### 1.6 Is body text in the exported PDF selectable?

No — it's rasterised. Page numbers, header, and footer text *are*
selectable because jsPDF adds them as native text overlays.
Selectable body text would require server-side rendering; see
[HLD §14](HLD.md#14-boundaries-and-non-goals).

### 1.7 Why isn't my LaTeX rendering exactly like Overleaf?

We ship [latex.js](https://latex.js.org/), a pragmatic browser
subset. Real TeX Live in WASM is on the roadmap ([item 19](ROADMAP.md#4-speculative))
but adds ~50 MB.

### 1.8 Why does my `curl` command not send from the browser tab?

Browsers enforce CORS on cross-origin requests. Doc Studio's
`/__proxy` bypasses this — you need to run `npm run dev`, `npm run
server`, or Docker. See [API §1](API.md#1-__proxy--http-contract).

### 1.9 Can I install Doc Studio like an app?

Yes:
- Desktop: install as a PWA from Chromium / Edge / Safari, or use
  the Tauri installer for a native shell.
- Mobile: install as a PWA from Safari (iOS) / Chrome (Android), or
  use the Capacitor-packaged app.

### 1.10 Why does the app open two windows?

You (or a link) opened a new workspace via `?ws=<other-id>`. Each
`?ws` value opens in a separate window with isolated storage.

---

## 2. Contributors

### 2.1 How do I add a new editor language?

See [LLD §23.1](LLD.md#231-add-a-new-editor-language).

### 2.2 How do I add a new file format?

See [LLD §23.2](LLD.md#232-add-a-new-container-format).

### 2.3 Why can't I import the store from `src/lib/`?

Layer boundary. See [HLD §6](HLD.md#6-architectural-layers) and
[CONTRIBUTING §4](CONTRIBUTING.md#4-coding-conventions).

### 2.4 Why is Vitest configured separately from Vite?

To keep `vite-plugin-pwa` and the LaTeX chunking plugin out of the
test process. See [TDD §7 ADR-014](TDD.md#7-architectural-decisions-adrs).

### 2.5 Why is Mammoth loaded via `<script>` tag instead of `import`?

Vite/esbuild can't cleanly consume Mammoth's UMD module namespace.
See [LLD §13.1](LLD.md#131-srclibconvertersdocxtomdts) and its inline
comment.

### 2.6 What runs on `postinstall`?

Only [`patch-latexjs.mjs`](../scripts/patch-latexjs.mjs), which
deletes the two `.keep` marker files that break Vite's esbuild
pre-bundler. Idempotent.

### 2.7 How do I run just one test?

```powershell
npm test -- src/lib/stats.test.ts
```

Or add `.only` — `describe.only(...)` or `it.only(...)`.

### 2.8 How do I visualise the bundle?

```powershell
npx vite-bundle-visualizer
```

Produces `stats.html`. See [BUILD §15](BUILD.md#15-bundle-inspection).

### 2.9 Why doesn't `npm run <script>` work in PowerShell?

Execution policy blocks `npm.ps1`. Use the direct-node invocation:
```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run <script>
```

Or update your execution policy for the session:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
```

### 2.10 What files should a PR touch?

Depends on the change; the checklist in [CONTRIBUTING §6](CONTRIBUTING.md#6-pr-checklist)
enumerates. Rule of thumb: touch the docs in the same commit as the
code that motivates them.

---

## 3. Operators

### 3.1 How do I run this in production?

Fastest path: `docker compose up -d`. See [OPERATIONS §1](OPERATIONS.md#1-deployment-channels).

### 3.2 What are the health checks?

`GET /healthz` (liveness) and `GET /__proxy` (proxy availability).
See [OPERATIONS §3](OPERATIONS.md#3-health-checks).

### 3.3 What environment variables?

Only `PORT` and `TRUST_PROXY`. See [OPERATIONS §2](OPERATIONS.md#2-environment-variables).

### 3.4 Does it need a database?

No. The Node host is stateless — everything persistent is in the
user's browser.

### 3.5 How do I scale it?

Horizontally — run more container instances behind a load balancer.
No sticky sessions needed. See [OPERATIONS §10.1](OPERATIONS.md#101-server-side).

### 3.6 How do I harden `/__proxy` behind auth?

Put a reverse proxy in front (nginx, Caddy, Traefik) that enforces
SSO / IP allow-list. Or patch [`server/index.ts`](../server/index.ts)
to require a header token. See [SECURITY §6.2](SECURITY.md#62-node-host-with-__proxy).

### 3.7 How do I disable the CORS proxy entirely?

Deploy the static bundle without the Node host — nginx / S3 /
Cloudflare Pages / any static host. `/__proxy` requests will fall
back to direct browser fetches (subject to CORS).

### 3.8 How do I customise size caps?

Edit `MAX_BYTES` and `MAX_REQUEST_BODY` in
[`vite-plugins/dev-proxy.ts`](../vite-plugins/dev-proxy.ts) then
rebuild. See [API §9](API.md#9-size-limits).

### 3.9 Where do I collect metrics?

Nothing built-in — the Node host is intentionally spartan. Add a
reverse-proxy layer with metrics or wire `prom-client` around
`handleProxy`.

### 3.10 What's the update path for users after I deploy?

- PWA: `autoUpdate` toasts users on next visit.
- Docker: pull new image + `docker compose up -d --build`.
- Tauri: users receive the built-in updater prompt.
- Capacitor: store submission or `@capacitor/updates` (not shipped
  today).

---

## 4. Reviewers & auditors

### 4.1 Where do I start?

Read [HLD §13 ADR summary](HLD.md#13-architectural-decisions-adr-summary),
[TDD §6 security](TDD.md#6-security), and
[SECURITY.md](SECURITY.md) in that order.

### 4.2 What's the trust boundary of the proxy?

See [SECURITY §2](SECURITY.md#2-trust-boundaries). Short version:
the proxy is trusted on its own host and hostile toward the
external internet (SSRF + size caps).

### 4.3 What third-party dependencies could ship malware?

None run at install time other than the first-party
[patch-latexjs.mjs](../scripts/patch-latexjs.mjs). See [SECURITY §11](SECURITY.md#11-dependency-hygiene).

### 4.4 Is there any telemetry?

None. No analytics, no error tracking, no ping. Verifiable by grepping
the source for `fetch(` / `navigator.sendBeacon(` / third-party
analytics SDKs (there are none).

### 4.5 Is stored data encrypted?

No. Single-tenant client-first product — the browser origin is the
security boundary. See [SECURITY §10](SECURITY.md#10-cryptography).

### 4.6 What are the largest attack surfaces?

Ranked: proxy SSRF → imported HTML XSS → insecure-TLS toggle →
zip-bomb DOCX. All are mitigated in [SECURITY §3](SECURITY.md#3-full-threat-model).

### 4.7 How do I report a vulnerability?

See [SECURITY §12](SECURITY.md#12-reporting-a-vulnerability).

### 4.8 What's the SBOM?

`package-lock.json` is the definitive dependency inventory. Generate
a CycloneDX SBOM with:
```powershell
npx @cyclonedx/cyclonedx-npm --output-file sbom.json
```

### 4.9 Which files are safety-critical?

- [vite-plugins/dev-proxy.ts](../vite-plugins/dev-proxy.ts) — SSRF + TLS + caps.
- [src/lib/storage.ts](../src/lib/storage.ts) — namespace correctness.
- [src/components/Preview/HtmlPreview.tsx](../src/components/Preview/HtmlPreview.tsx) — XSS surface.
- [src/lib/proxyClient.ts](../src/lib/proxyClient.ts) — request builder.

### 4.10 Where do design decisions live?

[HLD §13](HLD.md#13-architectural-decisions-adr-summary) is the ADR
index. Each ADR has a short rationale in HLD and an expanded
discussion in [TDD §7](TDD.md#7-architectural-decisions-adrs).
