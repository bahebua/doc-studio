/**
 * Client wrapper for the dev-only `/__proxy` middleware in
 * `vite-plugins/dev-proxy.ts`. Falls back to a direct browser fetch when
 * the proxy is not available (production build, custom host, etc.).
 */

import type { ParsedCurl, FormPart } from './curlParser';
import { isBinaryMime } from './mimeExt';

let cachedProbe: Promise<boolean> | null = null;

/**
 * One-shot probe that succeeds if the dev proxy is mounted. Cached for
 * the session — the proxy either exists at boot or it doesn't; there's
 * no legitimate way for it to appear later.
 */
export function isProxyAvailable(): Promise<boolean> {
  if (cachedProbe) return cachedProbe;
  cachedProbe = (async () => {
    try {
      const res = await fetch('/__proxy', { method: 'GET' });
      if (res.status !== 400) return false;
      const ct = res.headers.get('content-type') ?? '';
      return ct.includes('application/json');
    } catch {
      return false;
    }
  })();
  return cachedProbe;
}

export interface ProxyResult {
  status: number;
  contentType: string;
  finalUrl: string;
  /** Response body as text. Empty string when the response is binary
   *  (`binaryBase64` is set instead). */
  text: string;
  /** True when the response was obtained via the dev proxy. Otherwise the
   *  browser fetched directly and CORS applied. */
  viaProxy: boolean;
  /** True when the upstream server returned a non-2xx *response* — the
   *  request itself succeeded end-to-end and `text` holds the origin's
   *  body. Distinguish from a proxy-level failure (which throws). */
  upstreamError: boolean;
  /** Base64 payload for binary responses (PDF, image, octet-stream, …).
   *  When set, `text` is empty and the caller should treat the response
   *  as opaque bytes rather than trying to render it as text. */
  binaryBase64?: string;
  /** Byte length of the raw response — used for the "N bytes" UI hint
   *  when binary. Undefined for text responses (`text.length` is close
   *  enough there). */
  byteSize?: number;
  /** Raw `Content-Disposition` header from the origin, if any. The
   *  filename part is what drives "save as" naming for binary
   *  responses — without it we fall back to MIME/magic detection. */
  contentDisposition?: string;
}

export interface ProxyFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Bypass TLS certificate verification for HTTPS targets. Mirrors cURL
   *  `-k` / `--insecure`. Only honoured when going through the proxy. */
  insecure?: boolean;
  /** Opt in to the proxy's private/loopback host bypass. Needed for
   *  intranet endpoints (10.*, 192.168.*, localhost, .local). Auto-set
   *  by callers that detect a private host in the URL. */
  allowPrivate?: boolean;
  /** Multipart form parts from a cURL `-F` / `--form`. When present,
   *  `body` is ignored and the request is sent as `multipart/form-data`
   *  with a runtime-generated boundary (browser fetch) or a server-side
   *  FormData (proxy path). */
  formParts?: FormPart[];
  /** Attachment bytes for file parts, keyed by field name. Only fields
   *  present here contribute actual bytes — missing ones are sent as a
   *  0-byte file with the recorded filename so the target at least sees
   *  the correct field structure. */
  attachments?: Record<string, Blob>;
}

/** Loose classifier — matches the server-side `isBlockedHost`. Used to
 *  auto-enable `allowPrivate` when the URL is obviously intranet, so the
 *  user isn't forced to check a box for their own LAN box. */
export function isPrivateHost(hostname: string): boolean {
  return (
    /^localhost$/i.test(hostname) ||
    /^127\./.test(hostname) ||
    /^0\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^::1$/.test(hostname) ||
    /^fc[0-9a-f]{2}:/i.test(hostname) ||
    /^fe80:/i.test(hostname) ||
    /\.local$/i.test(hostname)
  );
}

/** Thin re-export so downstream code that imported the old name keeps
 *  working — the canonical implementation lives in `mimeExt.ts`. */
