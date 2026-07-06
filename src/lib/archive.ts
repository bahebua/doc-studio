/*
 * Container-archive support (docx / xlsx / pptx / epub / zip).
 *
 * These formats are all ZIP archives with a specific internal layout. We
 * unpack them via JSZip, decode text-like entries as UTF-8, and hand the
 * result to the workspace store which registers a single `Archive` and
 * opens the primary entry as a tab. The sidebar Archive panel then lets
 * the user browse and open any other entry on demand.
 */

import JSZip from 'jszip';
import type { Archive, ArchiveEntry, ArchiveKind, Language } from '@/types';
import { docxToMarkdown } from './converters/docxToMd';
import { xlsxToMarkdown } from './converters/xlsxToMd';
import { pptxToMarkdown } from './converters/pptxToMd';
import { texToMarkdown } from './converters/texToMd';

/** Synthetic path used for the mammoth-rendered DOCX preview. Leading `(`
 *  keeps it near the top when tree entries are sorted alphabetically. */
export const RENDERED_PREVIEW_PATH = '(rendered preview).md';

/** File extensions we treat as ZIP containers. */
const CONTAINER_EXT_TO_KIND: Record<string, ArchiveKind> = {
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  epub: 'epub',
  zip: 'zip',
  tex: 'tex',
  latex: 'tex',
};

/** Primary entry per archive kind — the "main view" opened by default. */
const PRIMARY_PATH: Record<ArchiveKind, string> = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
  epub: 'META-INF/container.xml',
  zip: '', // no default; picked from first text entry
  tex: 'source.tex',
};

/**
 * Language detection from file extension. Anything not in this map is
 * treated as binary (surfaced but not openable in the editor).
 */
const EXT_TO_LANGUAGE: Record<string, Language> = {
  xml: 'xml',
  rels: 'xml', // Office Open XML relationship files
  opf: 'xml',
  ncx: 'xml',
  svg: 'xml',
  // Adobe LiveCycle / XFA payloads are XML wearing a different extension.
  // Extracted-from-PDF XFA lives in `.xdp`; standalone form data can be
  // `.xfd`, `.xfdf`, or `.fdf`. All render fine in the XML editor.
  xdp: 'xml',
  xfd: 'xml',
  xfdf: 'xml',
  fdf: 'xml',
  xhtml: 'html',
  html: 'html',
  htm: 'html',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'markdown', // plain text — markdown editor handles it fine
  css: 'markdown', // no CSS mode registered; render as text via markdown
  js: 'markdown',
  mjs: 'markdown',
  ts: 'markdown',
};

/** Image extensions we inline into a viewable Markdown wrapper. Values are
 *  MIME types used when constructing the data URL. */
const IMAGE_EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** Safety caps to keep the UI responsive on very large archives. Files past
 *  these limits are still surfaced in the tree, but their heavyweight
 *  content (base64 data URLs, mammoth-rendered HTML, huge XML previews)
 *  is skipped so the main thread doesn't stall. */
const MAX_INLINE_IMAGE_BYTES = 3 * 1024 * 1024;    // 3 MB
const MAX_TEXT_PRELOAD_BYTES = 1 * 1024 * 1024;    // 1 MB per entry
const MAX_DOCX_RENDER_BYTES = 8 * 1024 * 1024;     // 8 MB compressed docx

/** Yield control to the event loop every N entries so the UI can paint. */
const YIELD_EVERY = 32;
const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

export function detectArchiveKind(filename: string): ArchiveKind | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  return CONTAINER_EXT_TO_KIND[ext] ?? null;
}

