import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { sanitizeLatexForEngine, HFILL_SENTINEL } from '../../lib/latex/sanitizeLatexForEngine';
import { slugify } from '../../lib/stats';
// latex.js ships its own baseline stylesheet plus per-document-class
// styles. Importing them here (instead of at the app root) means Vite
// puts them into the *lazy chunk* alongside the engine — a Markdown
// user never pays for the ~40 KB of LaTeX CSS unless they actually
// open a `.tex` document.
import 'latex.js/dist/css/base.css';
import 'latex.js/dist/css/article.css';

interface Props {
  /** Full LaTeX source (including preamble, `\begin{document}`, etc.). */
  source: string;
  /** Optional extra classes for the outer container. */
  className?: string;
  /** When true, wraps output in a paper-like page for the PDF preview. */
  paper?: boolean;
  /**
   * Called with the parser error message when latex.js fails to render.
   * The parent can use this to fall back to a simpler preview (e.g.
   * the regex-based `texToMarkdown` pipeline) rather than leaving the
   * user staring at an error card with no content.
   */
  onError?: (message: string) => void;
}

/**
 * Renders LaTeX → HTML using the `latex.js` engine (real PEG-based
 * parser + HTML5 generator, not a regex transpiler). Mounted only when
 * `MarkdownPreview` detects a full LaTeX document, and code-split via
 * `React.lazy()` so users editing plain Markdown never download the
 * ~580 KB engine bundle.
 *
 * The component is intentionally imperative — `latex.js` returns a
 * full `HTMLDocument`, and we hand its `<body>` children directly to
 * the DOM via a ref rather than round-tripping through React. That
 * avoids re-serialising 100 KB of HTML on every keystroke and lets us
 * preserve `latex.js`'s own class hooks (`.title`, `.author`,
 * `.itemize`, etc.) for the associated stylesheet.
 */
export default function LatexPreview({ source, className, paper, onError }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        // Dynamic import so the engine only downloads on demand. Vite
        // emits a separate chunk for `latex.js` and all its transitive
        // CSS/font assets.
        const latex = await import('latex.js');
        // The library's typings are loose — cast to `any` and pull the
        // two entry points we actually use.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { HtmlGenerator, parse } = latex as any;

        const generator = new HtmlGenerator({
          // Browser-side hyphenation is expensive and often produces
          // bad breaks in short résumé lines; leave it off by default.
          hyphenate: false,
        });
        // Real-world templates lean heavily on `titlesec`, `enumitem`,
        // `hyperref` options and other packages latex.js doesn't ship.
        // The sanitiser strips those in the preamble so the engine can
        // at least parse the visible content.
        const cleaned = sanitizeLatexForEngine(source);
        const doc = parse(cleaned, { generator }).htmlDocument();

        if (cancelled) return;
        const host = containerRef.current;
        if (!host) return;

        // Wipe previous render and adopt the body children. We use
        // `cloneNode(true)` because `doc.body` is owned by a foreign
        // Document and moving nodes across documents throws in some
        // browsers.
        host.innerHTML = '';
        Array.from(doc.body.children).forEach((child) => {
          host.appendChild((child as Node).cloneNode(true));
        });

        // Post-process: latex.js has no `\hfill` primitive, so the
        // sanitiser replaced each occurrence with a private-use
        // sentinel string. Walk the rendered DOM, locate every block
        // element that contains the sentinel, and rewrite it as a
        // flexbox row so the surrounding fragments push to opposite
        // margins — restoring the two-column "company left / date
        // right" layout that résumés rely on.
        applyHfillLayout(host);

        // Give every rendered heading a slug id that matches what
        // `extractToc` computes for `\section`/`\subsection`/… entries.
        // The outline panel's click handler calls
        // `document.getElementById(item.id)` for markdown-language docs;
        // without this pass the preview never scrolls when the user
        // navigates via the outline.
        injectHeadingIds(host);

        setError(null);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        onError?.(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, onError]);

  if (error) {
    return (
      <div className={clsx('latex-engine-error', className)}>
        <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">
          <div className="font-semibold">LaTeX render error</div>
          <div className="mt-1 whitespace-pre-wrap font-mono text-xs">{error}</div>
          <div className="mt-2 text-xs opacity-80">
            The document couldn't be parsed by latex.js. Check for unbalanced
            braces, unsupported packages, or custom commands.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('latex-engine-page', paper && 'latex-engine-paper', className)}>
      {loading && (
        <div className="text-sm text-slate-500 dark:text-slate-400">
          Loading LaTeX engine…
        </div>
      )}
      <div ref={containerRef} />
    </div>
  );
}

