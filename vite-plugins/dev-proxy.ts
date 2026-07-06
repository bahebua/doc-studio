import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Agent as UndiciAgent,
  fetch as undiciFetch,
  Request as UndiciRequest,
  FormData as UndiciFormData,
} from 'undici';

/**
 * A tiny dev-only fetch proxy that lets the browser retrieve URLs that
 * would otherwise be blocked by CORS (arbitrary docs, cURL replays, etc.).
 *
 * Route: GET/POST /__proxy?url=<encoded>
 *
 * The endpoint is intentionally minimal — it exists to unblock quick
 * imports during local development. Guardrails:
 *
 *   1. Only mounted on the dev server (`configureServer`), never in the
 *      production build. `curl` / URL-import UI checks for the endpoint
 *      and falls back to a direct in-browser fetch when absent.
 *   2. Refuses non-http(s) URLs and any host resolving to loopback /
 *      private / link-local IPs. This blocks the obvious SSRF flavour —
 *      pointing the "proxy" at the developer's own intranet.
 *   3. Response body is capped at MAX_BYTES so a runaway target can't
 *      exhaust dev-server memory.
 *   4. Passes through the origin server's `content-type` so the client
 *      can classify text / JSON / binary correctly.
 *   5. Forwards a small allow-list of request options (method, headers,
 *      body) supplied as a JSON POST body.
 *   6. Insecure-TLS mode (`insecure: true` in the POST body) uses a
 *      dedicated undici Agent so cert-check bypass is scoped to the
 *      single request — the global TLS policy is never mutated.
 */

const MAX_BYTES = 16 * 1024 * 1024;      // 16 MB response cap
const MAX_REQUEST_BODY = 8 * 1024 * 1024; // 8 MB proxy-input cap

// Hosts we refuse to talk to. Case-insensitive substring match on the
// hostname *after* DNS-safe checks. We can't do full DNS resolution here
// without adding a dep, so we do a best-effort literal check that stops
// the obvious footguns.
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fe80:/i,
];

function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOST_PATTERNS.some((p) => p.test(hostname));
}

interface ProxyRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** When true, use an undici Agent with `rejectUnauthorized: false`. Only
   *  meaningful for HTTPS targets and only honoured for this single
   *  request. Mirrors cURL's `-k` / `--insecure`. */
  insecure?: boolean;
  /** When true, bypass the private/loopback host block. Only sensible on
   *  a dev machine where the user is intentionally hitting an intranet
   *  API (192.168.x, 10.x, localhost). Default false so the standard
   *  SSRF guard stays on for anything that hasn't explicitly opted in. */
  allowPrivate?: boolean;
  /** Multipart form parts. When present, the proxy rebuilds a Node
   *  `FormData` on the fly (base64-decoding file bytes) and forwards it
   *  as the request body — undici sets a fresh boundary. `body` is
   *  ignored in that case. */
  formParts?: SerialisedFormPart[];
}

/** Wire shape sent by the client for each multipart part. Mirrors the
 *  matching interface in `proxyClient.ts`. */
interface SerialisedFormPart {
  name: string;
  kind: 'text' | 'file';
  value?: string;
  filename?: string;
  contentType?: string;
  base64?: string;
}

interface ProxyRequestBody extends ProxyRequestOptions {
  /** Bytes we failed to parse — surfaced in errors so the caller knows
   *  whether the JSON body itself was malformed. */
  __rawSize?: number;
}

// Reusable insecure agent — creating one per request thrashes connections.
// Undici pools sockets by dispatcher instance, so sharing is cheaper.
let insecureAgent: UndiciAgent | null = null;
function getInsecureAgent(): UndiciAgent {
  insecureAgent ??= new UndiciAgent({ connect: { rejectUnauthorized: false } });
  return insecureAgent;
}

