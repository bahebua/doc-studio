/**
 * PDF export. Loaded on demand.
 *
 * Strategy: render the caller's HTML once into an off-screen paper container
 * that reuses the app's own `.pdf-page` + `.md-preview` styling, then
 * capture it **one PDF page at a time** by scrolling the content inside a
 * page-sized clipped viewport with `transform: translateY(...)`.
 *
 * Why per-page capture instead of one giant canvas?
 *   - Browsers cap `<canvas>` at ~32,767 px on any dimension (Chromium; less
 *     on Safari/Firefox). A ~50-page document at `scale: 2` would need a
 *     canvas well past that limit, and `html2canvas` returns a *blank*
 *     canvas of the requested size when the limit is exceeded — with no
 *     error. That's the "N blank pages" bug.
 *   - Per-page capture keeps every canvas ~1600 × 2250 px (safe for all
 *     browsers) and lets us composite native PDF text (header/footer/page
 *     numbers) on top of each page.
 */
export interface PdfExportOptions {
  filename: string;
  pageSize?: 'a4' | 'letter';
  margin?: number; // in mm — unused (paper has its own 20mm/18mm padding);
                    // kept for API compatibility.
  headerText?: string;
  footerText?: string;
  pageNumbers?: boolean;
}

/**
 * Wait until the browser has laid out and painted the target, and all fonts
 * and images inside it have finished loading. Without this, html2canvas
 * often captures a blank or half-rendered snapshot.
 */
async function waitForLayout(target: HTMLElement): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* not fatal */
    }
  }
  const images = Array.from(target.querySelectorAll('img'));
  await Promise.all(
    images.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      });
    }),
  );
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Wait one paint cycle after a style change so the browser reflows.
 * Used between per-page transform updates so html2canvas captures the
 * newly-scrolled position, not the previous one.
 */
async function nextPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

// A4 dimensions in CSS pixels at 96 DPI. Every capture works in these units.
const MM_PER_INCH = 25.4;
const CSS_DPI = 96;
const MM_TO_PX = CSS_DPI / MM_PER_INCH; // ≈ 3.7795
const A4_WIDTH_PX = Math.round(210 * MM_TO_PX); // 794
const A4_HEIGHT_PX = Math.round(297 * MM_TO_PX); // 1123
const LETTER_WIDTH_PX = Math.round(215.9 * MM_TO_PX); // 816
const LETTER_HEIGHT_PX = Math.round(279.4 * MM_TO_PX); // 1056

interface RenderHost {
  host: HTMLElement;
  scroller: HTMLElement;
  paper: HTMLElement;
}

/**
 * Build the render host — a fixed-size page-sized viewport with
 * `overflow: hidden`, containing an absolutely-positioned scroller whose
 * transform we mutate between captures to expose successive pages.
 *
 * Layout:
 *   <div host width=W height=H overflow:hidden>       ← what html2canvas rasterises
 *     <div scroller position:absolute top:0 left:0>   ← translated per page
 *       <div class="pdf-page">                        ← full content, natural height
 *         <div class="md-preview">{html}</div>
 *       </div>
 *     </div>
 *   </div>
 */
function buildRenderHost(
  html: string,
  pageWidthPx: number,
  pageHeightPx: number,
): RenderHost {
  const host = document.createElement('div');
  host.setAttribute('data-pdf-render-host', '');
  host.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    `width:${pageWidthPx}px`,
    `height:${pageHeightPx}px`,
    'overflow:hidden',
    'background:#ffffff',
    'color-scheme:light',
    'z-index:2147483645',
    'pointer-events:none',
    'contain:layout paint',
  ].join(';');

  const scroller = document.createElement('div');
  scroller.setAttribute('data-pdf-scroller', '');
  scroller.style.cssText = [
    'position:absolute',
    'top:0',
    'left:0',
    'width:100%',
    'transform:translateY(0)',
    'will-change:transform',
  ].join(';');

  // Reuse the app's own paper class + preview class so the capture inherits
  // the same typography / prose rules as the on-screen PDF preview.
  const paper = document.createElement('div');
  paper.className = 'pdf-page';
  paper.style.cssText = [
    'box-shadow:none',
    'border-radius:0',
    'margin:0',
    'min-height:auto',
    'width:100%',
    'padding:20mm 18mm',
  ].join(';');

  const preview = document.createElement('div');
  preview.className = 'md-preview';
  preview.innerHTML = html;
  paper.appendChild(preview);

  scroller.appendChild(paper);
  host.appendChild(scroller);
  return { host, scroller, paper };
}

/**
 * Fullscreen "Generating PDF…" overlay that visually covers the render host
 * during capture. Sits *above* the host so users never see the paper flash;
 * `ignoreElements` tells html2canvas to skip it.
 */
function buildCaptureBackdrop(): HTMLElement {
  const bd = document.createElement('div');
  bd.setAttribute('data-pdf-capture-backdrop', '');
  bd.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483646',
    'background:rgba(15,23,42,0.72)',
    'backdrop-filter:blur(4px)',
    '-webkit-backdrop-filter:blur(4px)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'color:#f8fafc',
    'font:500 14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif',
    'letter-spacing:0.02em',
    'user-select:none',
  ].join(';');
  bd.textContent = 'Generating PDF…';
  return bd;
}