/**
 * Walk every text node under `host`, find the private-use `\hfill`
 * sentinel, and rewrite each affected block so every line containing
 * the sentinel becomes its own flexbox row.
 *
 * A single block element can hold multiple visual lines separated by
 * `<br>` — LaTeX's `\\` maps to `<br>`, not a paragraph break. So we
 * split the block's HTML at `<br>` boundaries, apply the flex-row
 * transform only to segments that actually contain the sentinel, and
 * rejoin. Segments without the sentinel are left untouched so
 * un-decorated lines keep their normal flow.
 *
 * Each sentinel becomes a `flex: 1 1 0` spacer (`.tex-hfill-glue`),
 * exactly mirroring TeX's `\hfill` rubber length. Text fragments on
 * either side are `flex: 0 0 auto` cells at natural width.
 */
function applyHfillLayout(host: HTMLElement): void {
  if (!host.textContent || !host.textContent.includes(HFILL_SENTINEL)) return;

  const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.nodeValue && node.nodeValue.includes(HFILL_SENTINEL)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });

  // Collect the block ancestors first so we don't mutate the tree
  // while iterating with the walker.
  const blocks = new Set<HTMLElement>();
  let n: Node | null;
  while ((n = walker.nextNode())) {
    let el: HTMLElement | null = n.parentElement;
    while (el && !BLOCK_TAGS.has(el.tagName) && el !== host) {
      el = el.parentElement;
    }
    if (el && el !== host) blocks.add(el);
  }

  for (const block of blocks) {
    const html = block.innerHTML;
    if (!html.includes(HFILL_SENTINEL)) continue;
    // innerHTML is safe here — this is our own rendered output and we
    // are inserting sentinel-derived plain-text splits inside spans.
    const segments = html.split(/<br\s*\/?>/i);
    type Segment = { html: string; isFlex: boolean };
    const rebuilt: Segment[] = segments.map((segment) => {
      if (!segment.includes(HFILL_SENTINEL)) {
        return { html: segment, isFlex: false };
      }
      const parts = segment.split(HFILL_SENTINEL);
      const pieces: string[] = [];
      parts.forEach((p, i) => {
        pieces.push(`<span class="tex-hfill-cell">${p}</span>`);
        if (i < parts.length - 1) {
          pieces.push('<span class="tex-hfill-glue" aria-hidden="true"></span>');
        }
      });
      return {
        html: `<span class="tex-hfill-row">${pieces.join('')}</span>`,
        isFlex: true,
      };
    });
    // Rejoin. A `<br/>` between two block-level flex spans would add
    // an empty line's worth of height (LaTeX's `\\` is a line break,
    // not a paragraph break — the two lines should stack tightly).
    // Only re-insert `<br/>` when at least one side is still inline
    // text that would otherwise flow horizontally.
    const finalHtml = rebuilt
      .map((seg, i) => {
        if (i === 0) return seg.html;
        const prev = rebuilt[i - 1];
        const bothBlock = prev.isFlex && seg.isFlex;
        return (bothBlock ? '' : '<br/>') + seg.html;
      })
      .join('');
    block.innerHTML = finalHtml;
  }
}

/**
 * Walk every heading in the rendered LaTeX and assign an `id`
 * attribute that matches what `extractToc` slugifies for the same
 * text. This lets the outline panel scroll the preview via
 * `document.getElementById(item.id)` — otherwise clicking a section
 * only jumps the editor caret.
 *
 * Duplicate slugs get `-1`, `-2`, … suffixes so multiple sections with
 * the same title stay individually addressable. The ordering matches
 * `extractToc`'s own dedupe pass, so the Nth occurrence in the outline
 * maps to the Nth occurrence in the DOM.
 */
function injectHeadingIds(host: HTMLElement): void {
  const headings = host.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
  const seen = new Map<string, number>();
  headings.forEach((h) => {
    if (h.id) return; // respect ids that latex.js or the user already set
    const text = (h.textContent ?? '').trim();
    if (!text) return;
    const base = slugify(text);
    if (!base) return;
    const count = seen.get(base) ?? 0;
    h.id = count === 0 ? base : `${base}-${count}`;
    seen.set(base, count + 1);
  });
}
