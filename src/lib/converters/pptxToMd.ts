/*
 * PPTX (PowerPoint Open XML) → Markdown preview.
 *
 * PPTX is much harder to render faithfully than DOCX/XLSX (layouts,
 * masters, positioned shapes, animations, media). For a *preview* what
 * users actually want is the text content in slide order, which is
 * straightforward: every text run lives inside an `<a:t>` element inside
 * an `<a:p>` paragraph inside an `<p:sp>` shape on `ppt/slides/slideN.xml`.
 *
 * Output: `## Slide N` heading per slide, followed by each paragraph as
 * either a heading (if it's the first paragraph of the title placeholder)
 * or a paragraph. Empty slides are surfaced so slide numbering stays true.
 */

import type JSZip from 'jszip';

function slideNumber(path: string): number {
  return parseInt(path.match(/slide(\d+)\.xml$/i)?.[1] ?? '0', 10);
}

/**
 * Extract paragraphs from a slide XML. Each shape's paragraphs contribute
 * one string; empty paragraphs (visual whitespace) are dropped. The order
 * of shapes on disk is the reading order after applying slide layout —
 * which is close enough for a text preview and matches what the user sees
 * when they Tab through the slide.
 */
function parseSlideParagraphs(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return [];
  const paragraphs = Array.from(doc.getElementsByTagNameNS('*', 'p'));
  const out: string[] = [];
  for (const p of paragraphs) {
    const runs = Array.from(p.getElementsByTagNameNS('*', 't'));
    const text = runs.map((t) => t.textContent ?? '').join('').trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * Build a full Markdown preview of a .pptx deck. Slides that contain no
 * extractable text render as `_(no text)_` so the reader can still see how
 * many slides the deck has.
 */
export async function pptxToMarkdown(zip: JSZip): Promise<string> {
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  if (slidePaths.length === 0) return '_(no slides found)_';

  const out: string[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const file = zip.file(slidePaths[i]);
    out.push(`## Slide ${i + 1}`);
    if (!file) {
      out.push('_(slide file missing)_');
      continue;
    }
    const xml = await file.async('string');
    const paragraphs = parseSlideParagraphs(xml);
    if (paragraphs.length === 0) {
      out.push('_(no text)_');
    } else {
      // First paragraph is usually the title — bump it to `###` inside the
      // slide section so titles pop in the rendered view.
      out.push(`### ${paragraphs[0]}`);
      for (let j = 1; j < paragraphs.length; j++) out.push(paragraphs[j]);
    }
  }
  return out.join('\n\n');
}