function isBinaryContentType(ct: string): boolean {
  return isBinaryMime(ct);
}

/** ArrayBuffer → base64 string, chunked to avoid `apply(..., huge)`
 *  blowing the call stack on multi-megabyte payloads. */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000; // 32 KiB — well under any stack limit
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

/**
 * Fetch a URL either through the dev proxy (bypasses CORS) or direct.
 * The `opts` extra fields carry over cURL semantics — method, headers,
 * body — so the caller can share this helper between URL-import and
 * cURL-import flows.
 *
 * Proxy-level errors (bad target, network fail, TLS error) throw with a
 * descriptive message. Upstream HTTP errors (401/403/500 from the target)
 * return a normal ProxyResult with `upstreamError: true` so the caller
 * can still display the body.
 */
export async function fetchViaProxyOrDirect(
  url: string,
  opts: ProxyFetchOptions = {},
): Promise<ProxyResult> {
  const proxy = await isProxyAvailable();
  if (proxy) {
    // Auto-relax the SSRF guard when the URL is clearly a private host —
    // the user typed the intranet address themselves, no need to make
    // them tick a box.
    let autoAllowPrivate = false;
    try {
      autoAllowPrivate = isPrivateHost(new URL(url).hostname);
    } catch {
      /* invalid URL — proxy will 400 anyway */
    }
    // Multipart parts are base64-encoded (file bytes) or inline (text)
    // and shipped in the same JSON envelope. The proxy rebuilds a
    // FormData server-side. Text-only requests keep the tiny body-string
    // path — no need to base64 anything.
    const serialisedParts = opts.formParts
      ? await serialiseFormParts(opts.formParts, opts.attachments)
      : undefined;
    // Strip any client-set content-type when we're sending multipart —
    // the proxy will set its own with a fresh boundary.
    const headersOut = { ...(opts.headers ?? {}) };
    if (serialisedParts) {
      for (const k of Object.keys(headersOut)) {
        if (k.toLowerCase() === 'content-type') delete headersOut[k];
      }
    }
    const res = await fetch(`/__proxy?url=${encodeURIComponent(url)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: opts.method ?? 'GET',
        headers: headersOut,
        body: serialisedParts ? undefined : opts.body,
        insecure: !!opts.insecure,
        allowPrivate: !!opts.allowPrivate || autoAllowPrivate,
        formParts: serialisedParts,
      }),
    });
    // If the proxy hits its own error path it uses `sendJson` and never
    // sets `x-proxy-target`. That absence is our signal to throw instead
    // of surfacing the JSON error body as if it were the target's reply.
    const isUpstreamResponse = res.headers.has('x-proxy-target');
    if (!isUpstreamResponse) {
      let msg = `Proxy returned ${res.status}`;
      let hint: string | undefined;
      try {
        const j = (await res.json()) as { error?: string; hint?: string };
        if (j.error) msg = j.error;
        if (j.hint) hint = j.hint;
      } catch {
        /* body wasn't JSON — keep the generic message */
      }
      throw new Error(hint ? `${msg} — ${hint}` : msg);
    }
    return await readResponse(res, {
      viaProxy: true,
      finalUrl: res.headers.get('x-proxy-final-url') ?? url,
    });
  }
  // Direct browser fetch — CORS applies. Method/headers still forwarded
  // in case the target allows them. Non-2xx here is also passed back as a
  // normal result so the caller can display the error body.
  //
  // For multipart, build a native FormData so the browser produces the
  // multipart boundary + content-length. Any content-type in `headers`
  // must be dropped — the browser will set the correct one.
  let directBody: BodyInit | undefined;
  let directHeaders: Record<string, string> | undefined = opts.headers;
  if (opts.formParts) {
    const fd = new FormData();
    for (const part of opts.formParts) {
      if (part.kind === 'text') {
        fd.append(part.name, part.value ?? '');
      } else {
        const blob = opts.attachments?.[part.name];
        if (blob) {
          fd.append(
            part.name,
            new File([blob], part.filename ?? part.name, {
              type: part.contentType ?? blob.type ?? 'application/octet-stream',
            }),
          );
        } else {
          // No bytes attached — send an empty file with the recorded
          // filename so the server still sees the multipart shape.
          fd.append(
            part.name,
            new File([], part.filename ?? part.name, {
              type: part.contentType ?? 'application/octet-stream',
            }),
          );
        }
      }
    }
    directBody = fd;
    if (directHeaders) {
      directHeaders = { ...directHeaders };
      for (const k of Object.keys(directHeaders)) {
        if (k.toLowerCase() === 'content-type') delete directHeaders[k];
      }
    }
  } else {
    directBody = opts.body;
  }
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: directHeaders,
    body: directBody,
    redirect: 'follow',
  });
  return await readResponse(res, { viaProxy: false, finalUrl: res.url });
}

/**
 * Wire format for a multipart part on the proxy's JSON transport. Text
 * parts inline the value; file parts base64 the bytes. Kept flat so
 * the proxy can iterate once and hand each entry straight to FormData.
 */
interface SerialisedFormPart {
  name: string;
  kind: 'text' | 'file';
  value?: string;
  filename?: string;
  contentType?: string;
  /** Base64-encoded bytes for file parts. Empty string when no attachment
   *  was supplied — the proxy still emits the field with 0 bytes so the
   *  target sees the correct shape. */
  base64?: string;
}

/**
 * Convert `formParts` + browser Blobs into the wire shape the proxy
 * expects. File attachments are read once (arrayBuffer → base64) here
 * rather than in the caller to keep the call sites simple.
 */
async function serialiseFormParts(
  parts: FormPart[],
  attachments?: Record<string, Blob>,
): Promise<SerialisedFormPart[]> {
  const out: SerialisedFormPart[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      out.push({
        name: part.name,
        kind: 'text',
        value: part.value ?? '',
        contentType: part.contentType,
      });
    } else {
      const blob = attachments?.[part.name];
      const base64 = blob ? arrayBufferToBase64(await blob.arrayBuffer()) : '';
      out.push({
        name: part.name,
        kind: 'file',
        filename: part.filename ?? part.name,
        contentType: part.contentType ?? blob?.type ?? 'application/octet-stream',
        base64,
      });
    }
  }
  return out;
}

/**
 * Shared response reader — picks text vs. binary based on the declared
 * content-type. Both the proxied and direct paths go through here so a
 * PDF response is handled identically whether or not the dev proxy is
 * mounted.
 */
async function readResponse(
  res: Response,
  meta: { viaProxy: boolean; finalUrl: string },
): Promise<ProxyResult> {
  const contentType = res.headers.get('content-type') ?? '';
  const contentDisposition = res.headers.get('content-disposition') ?? undefined;
  const base: Omit<ProxyResult, 'text' | 'binaryBase64' | 'byteSize'> = {
    status: res.status,
    contentType,
    finalUrl: meta.finalUrl,
    viaProxy: meta.viaProxy,
    upstreamError: res.status >= 400,
    contentDisposition,
  };
  if (isBinaryContentType(contentType)) {
    const buf = await res.arrayBuffer();
    return {
      ...base,
      text: '',
      binaryBase64: arrayBufferToBase64(buf),
      byteSize: buf.byteLength,
    };
  }
  return { ...base, text: await res.text() };
}

/** Convenience overload for the cURL flow. */
export function fetchFromCurl(
  parsed: ParsedCurl,
  attachments?: Record<string, Blob>,
): Promise<ProxyResult> {
  return fetchViaProxyOrDirect(parsed.url, {
    method: parsed.method,
    headers: parsed.headers,
    body: parsed.body,
    insecure: parsed.insecure,
    formParts: parsed.formParts,
    attachments,
  });
}