async function readJsonBody(req: IncomingMessage): Promise<ProxyRequestBody | undefined> {
  if (req.method !== 'POST') return undefined;
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflow = false;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BODY) {
        overflow = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) {
        resolve({ __rawSize: total });
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? (JSON.parse(raw) as ProxyRequestBody) : undefined);
      } catch (err) {
        console.error('[dev-proxy] failed to parse JSON body:', err);
        resolve({ __rawSize: total });
      }
    });
    req.on('error', (err) => {
      console.error('[dev-proxy] request read error:', err);
      resolve(undefined);
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Normalise unknown thrown values into a readable string. Node fetch
 * (undici) frequently wraps the true failure inside `.cause`, which is
 * where the actual "self-signed cert" / "ECONNREFUSED" etc. lives.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const parts = [err.message];
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      parts.push(`cause: ${cause.message}`);
    } else if (cause) {
      parts.push(`cause: ${String(cause)}`);
    }
    const code = (err as Error & { code?: string }).code;
    if (code) parts.push(`code: ${code}`);
    return parts.join(' — ');
  }
  return String(err);
}

async function handleProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '', 'http://localhost');
  const target = url.searchParams.get('url');
  if (!target) {
    sendJson(res, 400, { error: 'Missing "url" query parameter.' });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    sendJson(res, 400, { error: 'Invalid target URL.' });
    return;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    sendJson(res, 400, { error: 'Only http(s) targets are allowed.' });
    return;
  }

  const opts = await readJsonBody(req);
  if (opts?.__rawSize) {
    sendJson(res, 400, {
      error: `Proxy input body invalid or too large (${opts.__rawSize} bytes, cap ${MAX_REQUEST_BODY}).`,
    });
    return;
  }
  // SSRF guard — off when the caller explicitly opts in (intranet APIs).
  // We read opts BEFORE this check so the flag is available; the ordering
  // vs. body-parse-error is deliberate.
  if (!opts?.allowPrivate && isBlockedHost(parsed.hostname)) {
    sendJson(res, 403, {
      error: `Refusing to proxy to private/loopback host "${parsed.hostname}".`,
      hint:
        'This looks like an intranet or localhost target. Tick "Allow private hosts" ' +
        'in the URL / cURL import dialog to opt in (dev-server only).',
    });
    return;
  }
  const method = (opts?.method ?? 'GET').toUpperCase();
  const headers = new Headers();
  if (opts?.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      // Undici throws on invalid header values (NUL bytes, CR/LF, empty
      // names). Silently drop malformed pairs but note them so the client
      // toast at least mentions the problem.
      try {
        headers.set(k, v);
      } catch (err) {
        console.warn(`[dev-proxy] dropped invalid header ${k}: ${describeError(err)}`);
      }
    }
  }
  if (!headers.has('user-agent')) {
    headers.set('user-agent', 'DocStudio/1.0 (+dev proxy)');
  }

  const method_ = method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  const useInsecure = !!opts?.insecure && parsed.protocol === 'https:';

  // Multipart handling: when the client supplied `formParts`, build a
  // Node FormData server-side, encode it into a byte buffer, and forward
  // the buffer with an explicit `multipart/form-data; boundary=…` header.
  //
  // Why buffer and not pass FormData directly? Undici v8 auto-generates
  // the Content-Type from a FormData body — but only when nothing else
  // has claimed the header. In practice we've seen intermediaries and
  // some Node fetch pipelines drop the header, leaving the target with
  // `Content-Type: text/plain` (or nothing) → HTTP 415. Serialising to
  // bytes once and setting the header ourselves guarantees the boundary
  // in the header always matches the bytes on the wire.
  let requestBody: string | Buffer | globalThis.FormData | undefined = opts?.body;
  if (opts?.formParts && opts.formParts.length > 0) {
    const fd = new UndiciFormData();
    for (const part of opts.formParts) {
      if (part.kind === 'text') {
        fd.append(part.name, part.value ?? '');
      } else {
        // Decode base64 file bytes. Empty payload → still emit the field
        // as a 0-byte file so the target sees the correct multipart
        // shape (matches the direct-browser fallback in proxyClient).
        const bin = part.base64 ? Buffer.from(part.base64, 'base64') : Buffer.alloc(0);
        const type = part.contentType || 'application/octet-stream';
        // Node's global File (v20+) is spec-compliant and interoperable
        // with undici's FormData. `type` and `filename` are preserved
        // into the multipart part headers by the encoder.
        const file = new globalThis.File([bin], part.filename ?? part.name, { type });
        fd.append(part.name, file as unknown as Blob);
      }
    }
    // Round-trip through an undici `Request` to have undici do the
    // multipart encoding for us — this is the same encoder undici would
    // use on the outbound fetch, so header + bytes stay in lock-step.
    const probe = new UndiciRequest('http://x/', { method: 'POST', body: fd });
    const ct = probe.headers.get('content-type');
    const encoded = Buffer.from(await probe.arrayBuffer());
    headers.delete('content-type');
    headers.delete('content-length');
    if (ct) headers.set('content-type', ct);
    headers.set('content-length', String(encoded.byteLength));
    requestBody = encoded;
    console.log(
      `[dev-proxy] multipart POST ${parsed.toString()} — ` +
        `${opts.formParts.length} part(s), ` +
        `${encoded.byteLength} bytes, ` +
        `content-type: ${ct}`,
    );
  }

  let upstream: Response;
  try {
    // We always route through the imported `undiciFetch` so the insecure
    // path can supply a dispatcher — global `fetch` on Node 20 doesn't
    // expose that option. Behaviour matches otherwise.
    upstream = (await undiciFetch(parsed.toString(), {
      method: method_,
      // Convert Headers to a plain object. `Headers` isn't typed as
      // iterable in every lib.dom bundle, so we walk it with forEach —
      // duplicate names are collapsed by Headers itself.
      headers: (() => {
        const out: Record<string, string> = {};
        headers.forEach((v, k) => {
          out[k] = v;
        });
        return out;
      })(),
      body: requestBody as unknown as string | Buffer,
      redirect: 'follow',
      ...(useInsecure ? { dispatcher: getInsecureAgent() } : {}),
    })) as unknown as Response;
  } catch (err) {
    const detail = describeError(err);
    console.error(`[dev-proxy] fetch failed for ${parsed.toString()}: ${detail}`);
    sendJson(res, 502, {
      error: `Fetch failed: ${detail}`,
      hint:
        /self-signed|unable to verify|certificate/i.test(detail)
          ? 'Add `-k` / `--insecure` to your cURL command to bypass TLS verification.'
          : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(detail)
            ? 'Cannot reach the host. Check DNS / VPN / firewall.'
            : undefined,
    });
    return;
  }

  const declaredLen = Number(upstream.headers.get('content-length') ?? '0');
  if (declaredLen > MAX_BYTES) {
    sendJson(res, 413, {
      error: `Upstream too large (${declaredLen} bytes, cap ${MAX_BYTES}).`,
    });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await upstream.arrayBuffer());
  } catch (err) {
    const detail = describeError(err);
    console.error(`[dev-proxy] arrayBuffer failed: ${detail}`);
    sendJson(res, 502, { error: `Reading response body failed: ${detail}` });
    return;
  }

  if (buffer.byteLength > MAX_BYTES) {
    sendJson(res, 413, {
      error: `Upstream exceeded ${MAX_BYTES}-byte cap.`,
    });
    return;
  }

  // Pass through the useful bits so the client can classify + display.
  res.statusCode = upstream.status;
  const upstreamCt = upstream.headers.get('content-type');
  if (upstreamCt) res.setHeader('content-type', upstreamCt);
  // Content-Disposition drives filename detection on the client — e.g.
  // an API returning a zip via `attachment; filename="report.zip"` lets
  // us save with the right extension instead of `.bin`. CORS normally
  // hides this header from the browser side; proxying it back
  // explicitly is what makes the fetch client able to read it.
  const upstreamDisp = upstream.headers.get('content-disposition');
  if (upstreamDisp) res.setHeader('content-disposition', upstreamDisp);
  res.setHeader('x-proxy-target', parsed.toString());
  res.setHeader('x-proxy-final-url', upstream.url);
  res.setHeader('x-proxy-status', String(upstream.status));
  res.end(buffer);
}

/** Vite plugin: mounts the proxy route on the dev server only. */
export function devProxyPlugin(): Plugin {
  return {
    name: 'doc-studio-dev-proxy',
    apply: 'serve', // dev only — never bundled into the production output.
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/__proxy', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'POST') {
          next();
          return;
        }
        void handleProxy(req, res).catch((err) => {
          const detail = describeError(err);
          console.error('[dev-proxy] unhandled error:', detail);
          if (!res.headersSent) {
            sendJson(res, 500, { error: detail });
          } else {
            res.end();
          }
        });
      });
    },
  };
}

/** Re-export the proxy handler so the production server (Docker / VM)
 *  can mount the same code path without depending on Vite. */
export { handleProxy };


