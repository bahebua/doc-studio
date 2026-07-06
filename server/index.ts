/*
 * Doc Studio — production HTTP server.
 *
 * Serves the built SPA (`dist/`) as static assets and mounts the same
 * `/__proxy` handler used by the Vite dev server so cURL-runner and
 * URL-import features keep working outside of `npm run dev`. Deployed
 * inside the Docker image and used directly on bare VMs.
 *
 * Env:
 *   PORT                  — listen port (default 8080)
 *   PROXY_ALLOW_PRIVATE   — "1" to allow the proxy to hit private/LAN
 *                           addresses. Default off. In production the
 *                           default SSRF guard stays enabled unless the
 *                           client sends `allowPrivate: true`.
 *   TRUST_PROXY           — "1" if behind nginx / load balancer.
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleProxy } from '../vite-plugins/dev-proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT ?? 8080);

const app = express();

if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

// Health probe for load balancers / Docker HEALTHCHECK.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'doc-studio', time: new Date().toISOString() });
});

// Proxy passthrough. The handler reads/writes `req` and `res` directly,
// so we just hand it off. Errors are converted to a 500 with the raw
// message so the browser gets a useful hint (mirrors dev behaviour).
app.all('/__proxy', (req, res) => {
  void handleProxy(req, res).catch((err) => {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[proxy] unhandled error:', detail);
    if (!res.headersSent) {
      res.status(500).json({ error: detail });
    } else {
      res.end();
    }
  });
});

// Static SPA. `immutable` caching for hashed assets, a short TTL for the
// index so releases roll out promptly.
app.use(
  express.static(distDir, {
    index: false,
    maxAge: '1y',
    immutable: true,
    setHeaders(res, file) {
      if (file.endsWith('index.html')) {
        res.setHeader('cache-control', 'no-cache');
      }
    },
  }),
);

// SPA fallback: any non-API GET returns the index so the client-side
// router (URL params for workspace instances) still works on hard reload.
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[doc-studio] listening on http://0.0.0.0:${PORT}`);
  console.log(`[doc-studio] serving ${distDir}`);
});
