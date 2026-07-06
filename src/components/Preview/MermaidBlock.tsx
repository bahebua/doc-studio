/**
 * Renders a single Mermaid diagram inside the Markdown preview.
 *
 * Design notes:
 *   - Mermaid v11 is heavy (~800 KB gz) so we import it dynamically the
 *     first time a diagram appears on the page. Subsequent diagrams reuse
 *     the loaded singleton.
 *   - Every render call needs a unique id — collisions cause blank SVGs.
 *     We use a module-level counter + a hash of the source so re-renders
 *     of the same block don't churn ids.
 *   - The toolbar (copy / download) is marked with `data-ui-only` so the
 *     HTML export step strips it, and lives behind the `paper` prop check
 *     so PDF captures don't include it.
 *   - PNG export re-serializes the rendered SVG and rasterizes it into a
 *     canvas at 3× the intrinsic size — that's visually lossless on
 *     high-DPI displays without ballooning the file into MB territory.
 *   - Theme follows `document.documentElement.classList.contains('dark')`
 *     and re-renders on change via a MutationObserver.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Download,
  FileImage,
  FileCode2,
  FileText,
  Globe,
  AlertTriangle,
} from 'lucide-react';
import { useMermaidTheme } from '@/hooks/useMermaidTheme';
import type { MermaidTheme } from '@/types';

// Lazy-loaded singleton so first-paint isn't punished when the doc has no
// diagrams. `initialized` guards a second `.initialize()` call.
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
let initialized = false;
let currentTheme: MermaidTheme | null = null;

async function loadMermaid(theme: MermaidTheme) {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default);
  }
  const mermaid = await mermaidPromise;
  if (!initialized || currentTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      // `strict` blocks HTML/JS in labels — safe for arbitrary user input.
      securityLevel: 'strict',
      theme,
      // Fonts follow the app; keeps rendered SVGs consistent with the
      // surrounding preview so PDF captures don't look out of place.
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif",
    });
    initialized = true;
    currentTheme = theme;
  }
  return mermaid;
}

// Cheap deterministic id — same source → same id across re-renders so
// mermaid's own internal caches can help us.
function stableId(source: string): string {
  let h = 5381;
  for (let i = 0; i < source.length; i++) {
    h = ((h << 5) + h + source.charCodeAt(i)) | 0;
  }
  return `mmd-${Math.abs(h).toString(36)}`;
}

interface Props {
  code: string;
  /** When true, hides the toolbar (used by the PDF paper mirror). */
  paper?: boolean;
}

interface RenderState {
  status: 'pending' | 'ready' | 'error';
  svg?: string;
  error?: string;
}

