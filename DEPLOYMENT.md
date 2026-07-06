# Doc Studio — deployment & packaging

Doc Studio ships as one web app + a standalone single-file HTML + a
Docker image + four native shells. Pick the target that matches your
device or your infra.

**Matrix**

| Platform | What you get | Command |
|----------|--------------|---------|
| **Browser (PWA)** | Full app, installable | `npm run dev` (dev) · deploy `dist/` (prod) |
| **Single-file HTML** | One ~19 MB `index.html` — offline, no server, works on almost anything | `npm run build:single` |
| **VM / server (Docker)** | SPA + `/__proxy` API on port 8080 | `npm run docker:up` |
| **Bare VM (no Docker)** | Same as above but under systemd / pm2 | `npm ci && npm run build && node --loader ts-node/esm server/index.ts` |
| **Static host (Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3)** | Static `dist/` only — no proxy | Just point the host at `dist/` after `npm run build` |
| **Windows** | `.exe` / `.msi` installer via Tauri 2 | `npm run tauri:build` |
| **macOS** | `.app` / `.dmg` bundle via Tauri 2 | `npm run tauri:build` |
| **Android** | `.apk` / `.aab` via Capacitor 6 + Android Studio | `npm run cap:run:android` |
| **iOS** | `.ipa` via Capacitor 6 + Xcode | `npm run cap:run:ios` |

The same `dist/` bundle powers every hosted target, so features stay in
lock-step. The single-file build inlines everything for offline use.

---

## 1. Browser (PWA)

Zero extra tooling. `dist/` after `npm run build` is a static site you
can drop on any web host: nginx, GitHub Pages, Vercel, Cloudflare
Pages, S3.

- **Install as an app**: open in Chrome/Edge/Safari → **Install Doc Studio**.
- **Multi-tab behaviour**: each browser window gets an isolated workspace.
  Duplicating a tab keeps you in the same workspace; **File → New
  window** or **Workspaces** in the header mints a new one. Sharable
  `?ws=<id>` in the URL.
- **cURL / URL import**: works on any deployment served over HTTP(S).
  Behind CORS-locked APIs, run the Docker image or bare-VM (below)
  which mounts a server-side proxy at `/__proxy`.

---

## 2. Standalone single-file HTML

**What it is.** One file, `dist-single/index.html`, ~19 MB. Contains
the entire app inlined — JS, CSS, fonts, icons, PDF renderer, Mermaid,
LaTeX engine. No service worker, no network calls, no proxy. Opens
directly from `file://` in any browser that permits local scripting.

**Build it.**

```powershell
npm run build:single
```

Output at `dist-single/index.html`. Copy or rename freely.

**Grab it from CI.** Every push to `main` on GitHub Actions produces
a `doc-studio-single-file-<version>` artifact. Every tag push
(`v*.*.*`) also attaches `doc-studio-<version>.html` and
`doc-studio.html` to the GitHub Release for direct download.

### 2.1 Where it works

| Device / browser | Works? | Notes |
|------------------|--------|-------|
| Desktop Chrome / Edge / Firefox on `file://` | Yes | Full functionality including proxy-less API workbench (subject to CORS) |
| Safari on macOS `file://` | Yes | |
| Android Chrome via Files app → open with browser | Yes | Full functionality |
| iOS Safari from Files.app | Blocked (iOS 15+) | Apple disables script execution for local HTML. Host it on a URL instead |
| **Wear OS smartwatch browser** | Partial | See below |
| Kindle / e-reader browsers | Partial | Non-rendering features work; heavy previews (Mermaid, LaTeX, PDF export) may hang |
| USB stick handoff | Yes | Copy the file and open anywhere |
| Email attachment | Usually blocked | Most mail servers reject `.html` > 25 MB; use a file-sharing link |

### 2.2 Wear OS caveats

- Most Wear OS 3+ watches ship a stripped-down Chromium. Loading a
  19 MB HTML on-watch can take several seconds and burns battery.
- Very small viewports (≤ 240 px) will show the app but the sidebar
  and dialogs won't lay out sensibly. Use **View → preview-only** and
  **Zen mode** to maximise the readable area.
- Some watches block `file://` entirely. Workaround: host the file at
  a static URL and load it over Wi-Fi via the watch browser.
- Confirmed-working set: watches with Wear OS 4 + Chrome 120+ (e.g.
  Pixel Watch 2, Galaxy Watch 6). Older Wear OS 2 devices generally
  don't have a usable browser.