/** Extract an archive from a File / Blob / ArrayBuffer. */
export async function unpackArchive(
  file: File | Blob | ArrayBuffer,
  name: string,
  kind: ArchiveKind,
): Promise<Archive> {
  // `.tex` isn't a zip — it's plain text. We still wrap it in an Archive so
  // it gets the same "source + rendered preview" UI treatment as DOCX.
  if (kind === 'tex') return buildTexArchive(file, name);

  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const entries: ArchiveEntry[] = [];
  const paths = Object.keys(zip.files).sort();
  let processed = 0;
  for (const path of paths) {
    const zipEntry = zip.files[path];
    if (zipEntry.dir) continue;

    // Cooperative yield: unpacking a huge archive can otherwise monopolize
    // the main thread for seconds and freeze the whole UI (including any
    // "Loading…" toast). Every N entries we return control to the browser
    // so it can paint and stay responsive.
    if (++processed % YIELD_EVERY === 0) await yieldToBrowser();

    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const language = EXT_TO_LANGUAGE[ext];
    const imageMime = IMAGE_EXT_MIME[ext];

    // Images: read as base64, wrap in a tiny Markdown doc so the preview
    // pane displays them. Data URL keeps the tab self-contained even after
    // the archive is closed. SVG is handled by the text branch below via
    // its `xml` language mapping so we still get the source view.
    //
    // Oversized images are surfaced as regular binaries (no inlining) —
    // encoding a 20 MB PNG to base64 on the main thread is a UI killer.
    if (imageMime) {
      const rawBytes = await zipEntry.async('uint8array');
      const size = rawBytes.byteLength;
      if (size > MAX_INLINE_IMAGE_BYTES) {
        entries.push({ path, size, isBinary: true });
        continue;
      }
      const b64 = uint8ToBase64(rawBytes);
      const alt = path.split('/').pop() ?? path;
      const content =
        `# ${alt}\n\n` +
        `![${alt}](data:${imageMime};base64,${b64})\n\n` +
        `_${formatSize(size)} · ${path}_\n`;
      entries.push({
        path,
        size,
        language: 'markdown',
        content,
        isImage: true,
      });
      continue;
    }

    const isBinary = !language;
    let content: string | undefined;
    let size = 0;
    if (isBinary) {
      // Read as raw bytes just to know the size — don't keep the blob.
      const bytes = await zipEntry.async('uint8array');
      size = bytes.byteLength;
    } else {
      // Peek at the compressed size first — huge text entries (multi-MB
      // XML from big spreadsheets) shouldn't be preloaded, since react
      // renders can't cope with them. We surface size and mark them
      // openable-on-demand instead.
      const bytes = await zipEntry.async('uint8array');
      size = bytes.byteLength;
      if (size <= MAX_TEXT_PRELOAD_BYTES) {
        content = new TextDecoder('utf-8').decode(bytes);
      } else {
        // Placeholder so the tab is still openable and the user gets a
        // clear explanation instead of a silent no-op click.
        content =
          `# ${path.split('/').pop() ?? path}\n\n` +
          `_This entry is **${formatSize(size)}** — larger than the ` +
          `${formatSize(MAX_TEXT_PRELOAD_BYTES)} preview limit._\n\n` +
          '_Very large text entries are skipped from the initial unpack to ' +
          'keep the editor responsive. The full content stays inside the ' +
          'archive on disk; export the raw file if you need it._\n';
      }
    }

    entries.push({ path, size, language, isBinary: isBinary || undefined, content });
  }

  // Rendered-preview injection for Office formats. Each converter produces
  // a Markdown string that becomes the DEFAULT tab, so users see the
  // readable version first — the raw XML parts stay one click away in the
  // sidebar tree. Also unlocks the standard MD → HTML / PDF export path.
  const rendered = await renderPreviewFor(kind, buffer, zip);
  if (rendered) {
    entries.unshift({
      path: RENDERED_PREVIEW_PATH,
      size: new TextEncoder().encode(rendered).byteLength,
      language: 'markdown',
      content: rendered,
      isRendered: true,
    });
  }

  const preferred =
    entries.some((e) => e.isRendered)
      ? RENDERED_PREVIEW_PATH
      : PRIMARY_PATH[kind];
  const primary =
    entries.find((e) => e.path === preferred) ??
    entries.find((e) => !e.isBinary);

  return {
    id: makeArchiveId(),
    name,
    kind,
    entries,
    primaryPath: primary?.path,
  };
}

