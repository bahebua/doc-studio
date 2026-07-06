# Doc Studio — deployment & packaging

Doc Studio ships as one web app + four native shells + a Docker image.
Pick the target that matches your device.

| Platform      | What you get                                      | Command                     |
|---------------|---------------------------------------------------|-----------------------------|
| **Browser**   | Full app, installable as a PWA                    | `npm run dev` (dev) · deploy `dist/` (prod) |
| **VM / server** | Docker image serving the SPA + `/__proxy` API  | `npm run docker:up`         |
| **Windows**   | `.exe` / `.msi` installer via Tauri 2             | `npm run tauri:build`       |
| **macOS**     | `.app` / `.dmg` bundle via Tauri 2                | `npm run tauri:build`       |
| **Android**   | `.apk` / `.aab` via Capacitor 6 + Android Studio  | `npm run cap:run:android`   |
| **iOS**       | `.ipa` via Capacitor 6 + Xcode                    | `npm run cap:run:ios`       |

The same `dist/` bundle powers every target, so features stay in lock-step.

---

## 1. Browser (PWA)

Zero extra tooling. `dist/` after `npm run build` is a static site you can
drop on any web host: nginx, GitHub Pages, Vercel, Cloudflare Pages, S3.

- **Install as an app**: open in Chrome/Edge/Safari → **Install Doc Studio**.
- **Multi-tab behaviour**: each browser window gets an isolated workspace
  (its own files, recents, archives). Duplicating a tab keeps you in the
  same workspace; **File → New window** or opening the app in a fresh
  window mints a new one. See the *Workspaces* button in the header to
  jump between them.
- **cURL / URL import**: works on any deployment served over HTTP(S).
  Behind CORS-locked APIs, run the Docker image (below) which mounts a
  server-side proxy at `/__proxy`.

## 2. VM / server (Docker)

```bash
# Build + run in one shot
npm run docker:up

# Or with the raw Docker CLI
docker build -t doc-studio .
docker run --rm -p 8080:8080 doc-studio
```

Then open `http://<vm-ip>:8080`. The image bundles:

- `dist/` (the SPA) served statically with long-cache headers
- `/__proxy` — the same fetch bridge used in dev, so multipart cURL and
  cross-origin imports work without touching the browser
- `/healthz` — for load balancers

**Behind nginx / Traefik**: set `TRUST_PROXY=1` in the compose file and
terminate TLS at the reverse proxy. Turn `PROXY_ALLOW_PRIVATE=0` if the
box shouldn't be able to hit its own LAN.

## 3. Windows + macOS (Tauri 2)

One-time setup on your dev machine:

1. Install [Rust](https://rustup.rs/) 1.77+
2. macOS: Xcode Command Line Tools · Windows: Visual Studio C++ Build Tools
3. Convert the SVG icon to platform assets:
   ```bash
   npm run tauri:icon
   ```

Dev / build:

```bash
# Live-reload window (opens on Vite dev server)
npm run tauri:dev

# Produce installers under src-tauri/target/release/bundle
npm run tauri:build
```

Bundle outputs:

- **Windows** → `.msi` (WiX) and `.exe` (NSIS)
- **macOS**   → `.app` and `.dmg`
- **Linux**   → `.deb` and `.AppImage` (bonus)

The Tauri shell hosts the same web UI unchanged. Native filesystem,
HTTP-without-CORS and file dialogs are exposed as plugins; see
`src-tauri/capabilities/default.json` to tighten permissions.

## 4. Android + iOS (Capacitor 6)

One-time setup:

- **Android**: install Android Studio + JDK 17 + Android SDK
- **iOS**: install Xcode (macOS only)

Bootstrap once per platform:

```bash
npm run build
npm run cap:add:android      # creates ./android
npm run cap:add:ios          # creates ./ios (macOS-only)
```

Iterate:

```bash
# After any web change
npm run cap:sync

# Open native project in Android Studio / Xcode
npm run cap:open:android
npm run cap:open:ios

# Or push straight to a connected device / emulator
npm run cap:run:android
npm run cap:run:ios
```

Signing, splash screens, and store listings are managed by the native
projects that Capacitor generated — those are yours to customise.

---

## Multi-instance model

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
- **Paste `?ws=<id>` into any new browser / app instance** → jump there.

Native apps (Tauri, Capacitor) each open exactly one window by default;
use the in-app **Workspaces** menu (top-right, box icon) to spawn more.