### 2.3 Reducing the size (optional)

The default single-file bundle inlines Mermaid, latex.js, and
`html2canvas`/jsPDF — each is hundreds of KB. If your smartwatch use
case doesn't need those, you can build a trimmed variant by editing
[vite.config.single.ts](vite.config.single.ts) to externalise or stub
those imports. This drops the file to roughly **6–8 MB**.

---

## 3. Docker on a remote VM

The recommended production path. Zero long-lived shell sessions
required.

### 3.1 One-off manual deploy

On your local machine:

```powershell
# 1. Build and push the image to GHCR (requires you to have logged in as bahebua)
docker login ghcr.io -u bahebua                # paste PAT with 'write:packages'
docker build -t ghcr.io/bahebua/doc-studio:latest .
docker push ghcr.io/bahebua/doc-studio:latest
```

Or just let CI do it — the [`web-and-docker`](.github/workflows/web-and-docker.yml)
workflow builds a multi-arch (amd64 + arm64) image on every push to
`main` and tags it `latest`, `<version>`, and `<git-sha>`.

On the remote VM:

```bash
# 1. Install Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# 2. Pull and run
docker pull ghcr.io/bahebua/doc-studio:latest
docker run -d \
  --name doc-studio \
  --restart unless-stopped \
  -p 8080:8080 \
  ghcr.io/bahebua/doc-studio:latest

# 3. Verify
curl http://localhost:8080/healthz
```

The `--restart unless-stopped` flag makes Docker relaunch the container
on VM reboot — no systemd unit required.

### 3.2 Compose file on the VM

Copy [`docker-compose.yml`](docker-compose.yml) from this repo to the
VM, then:

```bash
docker compose up -d
```

`docker compose` runs detached; you can close the SSH session and it
keeps running.

### 3.3 Auto-update with Watchtower

