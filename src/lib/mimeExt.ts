/*
 * MIME-type and extension helpers shared by the cURL preview, cURL
 * import, archive panel, and any future response-handling code path.
 *
 * The core problem this file solves: HTTP responses come with a MIME
 * type that MAY or MAY NOT be trustworthy, sometimes with a
 * `Content-Disposition: attachment; filename="thing.zip"` header, and
 * sometimes with neither. If we save every unknown binary as `.bin`
 * the user is stuck (browsers won't preview it, our archive panel
 * treats it as opaque). Instead we look at four signals in order:
 *
 *   1. `Content-Disposition` filename — server said what to call it
 *   2. MIME → extension mapping — covers the standard formats
 *   3. Magic bytes at the start of the payload — catches misdeclared
 *      responses (e.g. `application/octet-stream` for a real ZIP)
 *   4. URL path last-segment extension — final fallback
 *
 * All of these are cheap. Magic-byte detection reads the first ~8
 * bytes only (base64-decoded on the fly to avoid touching the full
 * payload).
 */

/** Canonical MIME → extension map. Only well-known formats — obscure
 *  ones fall through to the magic-byte / URL branches. */
const MIME_TO_EXT: Record<string, string> = {
  // Documents
  'application/pdf': 'pdf',
  'application/json': 'json',
  'application/ld+json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/xhtml+xml': 'html',
  'text/html': 'html',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/yaml': 'yaml',
  'application/yaml': 'yaml',
  'application/x-yaml': 'yaml',

  // Adobe LiveCycle / XFA / XDP — treat as XML for the editor since
  // that's what the payload actually is on the wire.
  'application/vnd.adobe.xdp+xml': 'xdp',
  'application/vnd.adobe.xfd+xml': 'xfd',
  'application/vnd.adobe.xfdf': 'xfdf',
  'application/vnd.fdf': 'fdf',

  // Archives
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/x-zip': 'zip',
  'application/gzip': 'gz',
  'application/x-gzip': 'gz',
  'application/x-tar': 'tar',
  'application/x-7z-compressed': '7z',
  'application/x-rar-compressed': 'rar',
  'application/vnd.rar': 'rar',

  // Office / OOXML
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/epub+zip': 'epub',

  // Images
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

/** Extension → default MIME. Used when we know the extension (e.g. from
 *  Content-Disposition) but the server didn't set a useful MIME. */
const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  json: 'application/json',
  xml: 'application/xml',
  xdp: 'application/vnd.adobe.xdp+xml',
  xfd: 'application/vnd.adobe.xfd+xml',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  epub: 'application/epub+zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

/** Return true when the MIME type describes bytes that should never be
 *  fed to the text editor (base64ing them keeps the payload intact). */
export function isBinaryMime(mime: string): boolean {
  const t = normalizeMime(mime);
  if (!t) return false;
  // Anything already mapped to a known binary extension.
  if (t === 'application/pdf') return true;
  if (t === 'application/octet-stream') return true;
  if (t.startsWith('image/') && t !== 'image/svg+xml') return true;
  if (t.startsWith('audio/')) return true;
  if (t.startsWith('video/')) return true;
  if (t.startsWith('font/')) return true;
  // Zip family (includes docx / xlsx / pptx / epub / odt).
  if (
    t === 'application/zip' ||
    t === 'application/x-zip-compressed' ||
    t === 'application/x-zip' ||
    t === 'application/gzip' ||
    t === 'application/x-gzip' ||
    t === 'application/x-tar' ||
    t === 'application/x-7z-compressed' ||
    t === 'application/x-rar-compressed' ||
    t === 'application/vnd.rar' ||
    t === 'application/epub+zip' ||
    t.startsWith('application/vnd.openxmlformats-officedocument.') ||
    t.startsWith('application/vnd.oasis.opendocument.') ||
    t === 'application/msword' ||
    t === 'application/vnd.ms-excel' ||
    t === 'application/vnd.ms-powerpoint'
  ) {
    return true;
  }
  return false;
}

/** Lowercase, strip parameters (`; charset=utf-8`), trim. */
export function normalizeMime(mime: string | null | undefined): string {
  return (mime ?? '').toLowerCase().split(';')[0].trim();
}

/** Direct MIME → extension lookup; empty string on miss. */
export function extFromMime(mime: string): string {
  return MIME_TO_EXT[normalizeMime(mime)] ?? '';
}

/** Extension → MIME lookup; falls back to `application/octet-stream`. */
export function mimeFromExt(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase().replace(/^\./, '')] ?? 'application/octet-stream';
}

/**
 * Parse a `Content-Disposition` header for a `filename` (or the
 * RFC 5987 `filename*` variant with encoding). Returns just the
 * basename — path segments and any dodgy characters are stripped
 * to keep the value safe as a filesystem key.
 */
