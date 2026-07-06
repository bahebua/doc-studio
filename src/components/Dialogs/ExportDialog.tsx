import { useEffect, useState } from 'react';
import { FileCode, FileDown, FileText, Loader2, RefreshCw } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useAppStore } from '@/store/useAppStore';
import { buildStandaloneHtml, extractPreviewHtml } from '@/lib/converters/mdToHtml';
import { htmlToMarkdown } from '@/lib/converters/htmlToMd';
import { jsonToXml, xmlToJson } from '@/lib/converters/jsonXml';
import { guessFileExtension } from '@/lib/languageDetect';
import type { Language } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

type HtmlFlavor = 'standalone' | 'embedded' | 'clean';

function sanitizeFilename(name: string): string {
  return (name || 'document').replace(/[^a-z0-9-_.\s]+/gi, '').trim() || 'document';
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success('Copied to clipboard');
}

/**
 * Turn the rendered preview into readable plain text (drops all tags but
 * keeps whitespace and list bullets sensible).
 */
function previewAsPlainText(previewEl: HTMLElement | null): string {
  if (!previewEl) return '';
  const clone = previewEl.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('li').forEach((li) => {
    li.prepend(document.createTextNode('• '));
  });
  clone.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    h.textContent = `\n${h.textContent}\n`;
  });
  return (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Pretty-print an arbitrary JSON string; returns the input on failure. */
function tryPrettyJson(text: string, indent = 2): string {
  try {
    return JSON.stringify(JSON.parse(text), null, indent);
  } catch {
    return text;
  }
}

/**
 * Language-aware export dialog. Layout changes based on the active
 * document's language so we only surface exports that actually make sense:
 *   • markdown → Markdown / HTML / PDF (rendered from the preview).
 *   • html     → HTML source / PDF.
 *   • json     → JSON (pretty or minified) + convert to XML.
 *   • xml      → XML (as-is or pretty) + convert to JSON.
 */
export function ExportDialog({ open, onClose }: Props) {
  const doc = useAppStore((s) => s.document);
  const language: Language = doc.language ?? 'markdown';

  return (
    <Modal open={open} onClose={onClose} title="Export document" wide>
      {(language === 'markdown' || language === 'html') && (
        <RenderableExports doc={doc} language={language} onClose={onClose} />
      )}
      {language === 'json' && <JsonExports doc={doc} />}
      {language === 'xml' && <XmlExports doc={doc} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Markdown / HTML — render-based exports (PDF via print pipeline)
// ---------------------------------------------------------------------------

interface RenderableProps {
  doc: { title: string; content: string };
  language: Language;
  onClose: () => void;
}

function RenderableExports({ doc, language, onClose }: RenderableProps) {
  const [htmlFlavor, setHtmlFlavor] = useState<HtmlFlavor>('standalone');
  const [pageSize, setPageSize] = useState<'a4' | 'letter'>('a4');
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [pageNumbers, setPageNumbers] = useState(true);
  const [busy, setBusy] = useState<null | 'pdf' | 'html' | 'md' | 'to-md'>(null);

  const filenameBase = sanitizeFilename(doc.title);
  const showMarkdown = language === 'markdown';
  const showConvertToMd = language === 'html';

  const getPreviewEl = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('.pdf-page .md-preview') ??
    document.querySelector<HTMLElement>('[data-preview-root] .md-preview') ??
    document.querySelector<HTMLElement>('[data-export-preview] .md-preview');

  const exportMarkdown = () => {
    setBusy('md');
    try {
      // Pick `.tex` when the buffer is clearly LaTeX so users don't get
      // a `.md` file for a document they wrote as `\section{…}`. Other
      // markdown content keeps the standard `.md` extension.
      const ext = guessFileExtension(doc.content, language);
      const mime = ext === 'tex' ? 'application/x-tex' : 'text/markdown';
      download(new Blob([doc.content], { type: mime }), `${filenameBase}.${ext}`);
      toast.success(ext === 'tex' ? 'LaTeX source downloaded' : 'Markdown downloaded');
    } finally {
      setBusy(null);
    }
  };

  /** HTML source → Markdown via turndown. Only exposed for html-language docs. */
  const convertToMarkdown = async () => {
    setBusy('to-md');
    try {
      const md = await htmlToMarkdown(doc.content);
      download(new Blob([md], { type: 'text/markdown' }), `${filenameBase}.md`);
      toast.success('Converted to Markdown');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Could not convert to Markdown');
    } finally {
      setBusy(null);
    }
  };

  const exportHtml = () => {
    setBusy('html');
    try {
      let output: string;
      if (language === 'html') {
        // For raw HTML source, either dump as-is or wrap in a standalone
        // document with our preview styles.
        output = htmlFlavor === 'clean'
          ? doc.content
          : buildStandaloneHtml(doc.content, doc.title, { embedCss: true });
      } else {
        const inner = extractPreviewHtml(getPreviewEl());
        output = htmlFlavor === 'clean'
          ? inner
          : buildStandaloneHtml(inner, doc.title, { embedCss: true });
      }
      download(new Blob([output], { type: 'text/html' }), `${filenameBase}.html`);
      toast.success('HTML downloaded');
    } catch (err) {
      console.error(err);
      toast.error('Could not export HTML');
    } finally {
      setBusy(null);
    }
  };

  const exportPdf = () => {
    const src = getPreviewEl();
    if (!src) {
      toast.error('Nothing to export — the preview is empty.');
      return;
    }

    document.querySelectorAll('.print-only-root').forEach((el) => el.remove());
    document.querySelectorAll('style[data-pdf-print-style]').forEach((el) => el.remove());

    const printRoot = document.createElement('div');
    printRoot.className = 'print-only-root';
    const clone = src.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-ui-only]').forEach((n) => n.remove());
    printRoot.appendChild(clone);
    document.body.appendChild(printRoot);

    const trimmedHeader = headerText.trim();
    const trimmedFooter = footerText.trim();
    const cssStr = (s: string) =>
      s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
    const runFont =
      "9pt -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif";

    const box = (position: string, content: string) =>
      `${position} { content: ${content}; font: ${runFont}; color: #64748b; }`;

    const marginBoxes = [
      box('@top-left', '""'),
      box('@top-center', trimmedHeader ? `"${cssStr(trimmedHeader)}"` : '""'),
      box('@top-right', '""'),
      box('@bottom-left', trimmedFooter ? `"${cssStr(trimmedFooter)}"` : '""'),
      box('@bottom-center', '""'),
      box(
        '@bottom-right',
        pageNumbers ? '"Page " counter(page) " of " counter(pages)' : '""',
      ),
    ];

    const topMm = trimmedHeader ? 20 : 15;
    const bottomMm = trimmedFooter || pageNumbers ? 20 : 15;

    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-pdf-print-style', '');
    styleEl.textContent = `
      @media print {
        @page {
          size: ${pageSize === 'letter' ? 'Letter' : 'A4'} portrait;
          margin: ${topMm}mm 15mm ${bottomMm}mm 15mm;
          ${marginBoxes.join('\n          ')}
        }
      }
    `;
    document.head.appendChild(styleEl);

    const originalTitle = document.title;
    document.title = filenameBase;

    setBusy('pdf');

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      printRoot.remove();
      styleEl.remove();
      document.title = originalTitle;
      window.removeEventListener('afterprint', cleanup);
      setBusy(null);
      onClose();
    };
    window.addEventListener('afterprint', cleanup);
    window.setTimeout(cleanup, 120_000);

    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.print();
      }),
    );
  };

  return (
    <>
      <div
        className={`grid gap-4 ${
          showMarkdown || showConvertToMd ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
        }`}
      >
        {showMarkdown && (
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText size={16} className="text-brand-500" />
              Markdown
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 flex-1">
              Download the raw source as a portable <code>.md</code> file.
            </p>
            <div className="flex flex-col gap-2">
              <Button variant="primary" size="sm" onClick={exportMarkdown} disabled={busy !== null}>
                {busy === 'md' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                Download .md
              </Button>
              <Button size="sm" variant="outline" onClick={() => copy(doc.content)}>
                Copy source
              </Button>
            </div>
          </section>
        )}

        {showConvertToMd && (
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <RefreshCw size={16} className="text-brand-500" />
              Convert to Markdown
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 flex-1">
              Turn this HTML source into GitHub-flavored Markdown via
              turndown. Headings, lists, links, code and tables round-trip
              cleanly.
            </p>
            <div className="flex flex-col gap-2">
              <Button variant="primary" size="sm" onClick={convertToMarkdown} disabled={busy !== null}>
                {busy === 'to-md' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <FileDown size={14} />
                )}
                Download .md
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await copy(await htmlToMarkdown(doc.content));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Could not convert');
                  }
                }}
              >
                Copy as Markdown
              </Button>
            </div>
          </section>
        )}

        <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileCode size={16} className="text-brand-500" />
            HTML
          </div>
          <fieldset className="space-y-1.5 text-xs">
            {(
              [
                ['standalone', 'Standalone (with embedded CSS)'],
                ['embedded', 'HTML with embedded CSS'],
                ['clean', 'Clean HTML fragment only'],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="htmlFlavor"
                  className="accent-brand-500"
                  checked={htmlFlavor === v}
                  onChange={() => setHtmlFlavor(v)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="mt-auto flex flex-col gap-2">
            <Button variant="primary" size="sm" onClick={exportHtml} disabled={busy !== null}>
              {busy === 'html' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
              Download .html
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                copy(
                  language === 'html' ? doc.content : extractPreviewHtml(getPreviewEl()),
                )
              }
            >
              Copy HTML
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileDown size={16} className="text-brand-500" />
            PDF
          </div>
          <div className="text-xs space-y-2">
            <label className="flex items-center justify-between gap-2">
              <span>Page size</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as 'a4' | 'letter')}
                className="h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-night-muted px-2 text-xs"
              >
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
              </select>
            </label>
            <input
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              placeholder="Header (optional)"
              className="w-full h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-night-muted px-2 text-xs outline-none"
            />
            <input
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              placeholder="Footer (optional)"
              className="w-full h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-night-muted px-2 text-xs outline-none"
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-brand-500"
                checked={pageNumbers}
                onChange={(e) => setPageNumbers(e.target.checked)}
              />
              Include page numbers
            </label>
            <p className="text-[10.5px] leading-snug text-slate-500 dark:text-slate-400">
              Uses your browser's print engine — choose <strong>Save as PDF</strong> as the
              destination. Vector text (crisp at any zoom, selectable, searchable).
            </p>
          </div>
          <div className="mt-auto flex flex-col gap-2">
            <Button variant="primary" size="sm" onClick={exportPdf} disabled={busy !== null}>
              {busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
              Save as PDF / Print
            </Button>
          </div>
        </section>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-3">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mr-1">
          Copy as:
        </span>
        {showMarkdown && (
          <Button size="sm" variant="subtle" onClick={() => copy(doc.content)}>
            Markdown
          </Button>
        )}
        <Button
          size="sm"
          variant="subtle"
          onClick={() =>
            copy(
              language === 'html' ? doc.content : extractPreviewHtml(getPreviewEl()),
            )
          }
        >
          HTML
        </Button>
        <Button
          size="sm"
          variant="subtle"
          onClick={() => copy(previewAsPlainText(getPreviewEl()))}
        >
          Plain text
        </Button>
      </div>

      <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
        PDF export uses your browser's print engine — choose <strong>Save as PDF</strong> as
        the destination in the dialog. Switch the preview to <strong>PDF</strong> mode
        (status bar) for the most accurate page-break preview.
      </p>

      <DiagramExports getPreviewEl={getPreviewEl} filenameBase={filenameBase} />
    </>
  );
}

// ---------------------------------------------------------------------------
// JSON — download + convert to XML
// ---------------------------------------------------------------------------

function JsonExports({ doc }: { doc: { title: string; content: string } }) {
  const [busy, setBusy] = useState<null | 'json-pretty' | 'json-min' | 'to-xml'>(null);
  const [xmlRoot, setXmlRoot] = useState('root');
  const filenameBase = sanitizeFilename(doc.title);

  const downloadJson = (minify: boolean) => {
    const key = minify ? 'json-min' : 'json-pretty';
    setBusy(key);
    try {
      const text = minify
        ? JSON.stringify(JSON.parse(doc.content))
        : tryPrettyJson(doc.content);
      download(new Blob([text], { type: 'application/json' }), `${filenameBase}.json`);
      toast.success(minify ? 'JSON downloaded (minified)' : 'JSON downloaded');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Invalid JSON');
    } finally {
      setBusy(null);
    }
  };

  const downloadAsXml = () => {
    setBusy('to-xml');
    try {
      const xml = jsonToXml(doc.content, { rootName: xmlRoot || 'root' });
      download(new Blob([xml], { type: 'application/xml' }), `${filenameBase}.xml`);
      toast.success('Converted to XML');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Could not convert to XML');
    } finally {
      setBusy(null);
    }
  };

  const copyAsXml = async () => {
    try {
      await copy(jsonToXml(doc.content, { rootName: xmlRoot || 'root' }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not convert');
    }
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileCode size={16} className="text-brand-500" />
            JSON
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 flex-1">
            Save this document as a <code>.json</code> file. Pretty-print for
            readability or minify for storage / transport.
          </p>
          <div className="mt-auto flex flex-col gap-2">
            <Button variant="primary" size="sm" onClick={() => downloadJson(false)} disabled={busy !== null}>
              {busy === 'json-pretty' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
              Download .json (pretty)
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadJson(true)} disabled={busy !== null}>
              Download .json (minified)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => copy(doc.content)}>
              Copy source
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <RefreshCw size={16} className="text-brand-500" />
            Convert to XML
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Turn the JSON tree into equivalent XML. Attribute-style keys (
            <code>@id</code>) become XML attributes; <code>#text</code> becomes
            text nodes; arrays become repeated sibling elements.
          </p>
          <label className="text-xs flex items-center justify-between gap-2">
            <span>Root element</span>
            <input
              value={xmlRoot}
              onChange={(e) => setXmlRoot(e.target.value)}
              className="w-32 h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-night-muted px-2 text-xs outline-none"
              placeholder="root"
            />
          </label>
          <div className="mt-auto flex flex-col gap-2">
            <Button variant="primary" size="sm" onClick={downloadAsXml} disabled={busy !== null}>
              {busy === 'to-xml' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
              Download .xml
            </Button>
            <Button size="sm" variant="outline" onClick={copyAsXml}>
              Copy XML
            </Button>
          </div>
        </section>
      </div>
      <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
        JSON ↔ XML conversion is best-effort using standard conventions
        (<code>@attr</code>, <code>#text</code>, repeated tags → arrays). It's
        not designed for XML with mixed content or complex namespaces.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// XML — download + convert to JSON
// ---------------------------------------------------------------------------

function XmlExports({ doc }: { doc: { title: string; content: string } }) {
  const [busy, setBusy] = useState<null | 'xml' | 'to-json'>(null);
  const [indent, setIndent] = useState<'2' | '4' | '0'>('2');
  const filenameBase = sanitizeFilename(doc.title);

  const downloadXml = () => {
    setBusy('xml');
    try {
      download(new Blob([doc.content], { type: 'application/xml' }), `${filenameBase}.xml`);
      toast.success('XML downloaded');
    } finally {
      setBusy(null);
    }
  };

  const downloadAsJson = () => {
    setBusy('to-json');
    try {
      const spaces = parseInt(indent, 10);
      const json = xmlToJson(doc.content, spaces);
      download(new Blob([json], { type: 'application/json' }), `${filenameBase}.json`);
      toast.success('Converted to JSON');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Could not convert to JSON');
    } finally {
      setBusy(null);
    }
  };

  const copyAsJson = async () => {
    try {
      const spaces = parseInt(indent, 10);
      await copy(xmlToJson(doc.content, spaces));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not convert');
    }
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileCode size={16} className="text-brand-500" />
            XML
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 flex-1">
            Save this document as an <code>.xml</code> file exactly as it
            appears in the editor.
          </p>
          <div className="mt-auto flex flex-col gap-2">
            <Button variant="primary" size="sm" onClick={downloadXml} disabled={busy !== null}>
              {busy === 'xml' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
              Download .xml
            </Button>
            <Button size="sm" variant="ghost" onClick={() => copy(doc.content)}>
              Copy source
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <RefreshCw size={16} className="text-brand-500" />
            Convert to JSON
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Turn this XML into JSON. Attributes become <code>@attr</code> keys,
            text nodes become <code>#text</code>, and repeated sibling tags
            become arrays.
          </p>
          <label className="text-xs flex items-center justify-between gap-2">
            <span>Indent</span>
            <select
              value={indent}
              onChange={(e) => setIndent(e.target.value as '2' | '4' | '0')}
              className="h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-night-muted px-2 text-xs"
            >
              <option value="2">2 spaces</option>
              <option value="4">4 spaces</option>
              <option value="0">Minified</option>
            </select>
          </label>
          <div className="mt-auto flex flex-col gap-2">
            <Button variant="primary" size="sm" onClick={downloadAsJson} disabled={busy !== null}>
              {busy === 'to-json' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
              Download .json
            </Button>
            <Button size="sm" variant="outline" onClick={copyAsJson}>
              Copy JSON
            </Button>
          </div>
        </section>
      </div>
      <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
        XML ↔ JSON conversion is best-effort using standard conventions
        (<code>@attr</code>, <code>#text</code>, repeated tags → arrays). It's
        not designed for XML with mixed content or complex namespaces.
      </p>
    </>
  );
}


// ---------------------------------------------------------------------------
// Mermaid diagrams — per-diagram SVG / PNG / PDF (vector) / HTML
// ---------------------------------------------------------------------------

interface DiagramItem {
  index: number;
  source: string;
  liveSvg: string | null;
}

function DiagramExports({
  getPreviewEl,
  filenameBase,
}: {
  getPreviewEl: () => HTMLElement | null;
  filenameBase: string;
}) {
  const [diagrams, setDiagrams] = useState<DiagramItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const preview = getPreviewEl();
    if (!preview) {
      setDiagrams([]);
      return;
    }
    const figs = preview.querySelectorAll<HTMLElement>(
      'figure.mermaid-block[data-mermaid-source]',
    );
    const items: DiagramItem[] = [];
    figs.forEach((fig, i) => {
      const source = fig.getAttribute('data-mermaid-source') || '';
      const svgEl = fig.querySelector('svg');
      items.push({ index: i, source, liveSvg: svgEl ? svgEl.outerHTML : null });
    });
    setDiagrams(items);
  }, [getPreviewEl]);

  if (diagrams.length === 0) return null;

  const currentTheme: 'default' | 'dark' =
    document.documentElement.classList.contains('dark') ? 'dark' : 'default';

  const runExport = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      toast.success('Diagram downloaded');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  const downloadSvg = (d: DiagramItem) =>
    runExport(`svg-${d.index}`, async () => {
      const m = await import('@/lib/mermaidExport');
      if (!d.liveSvg) throw new Error('Diagram not rendered yet');
      const svg = m.normalizeSvgString(d.liveSvg);
      m.downloadBlob(
        new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
        `${filenameBase}-diagram-${d.index + 1}.svg`,
      );
    });

  const downloadPng = (d: DiagramItem) =>
    runExport(`png-${d.index}`, async () => {
      const m = await import('@/lib/mermaidExport');
      if (!d.liveSvg) throw new Error('Diagram not rendered yet');
      const svg = m.normalizeSvgString(d.liveSvg);
      const bg = currentTheme === 'dark' ? 'rgb(15,23,42)' : '#ffffff';
      const png = await m.svgToPng(svg, 3, bg);
      m.downloadBlob(png, `${filenameBase}-diagram-${d.index + 1}.png`);
    });

  const downloadPdf = (d: DiagramItem) =>
    runExport(`pdf-${d.index}`, async () => {
      // PDFs always render in LIGHT theme — dark diagrams look poor on
      // white paper and waste ink when printed.
      const m = await import('@/lib/mermaidExport');
      const svg = await m.renderMermaidToSvg(d.source, 'default', `dlg-${d.index}`);
      const pdf = await m.svgToPdf(svg);
      m.downloadBlob(pdf, `${filenameBase}-diagram-${d.index + 1}.pdf`);
    });

  const downloadHtml = (d: DiagramItem) =>
    runExport(`html-${d.index}`, async () => {
      const m = await import('@/lib/mermaidExport');
      if (!d.liveSvg) throw new Error('Diagram not rendered yet');
      const svg = m.normalizeSvgString(d.liveSvg);
      const html = m.svgToStandaloneHtml(
        svg, d.source, currentTheme, `Diagram ${d.index + 1}`,
      );
      m.downloadBlob(
        new Blob([html], { type: 'text/html;charset=utf-8' }),
        `${filenameBase}-diagram-${d.index + 1}.html`,
      );
    });

  const firstLine = (s: string): string => {
    const line = s.split(/\r?\n/).find((l) => l.trim()) || '';
    return line.trim().slice(0, 80);
  };

  return (
    <section className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold mb-2">
        <FileCode size={16} className="text-brand-500" />
        Diagrams ({diagrams.length})
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        Download each Mermaid diagram individually. PDFs use vector output
        (crisp at any zoom) and are always rendered in <strong>light theme</strong>
        {' '}for a clean white page, regardless of your current app theme.
      </p>
      <ul className="flex flex-col gap-2">
        {diagrams.map((d) => (
          <li
            key={d.index}
            className="flex flex-col gap-1 rounded-lg border border-slate-200 dark:border-slate-700 p-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 text-xs">
              <div className="font-mono text-slate-700 dark:text-slate-200 truncate">
                #{d.index + 1} · {firstLine(d.source) || '(empty)'}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="subtle" onClick={() => downloadSvg(d)} disabled={busy !== null || !d.liveSvg}>SVG</Button>
              <Button size="sm" variant="subtle" onClick={() => downloadPng(d)} disabled={busy !== null || !d.liveSvg}>PNG</Button>
              <Button size="sm" variant="subtle" onClick={() => downloadPdf(d)} disabled={busy !== null}>
                {busy === `pdf-${d.index}` ? <Loader2 size={12} className="animate-spin" /> : 'PDF'}
              </Button>
              <Button size="sm" variant="subtle" onClick={() => downloadHtml(d)} disabled={busy !== null || !d.liveSvg}>HTML</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
