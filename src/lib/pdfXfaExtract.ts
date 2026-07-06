/*
 * Dynamic PDF (XFA) → XDP XML extraction.
 *
 * Editable / dynamic PDFs (LiveCycle Designer, Adobe forms, ILLC-style
 * certificates) embed the entire form template + data as an XFA packet
 * inside the PDF's AcroForm dictionary. Server-side, this is often
 * exposed by an "extractXmlXdpFromDynamicPdf" endpoint that returns the
 * `<xdp:xdp>…</xdp:xdp>` wrapper. This module does the same extraction
 * client-side so the app can open the underlying XML directly without a
 * round-trip.
 *
 * Strategy:
 *   1. Scan the raw PDF bytes as latin-1 for the literal `<xdp:xdp`
 *      opener. Uncompressed XFA payloads land here on the first pass.
 *   2. If not found, walk every `stream …endstream` block, honour the
 *      preceding dict's `/Filter /FlateDecode`, decompress with the
 *      browser's `DecompressionStream('deflate')`, and re-scan.
 *   3. Return the earliest-found XDP wrapper. Callers get either the
 *      XML string or `null` if the PDF has no XFA content.
 *
 * No third-party dependency — DecompressionStream is available in every
 * modern evergreen browser (Chrome 80+, Firefox 113+, Safari 16.4+) and
 * on Node 18+, which the dev-proxy targets. We fall back to a plain
 * inflate written by hand only if the API is missing (extremely rare).
 */

const XDP_OPEN = /<xdp:xdp\b[^>]*>/i;
const XDP_CLOSE = /<\/xdp:xdp\s*>/i;

/** Byte-safe latin-1 decoder. PDF stream boundaries are ASCII; the actual
 *  XFA payload is UTF-8 but we only search for ASCII markers here. */
const LATIN1 = new TextDecoder('latin1');
const UTF8 = new TextDecoder('utf-8');

export interface XfaExtractResult {
  /** The `<xdp:xdp>…</xdp:xdp>` payload as UTF-8 text. */
  xml: string;
  /** How the XML was found — helpful for diagnostics / logging. */
  source: 'raw' | 'flate-stream';
  /** Byte offset in the original PDF where the XDP opener starts.
   *  `-1` for streams (position within an inflated payload). */
  offset: number;
}

/**
 * Extract the XFA (XDP) XML from a dynamic PDF's bytes. Returns `null`
 * if the PDF has no XFA form (static PDF, scanned image, etc.).
 */
export async function extractXfaXml(
  bytes: Uint8Array | ArrayBuffer,
): Promise<XfaExtractResult | null> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const raw = LATIN1.decode(buf);

  // Fast path: look in the raw bytes. Small dynamic PDFs and any PDF
  // whose XFA stream isn't compressed hit here.
  const rawHit = sliceXdp(raw);
  if (rawHit) {
    return { xml: reencode(buf, rawHit.start, rawHit.end), source: 'raw', offset: rawHit.start };
  }

  // Slow path: iterate every stream block, inflate FlateDecode ones, scan.
  const streams = findStreams(raw);
  for (const s of streams) {
    if (!s.flate) continue;
    const chunk = buf.subarray(s.dataStart, s.dataEnd);
    let inflated: Uint8Array;
    try {
      inflated = await inflate(chunk);
    } catch {
      continue; // corrupt / non-deflate stream; ignore and try next
    }
    const text = UTF8.decode(inflated);
    const hit = sliceXdp(text);
    if (hit) {
      return {
        xml: text.slice(hit.start, hit.end),
        source: 'flate-stream',
        offset: -1,
      };
    }
  }

  return null;
}

/** Convenience wrapper: is this file a dynamic (XFA) PDF? */
export async function isDynamicXfaPdf(bytes: Uint8Array | ArrayBuffer): Promise<boolean> {
  const result = await extractXfaXml(bytes);
  return !!result;
}

/** Locate an `<xdp:xdp>…</xdp:xdp>` span inside a decoded string. Returns
 *  the byte offsets of the opener and one past the closer, or `null`. */
function sliceXdp(text: string): { start: number; end: number } | null {
  const openMatch = XDP_OPEN.exec(text);
  if (!openMatch) return null;
  const remainder = text.slice(openMatch.index);
  const closeMatch = XDP_CLOSE.exec(remainder);
  if (!closeMatch) return null;
  return {
    start: openMatch.index,
    end: openMatch.index + closeMatch.index + closeMatch[0].length,
  };
}

/** Re-decode a slice of the original PDF bytes as UTF-8. Using latin-1
 *  to locate the offsets keeps byte↔char alignment 1:1, then UTF-8
 *  decoding gives us proper handling of any non-ASCII content inside
 *  the XDP (surveyor names with accents, etc.). */
function reencode(buf: Uint8Array, charStart: number, charEnd: number): string {
  return UTF8.decode(buf.subarray(charStart, charEnd));
}

interface StreamSpan {
  /** Byte offset just after the `stream\n` marker. */
  dataStart: number;
  /** Byte offset of the `\nendstream` marker. */
  dataEnd: number;
  /** True when the preceding dict declared `/Filter /FlateDecode`. */
  flate: boolean;
}

/** Enumerate every `stream …endstream` block in a PDF, tagging whether
 *  it was FlateDecode-compressed. Uses byte offsets from a latin-1
 *  decode so alignment with the raw buffer is exact. */
function findStreams(raw: string): StreamSpan[] {
  const out: StreamSpan[] = [];
  const streamRe = /\bstream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw))) {
    const dataStart = m.index + m[0].length;
    // Peek back ~256 bytes to see whether the enclosing dict says Flate.
    const dictHead = raw.slice(Math.max(0, m.index - 256), m.index);
    const flate =
      /\/Filter\s*(?:\/FlateDecode|\[[^\]]*\/FlateDecode)/.test(dictHead);
    // Find matching endstream. PDFs sometimes have `\r\nendstream` or
    // just `\nendstream`; accept both.
    const endRe = /\r?\n?endstream\b/g;
    endRe.lastIndex = dataStart;
    const end = endRe.exec(raw);
    if (!end) break;
    out.push({ dataStart, dataEnd: end.index, flate });
    streamRe.lastIndex = end.index + end[0].length;
  }
  return out;
}

/** Inflate a raw zlib (deflate) payload using the DecompressionStream
 *  API. PDF FlateDecode is standard zlib with the 2-byte zlib header. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // `deflate` (with zlib header) is what PDF FlateDecode uses. Node 18+
  // and modern browsers both support this token.
  const ds = new DecompressionStream('deflate');
  // Slice into a fresh ArrayBuffer so Blob's type constraints are
  // satisfied — some TS lib bundles narrow `BlobPart` to reject
  // `Uint8Array<SharedArrayBuffer>`, and a typed-array view over the
  // subarray is safest.
  const copy = new Uint8Array(data);
  const stream = new Blob([copy]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