/**
 * Route each supported Office kind to its dedicated rendered-preview
 * converter. Errors are swallowed here — a preview failure must never
 * block the archive from opening, since the user can still browse the
 * raw parts in the sidebar tree.
 */
async function renderPreviewFor(
  kind: ArchiveKind,
  buffer: ArrayBuffer,
  zip: JSZip,
): Promise<string | null> {
  try {
    if (kind === 'docx') {
      // Guard against enormous docx files (image-heavy reports, scanned
      // PDFs saved as .docx). Mammoth runs synchronously on the main
      // thread, so a 30 MB file freezes the tab for many seconds.
      if (buffer.byteLength > MAX_DOCX_RENDER_BYTES) {
        return (
          '# Rendered preview skipped\n\n' +
          `This document is **${formatSize(buffer.byteLength)}** — larger than ` +
          `the ${formatSize(MAX_DOCX_RENDER_BYTES)} auto-render limit. ` +
          'Open `word/document.xml` from the Archive sidebar to inspect the ' +
          'raw source, or split the document and reopen a smaller portion.\n'
        );
      }
      return await docxToMarkdown(buffer);
    }
    if (kind === 'xlsx') return await xlsxToMarkdown(zip);
    if (kind === 'pptx') return await pptxToMarkdown(zip);
    return null;
  } catch (err) {
    console.warn(`[archive] ${kind} → markdown render failed:`, err);
    return null;
  }
}

/**
 * Encode a Uint8Array to base64 in fixed-size chunks. The naïve
 * `btoa(String.fromCharCode(...bytes))` version blows the JS stack for
 * anything over ~100 KB, so we stream through in 32 KB windows.
 */
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      // Uint8Array subarray shares memory — cheap slice for the apply call.
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}

function makeArchiveId(): string {
  return (
    (crypto as unknown as { randomUUID?: () => string }).randomUUID?.() ??
    `arc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

/**
 * Build an Archive from a single `.tex` file. LaTeX documents aren't ZIPs
 * — we synthesize two entries so the UX matches Office formats:
 *   1. The Markdown-rendered preview (default active tab).
 *   2. The raw `.tex` source, opened as an XML-highlighted document so
 *      backslash commands read nicely in CodeMirror.
 * The user gets the same "readable view + source view" pattern with no
 * new UI concept to learn.
 */
async function buildTexArchive(
  file: File | Blob | ArrayBuffer,
  name: string,
): Promise<Archive> {
  const source =
    file instanceof ArrayBuffer
      ? new TextDecoder('utf-8').decode(new Uint8Array(file))
      : await (file as Blob).text();
  const sourceSize = new TextEncoder().encode(source).byteLength;

  let rendered: string;
  try {
    rendered = texToMarkdown(source);
  } catch (err) {
    console.warn('[archive] tex → markdown render failed:', err);
    rendered =
      '# Rendered preview unavailable\n\n' +
      '_Could not convert this LaTeX source to Markdown. The raw file is ' +
      'available under `source.tex` in the sidebar._\n';
  }

  const entries: ArchiveEntry[] = [
    {
      path: RENDERED_PREVIEW_PATH,
      size: new TextEncoder().encode(rendered).byteLength,
      language: 'markdown',
      content: rendered,
      isRendered: true,
    },
    {
      path: 'source.tex',
      size: sourceSize,
      // Route the raw TeX source through the Markdown preview pipeline —
      // `MarkdownPreview` auto-detects LaTeX via `looksLikeLatexDocument`
      // and hands it to latex.js. Previously this was tagged `'xml'`,
      // which sent the file into `SourcePreview` where DOMParser choked
      // on the very first `\` character ("Start tag expected, '<' not
      // found"). Markdown-language keeps CodeMirror syntax reasonable
      // and unlocks the full LaTeX preview + configurable style panel.
      language: 'markdown',
      content: source,
    },
  ];

  return {
    id: makeArchiveId(),
    name,
    kind: 'tex',
    entries,
    primaryPath: RENDERED_PREVIEW_PATH,
  };
}

/** Human-friendly byte count. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