Deploy [Watchtower](https://containrrr.dev/watchtower/) alongside
Doc Studio so it auto-pulls the newest `:latest` tag:

```bash
docker run -d \
  --name watchtower \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  --interval 300 \
  --cleanup \
  doc-studio
```

Every 5 minutes Watchtower checks GHCR, pulls if a newer digest
exists, and restarts `doc-studio`. Combined with the CI push on
merge to `main`, deploys become fully hands-off.

### 3.4 HTTPS in front

Terminate TLS at a reverse proxy so the container stays HTTP-only:

**Caddy (simplest — auto-Let's Encrypt)** — `/etc/caddy/Caddyfile`:

```caddy
docs.example.com {
  reverse_proxy localhost:8080
}
```

```bash
sudo systemctl enable --now caddy
```

**Nginx** — `/etc/nginx/sites-available/doc-studio`:

```nginx
server {
  listen 80;
  server_name docs.example.com;
  location / {
    proxy_pass http://localhost:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then `certbot --nginx -d docs.example.com` for TLS.

If you use a reverse proxy, set `TRUST_PROXY=1` in the container env
so the Node host reads `X-Forwarded-*` correctly:

```bash
docker run -d --name doc-studio --restart unless-stopped \
  -p 8080:8080 \
  -e TRUST_PROXY=1 \
  ghcr.io/bahebua/doc-studio:latest
```

### 3.5 SSH-triggered redeploy

If you don't want Watchtower, a one-line SSH deploy from your laptop:

```powershell
ssh user@vm "docker pull ghcr.io/bahebua/doc-studio:latest && docker restart doc-studio"
```

Wire that into a GitHub Actions job on `workflow_dispatch` with an
SSH secret if you want a "Deploy" button in the Actions UI.

---

## 4. Bare VM without Docker

If you can't (or don't want to) install Docker, run Doc Studio as a
systemd service.

### 4.1 One-time setup

```bash
# On the VM (Ubuntu/Debian shown)
sudo apt-get update
sudo apt-get install -y git build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and build
sudo useradd --system --home /opt/doc-studio --shell /usr/sbin/nologin docstudio
sudo mkdir -p /opt/doc-studio
sudo chown docstudio:docstudio /opt/doc-studio
sudo -u docstudio git clone https://github.com/bahebua/doc-studio.git /opt/doc-studio
cd /opt/doc-studio
sudo -u docstudio npm ci
sudo -u docstudio npm run build
```

### 4.2 systemd unit

Save as `/etc/systemd/system/doc-studio.service`:

```ini
[Unit]
Description=Doc Studio SPA + /__proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=docstudio
WorkingDirectory=/opt/doc-studio
Environment=NODE_ENV=production
Environment=PORT=8080
Environment=TRUST_PROXY=1
ExecStart=/usr/bin/node --loader ts-node/esm server/index.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
# Sandboxing (optional but recommended)
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now doc-studio
sudo systemctl status doc-studio
```

Now the app survives reboots, and you can close the SSH session.

Logs:

```bash
sudo journalctl -u doc-studio -f
```

### 4.3 Updates

```bash
sudo -u docstudio git -C /opt/doc-studio pull
sudo -u docstudio npm --prefix /opt/doc-studio ci
sudo -u docstudio npm --prefix /opt/doc-studio run build
sudo systemctl restart doc-studio
```

Wrap it in a small shell script if you deploy often. Or, again, set up
an SSH-triggered GitHub Actions workflow.

### 4.4 Alternative: pm2

If you already use [pm2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start "node --loader ts-node/esm server/index.ts" \
  --name doc-studio \
  --cwd /opt/doc-studio \
  --env NODE_ENV=production
pm2 save
pm2 startup       # follow the printed instruction to survive reboots
```

### 4.5 Alternative: nohup / tmux (quick and dirty, not recommended)

```bash
cd /opt/doc-studio
nohup env PORT=8080 node --loader ts-node/esm server/index.ts \
  > /var/log/doc-studio.log 2>&1 &
disown
```

Fine for a one-shot demo. Won't survive reboots and has no
supervision.

---

## 5. Static hosting providers

If you don't need the `/__proxy` (i.e. every API you talk to sends
`Access-Control-Allow-Origin`), you can host the SPA on any static
CDN. `dist/` after `npm run build` is what you upload.

### 5.1 Vercel

**Route 1 — dashboard.**

1. https://vercel.com/new → import `bahebua/doc-studio`.
2. Framework preset: **Vite**.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Deploy.

**Route 2 — CLI.**

```powershell
npm install -g vercel
vercel login
vercel --prod
```

Vercel picks up Vite automatically. First deploy asks a few questions;
subsequent deploys are one-shot.

**Note.** Vercel serves everything as static — the `/__proxy` server
route is not deployed. If you need the proxy, deploy the Docker image
on a small VM instead and point users there.

### 5.2 Netlify

**Route 1 — dashboard.**

1. https://app.netlify.com/start → connect the repo.
2. Build command: `npm run build`.
3. Publish directory: `dist`.
4. Deploy.

**Route 2 — CLI.**

```powershell
npm install -g netlify-cli
netlify login
netlify init                # first time; links repo
netlify deploy --prod --dir=dist
```

Same static-only caveat as Vercel.

### 5.3 Cloudflare Pages

1. https://dash.cloudflare.com/?to=/:account/pages → Create → Connect
   to Git → pick `bahebua/doc-studio`.
2. Framework preset: **Vite**.
3. Build command: `npm run build`.
4. Build output: `dist`.
5. Environment variables: none required.
6. Deploy.

Cloudflare gives you free custom domain + auto-HTTPS + unlimited
requests. Best-in-class for a pure static SPA.

### 5.4 GitHub Pages

Enable Pages from a workflow — add
`.github/workflows/gh-pages.yml`:

```yaml
name: gh-pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - uses: actions/deploy-pages@v4
```

Then Settings → Pages → Source: **GitHub Actions**. Site lives at
`https://bahebua.github.io/doc-studio/`.

Because Pages serves under a subpath (`/doc-studio/`), you'd need to
set Vite's `base: '/doc-studio/'` in a custom config to make asset
URLs work — add that only if you use this route.

### 5.5 S3 + CloudFront

```powershell
npm run build
aws s3 sync dist/ s3://your-bucket-name/ --delete
aws cloudfront create-invalidation --distribution-id XXX --paths "/*"
```

Turn on the bucket's Static Website Hosting and put CloudFront in
front for HTTPS + edge caching. Set the default root object to
`index.html`. Add a custom error response (`404 → /index.html 200`)
for SPA routing.

### 5.6 Any nginx / Apache / Caddy static server

Upload `dist/` to the doc root. Add a rewrite so unknown paths fall
back to `index.html`:

**nginx:**

```nginx
try_files $uri /index.html;
```

**Caddy:**

```caddy
example.com {
  root * /var/www/doc-studio
  try_files {path} /index.html
  file_server
}
```

That's the only server-side config Doc Studio needs.

---

## 6. Windows + macOS (Tauri 2)

One-time setup on your dev machine:

1. Install [Rust](https://rustup.rs/) 1.77+.
2. macOS: Xcode Command Line Tools · Windows: Visual Studio C++ Build
   Tools.
3. Convert the SVG icon to platform assets:

```powershell
npm run tauri:icon
```

Dev / build:

```powershell
# Live-reload window on Vite dev server
npm run tauri:dev

# Produce installers under src-tauri/target/release/bundle
npm run tauri:build
```

Bundle outputs:

- **Windows** → `.msi` (WiX) and `.exe` (NSIS)
- **macOS** → `.app` and `.dmg`
- **Linux** → `.deb` and `.AppImage`

CI (see [`tauri-desktop.yml`](.github/workflows/tauri-desktop.yml))
builds these unsigned for you on every push. Tag pushes (`v*.*.*`)
also attach the bundles to a GitHub Release.

For code-signed macOS `.dmg` and Windows `.exe`, add the signing
secrets described in the workflow header.

---

## 7. Android + iOS (Capacitor 6)

One-time setup:

- **Android**: install Android Studio + JDK 17 + Android SDK.
- **iOS**: install Xcode (macOS only).

Bootstrap once per platform:

```powershell
npm run build
npm run cap:add:android      # creates ./android
npm run cap:add:ios          # macOS only; creates ./ios
```

Iterate:

```powershell
# After any web change
npm run cap:sync

# Open the native project
npm run cap:open:android
npm run cap:open:ios

# Or push straight to a connected device / emulator
npm run cap:run:android
npm run cap:run:ios
```

Signing, splash screens, and store listings are managed by the native
projects Capacitor generated — those are yours to customise.

CI builds a debug APK on every push
([`android.yml`](.github/workflows/android.yml)) and an unsigned `.app`
([`ios.yml`](.github/workflows/ios.yml)) so you can grab them from the
Actions tab without setting up a local toolchain.

---

## 8. Grabbing artefacts from CI

Every push to `main` produces downloadable artifacts under
https://github.com/bahebua/doc-studio/actions:

| Workflow | Artifacts |
|----------|-----------|
| `web-and-docker` | `doc-studio-web-<version>` (dist/), `doc-studio-single-file-<version>` (standalone HTML), Docker image at `ghcr.io/bahebua/doc-studio:latest` |
| `tauri-desktop` | `doc-studio-windows-x64`, `doc-studio-macos-universal`, `doc-studio-linux-x64` |
| `android` | `doc-studio-android-debug` (debug APK) |
| `ios` | `doc-studio-ios-app` (unsigned .app, if configured) |

Tag pushes (`git tag v0.1.0 && git push --tags`) additionally draft a
GitHub Release with:

- All Tauri desktop bundles.
- `doc-studio-<version>.html` (single-file bundle).
- `doc-studio.html` (single-file bundle — stable "latest" filename).
- Auto-generated release notes.

---

## 9. Multi-instance model

Every window owns a **workspace id** that namespaces its storage.
Resolution order:

1. `?ws=<id>` in the URL wins (share workspaces via link).
2. Otherwise the tab reads its id from `sessionStorage` — persists
   across reloads and duplications, resets on new-window.
3. Otherwise a fresh random id is minted and written back to the URL.

Effect:

- **Reload a tab** → same workspace.
- **Ctrl/Cmd+N or "New window" in the switcher** → fresh workspace.
- **Duplicate a tab** → same workspace (browser copies sessionStorage).
- **Paste `?ws=<id>` into any new browser / app instance** → jump
  there.

Native apps (Tauri, Capacitor) each open exactly one window by
default; use the in-app **Workspaces** menu (top-right, box icon) to
spawn more.

---

## 10. See also

- [docs/OPERATIONS.md](docs/OPERATIONS.md) — health checks, env vars,
  troubleshooting decision tree, incident response.
- [docs/BUILD.md](docs/BUILD.md) — Vite plugin order, chunk strategy,
  latex.js patch, PWA/Workbox, single-file / Docker / Tauri /
  Capacitor build internals.
- [docs/SECURITY.md](docs/SECURITY.md) — deployment hardening per
  channel, recommended CSP, insecure-TLS policy.
- [docs/STORAGE.md](docs/STORAGE.md) — what lives in the browser and
  how to back it up.