/**
 * Export the given rendered HTML to a PDF file.
 *
 * @param html  The inner HTML of the rendered Markdown preview.
 * @param opts  Export options (filename, page size, header/footer, page numbers).
 */
export async function exportHtmlToPdf(
  html: string,
  opts: PdfExportOptions,
): Promise<void> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);

  const isA4 = (opts.pageSize ?? 'a4') === 'a4';
  const pageWidthPx = isA4 ? A4_WIDTH_PX : LETTER_WIDTH_PX;
  const pageHeightPx = isA4 ? A4_HEIGHT_PX : LETTER_HEIGHT_PX;

  const { host, scroller, paper } = buildRenderHost(html, pageWidthPx, pageHeightPx);
  const backdrop = buildCaptureBackdrop();
  document.body.appendChild(host);
  document.body.appendChild(backdrop);

  // If the app is in dark mode, `<html class="dark">` cascades `dark:*`
  // variants into our render host — `dark:prose-invert` turns text near-white
  // on white paper. Temporarily strip the class; the backdrop hides the flash.
  const htmlEl = document.documentElement;
  const hadDarkClass = htmlEl.classList.contains('dark');
  if (hadDarkClass) htmlEl.classList.remove('dark');

  try {
    // Force any Mermaid diagrams in the cloned paper to be re-rendered
    // with the LIGHT theme. The originals in the live preview may have
    // been rendered while the app was dark, which produces near-white
    // strokes on white PDF pages. We locate each `figure.mermaid-block`
    // (which carries the original source in `data-mermaid-source`), swap
    // its inner SVG for a light-theme render, and only then run
    // html2canvas.
    await rerenderMermaidForLight(paper);
    await waitForLayout(paper);

    const totalHeightPx = paper.scrollHeight;
    const numPages = Math.max(1, Math.ceil(totalHeightPx / pageHeightPx));

    // eslint-disable-next-line no-console
    console.debug(
      '[pdf-export] paper',
      paper.scrollWidth,
      'x',
      totalHeightPx,
      '→',
      numPages,
      'pages of',
      pageWidthPx,
      'x',
      pageHeightPx,
    );

    const pdf = new jsPDF({
      unit: 'mm',
      format: opts.pageSize ?? 'a4',
      orientation: 'portrait',
      compress: true,
    });

    const pageWidthMm = pdf.internal.pageSize.getWidth();
    const pageHeightMm = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < numPages; i++) {
      // Scroll the content so page `i` is at the top of the clipped host.
      scroller.style.transform = `translateY(${-i * pageHeightPx}px)`;
      await nextPaint();

      const pageCanvas = await html2canvas(host, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: pageWidthPx,
        height: pageHeightPx,
        windowWidth: pageWidthPx,
        windowHeight: pageHeightPx,
        // Skip the capture backdrop — we don't want it in the PDF.
        ignoreElements: (el) => el.hasAttribute('data-pdf-capture-backdrop'),
      });

      if (i > 0) pdf.addPage();

      // JPEG at 0.92 keeps file sizes reasonable while text stays crisp.
      const imgData = pageCanvas.toDataURL('image/jpeg', 0.92);
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
    }

    // Header / footer / page numbers as *native* PDF text so they are:
    //   (a) crisp regardless of image scale,
    //   (b) selectable & searchable in the PDF, and
    //   (c) consistent on every page (unlike an inline <div> which would
    //       only appear on the first / last captured page).
    const total = pdf.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      pdf.setPage(i);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(120);

      if (opts.headerText) {
        pdf.text(opts.headerText, pageWidthMm / 2, 9, { align: 'center' });
      }
      if (opts.footerText) {
        pdf.text(opts.footerText, pageWidthMm / 2, pageHeightMm - 9, {
          align: 'center',
        });
      }
      if (opts.pageNumbers) {
        pdf.text(
          `Page ${i} of ${total}`,
          pageWidthMm - 12,
          pageHeightMm - 9,
          { align: 'right' },
        );
      }
    }

    pdf.save(opts.filename);
  } finally {
    if (hadDarkClass) htmlEl.classList.add('dark');
    host.remove();
    backdrop.remove();
  }
}

/**
 * Locate every Mermaid diagram inside the offscreen paper and swap its
 * inner SVG for a fresh render using mermaid's light `default` theme so
 * the PDF page (white background) reads well and prints without wasting
 * ink. Silently no-ops when the doc has no diagrams so we don't pull
 * mermaid in unnecessarily.
 */
async function rerenderMermaidForLight(root: HTMLElement): Promise<void> {
  const figures = root.querySelectorAll<HTMLElement>(
    'figure.mermaid-block[data-mermaid-source]',
  );
  if (figures.length === 0) return;
  const { renderMermaidToSvg } = await import('../mermaidExport');
  for (let i = 0; i < figures.length; i++) {
    const fig = figures[i];
    const source = fig.getAttribute('data-mermaid-source') || '';
    if (!source) continue;
    try {
      const svg = await renderMermaidToSvg(source, 'default', `pdf-${i}`);
      const holder = fig.querySelector<HTMLElement>('.mermaid-svg');
      if (holder) holder.innerHTML = svg;
    } catch {
      // If a diagram fails to re-render, leave the original in place —
      // still better than nothing on the PDF page.
    }
  }
}
