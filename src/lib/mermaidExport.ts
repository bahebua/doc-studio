/**
 * Reusable Mermaid export helpers. Both the per-diagram hover toolbar
 * (`MermaidBlock`) and the main Export dialog use these so behaviour
 * stays identical across surfaces. The caller supplies the theme so the
 * on-screen preview and any exported file can render with the same
 * palette (or a different one, if the caller has a reason to override).
 */
import type mermaidLib from 'mermaid';
import type { MermaidTheme } from '@/types';

// Reuse the same singleton the on-page component uses. Passing the
// preferred theme explicitly lets the caller override the live app
// theme if it ever needs to.
let mermaidPromise: Promise<typeof mermaidLib> | null = null;
let lastAppliedTheme: MermaidTheme | null = null;

async function getMermaid(theme: MermaidTheme) {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default);
  }
  const mermaid = await mermaidPromise;
  if (lastAppliedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif",
    });
    lastAppliedTheme = theme;
  }
  return mermaid;
}

/** Render mermaid source into an SVG string using the requested theme. */
export async function renderMermaidToSvg(
  source: string,
  theme: MermaidTheme,
  idHint = 'exp',
): Promise<string> {
  const mermaid = await getMermaid(theme);
  // Unique id per call — mermaid stashes DOM state under this key.
  const id = `${idHint}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await mermaid.parse(source);
  const { svg } = await mermaid.render(id, source);
  return svg;
}

/** Ensure a serialized SVG has xmlns + explicit width/height for standalone use. */
export function normalizeSvgString(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement as unknown as SVGSVGElement;
  if (!root.getAttribute('xmlns')) {
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  const vb = root.getAttribute('viewBox');
  if (vb && !root.getAttribute('width')) {
    const [, , w, h] = vb.split(/\s+/).map(Number);
    if (w && h) {
      root.setAttribute('width', String(w));
      root.setAttribute('height', String(h));
    }
  }
  return new XMLSerializer().serializeToString(root);
}

/** Rasterize an SVG string to PNG at N× DPI. `bg` fills transparent areas. */
export async function svgToPng(
  svg: string,
  scale = 3,
  bg = '#ffffff',
): Promise<Blob> {
  const url = URL.createObjectURL(
    new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
  );
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to rasterize SVG'));
      img.src = url;
    });
    // Get intrinsic dimensions from the SVG itself.
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = parsed.documentElement as unknown as SVGSVGElement;
    const vb = root.getAttribute('viewBox')?.split(/\s+/).map(Number);
    const width =
      (vb && vb[2]) || Number(root.getAttribute('width')) || img.naturalWidth;
    const height =
      (vb && vb[3]) || Number(root.getAttribute('height')) || img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Convert an SVG string to a vector PDF via svg2pdf + jsPDF.
 * PDF stays crisp at any zoom level — no pixelation.
 */
export async function svgToPdf(svg: string): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
  ]);
  // svg2pdf needs a live SVG element, not a string.
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-99999px';
  wrapper.style.top = '0';
  wrapper.style.visibility = 'hidden';
  wrapper.innerHTML = svg;
  document.body.appendChild(wrapper);
  try {
    const svgEl = wrapper.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) throw new Error('SVG element not found after parse');
    const vb = svgEl.viewBox?.baseVal;
    const bbox = svgEl.getBoundingClientRect();
    const width = vb?.width && vb.width > 0 ? vb.width : bbox.width || 800;
    const height = vb?.height && vb.height > 0 ? vb.height : bbox.height || 600;
    const orientation = width >= height ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
      orientation,
      unit: 'pt',
      format: [width, height],
      compress: true,
    });
    await svg2pdf(svgEl, pdf, { x: 0, y: 0, width, height });
    return pdf.output('blob');
  } finally {
    wrapper.remove();
  }
}

/**
 * Build a standalone HTML file that embeds the SVG. Theme controls the
 * background so the offline file matches the palette the diagram was
 * rendered with (dark SVG on dark background, light on light).
 */
export function svgToStandaloneHtml(
  svg: string,
  source: string,
  theme: MermaidTheme,
  title: string,
): string {
  const escapedSource = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const bg = theme === 'dark' ? '#0f172a' : '#ffffff';
  const fg = theme === 'dark' ? '#e2e8f0' : '#0f172a';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="generator" content="Doc Studio (Mermaid export)" />
<title>${title.replace(/[<>&]/g, '')}</title>
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
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