export function filenameFromContentDisposition(header: string | null | undefined): string {
  if (!header) return '';
  // filename*=UTF-8''encoded-name (RFC 5987) — preferred when present.
  const star = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (star) {
    const raw = star[1].trim().replace(/^"|"$/g, '');
    // Format is <charset>'<lang>'<pct-encoded>
    const m = /^[^']*'[^']*'(.*)$/.exec(raw);
    if (m) {
      try {
        return sanitizeBasename(decodeURIComponent(m[1]));
      } catch {
        return sanitizeBasename(m[1]);
      }
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  if (plain) return sanitizeBasename(plain[1]);
  return '';
}

/** Strip path segments and unsafe filesystem chars — keep only the leaf. */
function sanitizeBasename(name: string): string {
  const leaf = name.replace(/\\/g, '/').split('/').pop() ?? '';
  return leaf
    .trim()
    .replace(/[\x00-\x1f]/g, '')
    .replace(/[<>:"|?*]/g, '_');
}

/**
 * Sniff the first few bytes of a base64 payload for well-known magic
 * numbers. Returns a canonical extension or empty string on no match.
 *
 * We only decode the first 12 bytes — cheap even for multi-MB blobs.
 */
export function magicExt(base64: string): string {
  if (!base64) return '';
  // Base64 encodes 3 bytes per 4 chars — 16 chars ≈ 12 bytes is plenty.
  const head = base64.slice(0, 16);
  let bin: string;
  try {
    bin = atob(head);
  } catch {
    return '';
  }
  const code = (i: number) => bin.charCodeAt(i);
  // PDF: %PDF
  if (bin.startsWith('%PDF')) return 'pdf';
  // ZIP (and all zip-based formats): PK\x03\x04 or PK\x05\x06 (empty) / PK\x07\x08 (spanned)
  if (
    code(0) === 0x50 &&
    code(1) === 0x4b &&
    (code(2) === 0x03 || code(2) === 0x05 || code(2) === 0x07) &&
    (code(3) === 0x04 || code(3) === 0x06 || code(3) === 0x08)
  ) {
    return 'zip';
  }
  // GZIP: \x1f\x8b
  if (code(0) === 0x1f && code(1) === 0x8b) return 'gz';
  // 7Z: 37 7A BC AF 27 1C
  if (
    code(0) === 0x37 &&
    code(1) === 0x7a &&
    code(2) === 0xbc &&
    code(3) === 0xaf &&
    code(4) === 0x27 &&
    code(5) === 0x1c
  ) {
    return '7z';
  }
  // RAR: 52 61 72 21 1A 07
  if (
    code(0) === 0x52 &&
    code(1) === 0x61 &&
    code(2) === 0x72 &&
    code(3) === 0x21
  ) {
    return 'rar';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    code(0) === 0x89 &&
    code(1) === 0x50 &&
    code(2) === 0x4e &&
    code(3) === 0x47
  ) {
    return 'png';
  }
  // JPEG: FF D8 FF
  if (code(0) === 0xff && code(1) === 0xd8 && code(2) === 0xff) return 'jpg';
  // GIF: 47 49 46 38
  if (
    code(0) === 0x47 &&
    code(1) === 0x49 &&
    code(2) === 0x46 &&
    code(3) === 0x38
  ) {
    return 'gif';
  }
  return '';
}

/** Extract just the extension (lowercased, no dot) from a URL path,
 *  ignoring query string and fragment. Empty when none. */
export function extFromUrl(url: string): string {
  const path = url.split('?')[0].split('#')[0];
  const leaf = path.split('/').pop() ?? '';
  const dot = leaf.lastIndexOf('.');
  if (dot <= 0 || dot === leaf.length - 1) return '';
  return leaf.slice(dot + 1).toLowerCase();
}

/**
 * Given all four signals, pick the best extension for a saved response.
 * Priority: filename from Content-Disposition → MIME map → magic bytes
 * → URL extension → 'bin' fallback.
 *
 * Also returns the corresponding filename (when Content-Disposition
 * supplied one) and the effective MIME type.
 */
export interface ResolvedResponseFormat {
  /** Extension without leading dot (e.g. `zip`, `pdf`, `xml`). */
  ext: string;
  /** Full basename if the server suggested one via Content-Disposition. */
  suggestedFilename: string;
  /** MIME type — either the one the server sent or one inferred from
   *  extension/magic when the server sent nothing useful. */
  mime: string;
}

export function resolveResponseFormat(opts: {
  url: string;
  contentType: string;
  contentDisposition?: string;
  base64Body?: string;
}): ResolvedResponseFormat {
  const disp = filenameFromContentDisposition(opts.contentDisposition);
  const dispExt = disp ? extOfBasename(disp) : '';
  const mimeExt = extFromMime(opts.contentType);
  const magic = opts.base64Body ? magicExt(opts.base64Body) : '';
  const urlExt = extFromUrl(opts.url);

  // Confidence order: explicit disposition > mime map > magic > url.
  const ext = dispExt || mimeExt || magic || urlExt || 'bin';
  const mime =
    normalizeMime(opts.contentType) ||
    (ext ? mimeFromExt(ext) : 'application/octet-stream');
  return { ext, suggestedFilename: disp, mime };
}

function extOfBasename(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}