export const MermaidBlock = memo(function MermaidBlock({ code, paper }: Props) {
  const source = code.trim();
  const [state, setState] = useState<RenderState>({ status: 'pending' });
  // Diagram theme is user-selectable (auto / default / neutral / dark).
  // `useMermaidTheme` resolves `auto` against the shell dark class and
  // re-subscribes only while `auto` is active, so the observer overhead
  // is zero once the user picks an explicit theme.
  const theme = useMermaidTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const id = useMemo(() => stableId(source + ':' + theme), [source, theme]);

  // Actual render — cancelled via `alive` flag so late completions from a
  // stale source don't overwrite fresh ones.
  useEffect(() => {
    let alive = true;
    setState({ status: 'pending' });
    (async () => {
      try {
        const mermaid = await loadMermaid(theme);
        // `parse` throws with a helpful message on syntax errors before
        // we spend cycles on layout.
        await mermaid.parse(source);
        const { svg } = await mermaid.render(id, source);
        if (!alive) return;
        setState({ status: 'ready', svg });
      } catch (err) {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ status: 'error', error: msg });
      }
    })();
    return () => {
      alive = false;
    };
  }, [source, theme, id]);

  const getSvgElement = useCallback((): SVGSVGElement | null => {
    return containerRef.current?.querySelector('svg') ?? null;
  }, []);

  const serializeSvg = useCallback((): string | null => {
    const svg = getSvgElement();
    if (!svg) return null;
    // Clone to avoid mutating the live DOM (we inline width/height).
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Ensure xmlns is present — mermaid usually adds it, but be defensive
    // so the standalone file opens in any viewer.
    if (!clone.getAttribute('xmlns')) {
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    // Pin dimensions from viewBox so the file has a definite size when
    // opened outside the browser.
    const viewBox = clone.viewBox?.baseVal;
    if (viewBox && !clone.getAttribute('width')) {
      clone.setAttribute('width', String(viewBox.width));
      clone.setAttribute('height', String(viewBox.height));
    }
    return new XMLSerializer().serializeToString(clone);
  }, [getSvgElement]);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke after a tick so Safari doesn't cancel the download.
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }, []);

  const handleCopySource = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source);
    } catch {
      /* clipboard may be blocked in file:// — silent */
    }
  }, [source]);

  const handleCopySvg = useCallback(async () => {
    const svg = serializeSvg();
    if (!svg) return;
    try {
      await navigator.clipboard.writeText(svg);
    } catch {
      /* clipboard may be blocked */
    }
  }, [serializeSvg]);

  const handleDownloadSvg = useCallback(() => {
    const svg = serializeSvg();
    if (!svg) return;
    downloadBlob(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      `diagram-${id}.svg`,
    );
  }, [serializeSvg, downloadBlob, id]);

  const handleDownloadPng = useCallback(async () => {
    const svgString = serializeSvg();
    const svgEl = getSvgElement();
    if (!svgString || !svgEl) return;
    // Use viewBox for intrinsic size; fall back to bounding box.
    const vb = svgEl.viewBox?.baseVal;
    const bbox = svgEl.getBoundingClientRect();
    const width = vb?.width && vb.width > 0 ? vb.width : bbox.width;
    const height = vb?.height && vb.height > 0 ? vb.height : bbox.height;
    // 3× DPI keeps it visually lossless on Retina without exploding size.
    const scale = 3;
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = new Image();
      img.decoding = 'sync';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to rasterize SVG'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D unavailable');
      // Paint background so PNG isn't transparent against dark viewers.
      ctx.fillStyle =
        theme === 'dark' ? 'rgb(15, 23, 42)' /* slate-900 */ : '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const pngBlob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
          'image/png',
        );
      });
      downloadBlob(pngBlob, `diagram-${id}.png`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [serializeSvg, getSvgElement, downloadBlob, id, theme]);

  /**
   * Vector PDF export. `svg2pdf.js` walks the SVG DOM and emits jsPDF
   * vector primitives — the resulting PDF stays crisp at any zoom level,
   * unlike a rasterized SVG->PNG->PDF path. Both libs are dynamic-imported
   * so a doc without diagrams doesn't pay for them. Uses the currently
   * active diagram theme so the exported file matches what the user sees
   * on screen — same principle as the SVG / PNG / HTML buttons.
   */
  const handleDownloadPdf = useCallback(async () => {
    const { renderMermaidToSvg, svgToPdf, downloadBlob: dl } = await import(
      '@/lib/mermaidExport'
    );
    const themedSvg = await renderMermaidToSvg(source, theme, id);
    const blob = await svgToPdf(themedSvg);
    dl(blob, `diagram-${id}.pdf`);
  }, [source, id, theme]);

  /**
   * Standalone HTML export. Embeds the SVG in a minimal, self-contained
   * document that renders identically in any browser, offline. The SVG
   * stays vector (zoomable/printable) and Mermaid source is preserved
   * inside an HTML comment so round-tripping is possible.
   */
  const handleDownloadHtml = useCallback(() => {
    const svg = serializeSvg();
    if (!svg) return;
    const escapedSource = source
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const bg = theme === 'dark' ? '#0f172a' : '#ffffff';
    const fg = theme === 'dark' ? '#e2e8f0' : '#0f172a';
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="generator" content="Doc Studio (Mermaid export)" />
<title>Mermaid diagram ${id}</title>
<style>
  :root { color-scheme: ${theme === 'dark' ? 'dark' : 'light'}; }
  html, body { margin: 0; padding: 0; background: ${bg}; color: ${fg}; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif;
    padding: 24px;
  }
  main { max-width: 100%; }
  svg { max-width: 100%; height: auto; display: block; }
</style>
</head>
<body>
<main>
${svg}
</main>
<!-- Mermaid source (for round-tripping)
${escapedSource}
-->
</body>
</html>`;
    downloadBlob(
      new Blob([html], { type: 'text/html;charset=utf-8' }),
      `diagram-${id}.html`,
    );
  }, [serializeSvg, downloadBlob, id, theme, source]);

  if (state.status === 'error') {
    return (
      <div className="my-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
          <AlertTriangle size={16} />
          <span className="text-sm font-medium">Mermaid diagram error</span>
        </div>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-amber-900 dark:text-amber-200">
          {state.error}
        </pre>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-amber-800 dark:text-amber-300">
            Show source
          </summary>
          <pre className="mt-1 overflow-auto rounded bg-white/60 p-2 text-xs dark:bg-black/30">
            {source}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <figure
      className="mermaid-block my-4"
      data-mermaid-source={source}
      aria-label="Mermaid diagram"
    >
      {!paper && (
        <div
          data-ui-only
          className="mb-1 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 [.mermaid-block:hover_&]:opacity-100"
        >
          <ToolbarButton
            title="Copy Mermaid source"
            onClick={handleCopySource}
            disabled={state.status !== 'ready'}
          >
            <Copy size={14} />
          </ToolbarButton>
          <ToolbarButton
            title="Copy SVG markup"
            onClick={handleCopySvg}
            disabled={state.status !== 'ready'}
          >
            <FileCode2 size={14} />
          </ToolbarButton>
          <ToolbarButton
            title="Download SVG (lossless vector)"
            onClick={handleDownloadSvg}
            disabled={state.status !== 'ready'}
          >
            <Download size={14} />
            <span className="ml-1 text-[10px] uppercase tracking-wider">svg</span>
          </ToolbarButton>
          <ToolbarButton
            title="Download PNG at 3× (visually lossless raster)"
            onClick={handleDownloadPng}
            disabled={state.status !== 'ready'}
          >
            <FileImage size={14} />
            <span className="ml-1 text-[10px] uppercase tracking-wider">png</span>
          </ToolbarButton>
          <ToolbarButton
            title="Download PDF (vector — zoom to any level without pixelation)"
            onClick={handleDownloadPdf}
            disabled={state.status !== 'ready'}
          >
            <FileText size={14} />
            <span className="ml-1 text-[10px] uppercase tracking-wider">pdf</span>
          </ToolbarButton>
          <ToolbarButton
            title="Download standalone HTML (embedded SVG, offline)"
            onClick={handleDownloadHtml}
            disabled={state.status !== 'ready'}
          >
            <Globe size={14} />
            <span className="ml-1 text-[10px] uppercase tracking-wider">html</span>
          </ToolbarButton>
        </div>
      )}
      <div
        ref={containerRef}
        // `dangerouslySetInnerHTML` is safe: `securityLevel: 'strict'` in
        // mermaid strips <script> / raw HTML from the source before render.
        className="mermaid-svg flex justify-center overflow-auto rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
        dangerouslySetInnerHTML={
          state.status === 'ready' && state.svg
            ? { __html: state.svg }
            : { __html: '' }
        }
      >
        {/* Placeholder shown until the async render resolves. */}
      </div>
      {state.status === 'pending' && (
        <div className="mt-1 text-center text-xs text-slate-400">
          Rendering diagram…
        </div>
      )}
    </figure>
  );
});

function ToolbarButton({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 shadow-sm transition hover:border-blue-400 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:text-blue-400"
    >
      {children}
    </button>
  );
}
