import { forwardRef, lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkEmoji from 'remark-emoji';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
// KaTeX ships its own stylesheet — imported once here so math-heavy
// documents render with correct fonts, spacing and symbol positioning.
// The CSS is small (~25 KB gzipped) and only loaded when this module is.
import 'katex/dist/katex.min.css';
import clsx from 'clsx';
import { usePreviewSearch } from '@/hooks/usePreviewSearch';
import { MermaidBlock } from './MermaidBlock';
import {
  looksLikeMermaid,
  wrapAsMermaidFence,
} from '@/lib/mermaidAutoDetect';
import { looksLikeLatexDocument, texToMarkdown } from '@/lib/converters/texToMd';
import {
  loadFromStorage as loadLatexStyle,
  saveToStorage as saveLatexStyle,
  toCssVars as latexStyleToCssVars,
  type LatexStyleConfig,
} from '@/lib/latex/latexStyleConfig';
import { LatexStylePanel } from './LatexStylePanel';

// Lazy-load the full LaTeX engine (latex.js ≈ 580 KB + its CSS/fonts).
// Users editing plain Markdown never download this chunk — Vite only
// fetches it the first time `looksLikeLatexDocument()` returns true.
// The fallback below (regex → Markdown → HTML) keeps working if the
// dynamic import fails (offline, blocked CDN, etc.).
const LatexPreview = lazy(() => import('./LatexPreview'));

interface Props {
  markdown: string;
  className?: string;
  /** When true, wraps output in a paper-like page for the PDF preview */
  paper?: boolean;
}

/**
 * Renders Markdown → HTML. Used by both the live preview *and* the PDF
 * preview. Forwarding the ref lets the exporter grab the actual DOM to
 * serialize or hand off to html2pdf.
 */
export const MarkdownPreview = memo(
  forwardRef<HTMLDivElement, Props>(function MarkdownPreview(
    { markdown, className, paper },
    ref,
  ) {
    // react-markdown plugins are cheap to instantiate but stable identities
    // help memoization further down the tree.
    //
    // - `remarkMath` picks up `$…$` (inline) and `$$…$$` (block) math
    //   syntax and emits math nodes that rehype-katex later renders.
    //   Runs alongside GFM so tables, task lists, strikethrough, etc.
    //   keep working in the same document.
    // - `rehypeKatex` is placed *before* rehype-highlight so the syntax
    //   highlighter doesn't try to tokenise math expressions.
    const remarkPlugins = useMemo(
      () => [remarkGfm, remarkEmoji, remarkMath],
      [],
    );
    const rehypePlugins = useMemo(
      () => [
        rehypeRaw,
        rehypeSlug,
        [rehypeKatex, { strict: false, throwOnError: false }] as const,
        [rehypeHighlight, { ignoreMissing: true }] as const,
      ],
      [],
    );

    // Auto-wrap raw Mermaid documents in fenced code blocks so users who
    // paste a bare `sequenceDiagram` / `flowchart` / etc. still get a
    // rendered diagram instead of a wall of text. Fenced-content docs
    // pass through untouched.
    //
    // Similarly, if the buffer looks like a full LaTeX document
    // (`\documentclass` / `\begin{document}`) run it through the tex
    // converter first so the user gets a readable preview instead of a
    // wall of backslashes.
    const isLatex = useMemo(() => looksLikeLatexDocument(markdown), [markdown]);
    const source = useMemo(() => {
      if (isLatex) return texToMarkdown(markdown);
      if (looksLikeMermaid(markdown)) return wrapAsMermaidFence(markdown);
      return markdown;
    }, [markdown, isLatex]);

    // When latex.js can't parse the document (unsupported packages,
    // custom macros the sanitiser missed, etc.) fall back to rendering
    // the regex-converted Markdown so the user still gets a readable
    // preview instead of a dead error card. Reset on every source
    // change so a fix in the editor immediately retries the real
    // engine.
    const [latexFailure, setLatexFailure] = useState<string | null>(null);
    useEffect(() => {
      setLatexFailure(null);
    }, [markdown]);
    const handleLatexError = useCallback((message: string) => {
      setLatexFailure(message);
    }, []);
    const useLatexEngine = isLatex && !latexFailure;

    // Persistent LaTeX style tunables (font size, section margins, list
    // indent, …). The panel above the preview mutates this; every
    // change is written to localStorage so tweaks survive reloads.
    // Skipped for the PDF export mirror (`paper=true`) — that consumer
    // just renders whatever the user has already dialled in.
    const [latexStyle, setLatexStyle] = useState<LatexStyleConfig>(() => loadLatexStyle());
    useEffect(() => {
      if (paper) return;
      saveLatexStyle(latexStyle);
    }, [latexStyle, paper]);
    const latexStyleVars = useMemo(() => latexStyleToCssVars(latexStyle), [latexStyle]);

    const proseRef = useRef<HTMLDivElement | null>(null);
    // Skip the search-integration hook for the offscreen PDF export mirror —
    // it would fight with the visible preview for the shared preview bus.
    usePreviewSearch(proseRef, source, { disabled: paper });

    // Combine the forwarded ref with our internal ref for the prose container.
    const setProseRef = (el: HTMLDivElement | null) => {
      proseRef.current = el;
      if (paper) return; // when paper=true, forwarded ref goes on the outer wrapper
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    };

    // After each render, if the URL carries a `#anchor`, scroll to the
    // matching heading inside the preview. Rehype-slug produces the ids
    // asynchronously (via React commit), so a synchronous browser jump on
    // page load misses them — we rerun the scroll on every content change
    // and on `hashchange` so deep-linked sections always land in view.
    useEffect(() => {
      if (paper) return;
      const scrollToHash = () => {
        const hash = window.location.hash.slice(1);
        if (!hash) return;
        const root = proseRef.current;
        if (!root) return;
        const target = root.querySelector<HTMLElement>(`#${CSS.escape(hash)}`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      // Defer one frame so react-markdown has emitted the id-bearing DOM.
      const raf = requestAnimationFrame(scrollToHash);
      window.addEventListener('hashchange', scrollToHash);
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('hashchange', scrollToHash);
      };
    }, [source, paper]);

    const body = (
      <div
        ref={setProseRef}
        className={clsx('md-preview', isLatex && 'latex-mode', className)}
        // Injected LaTeX-style custom properties (font size, margins,
        // list indent, …) — see `src/lib/latex/latexStyleConfig.ts`.
        // The stylesheet reads them via `var(--doc-*, fallback)` so the
        // fallbacks still apply when the object below is empty (paper
        // export mirror renders with the same values the panel last
        // saved to localStorage, since we always compute the vars).
        style={isLatex ? latexStyleVars : undefined}
      >
        {useLatexEngine ? (
          // Real LaTeX engine path — lazy-loaded so plain-Markdown
          // users never fetch the ~580 KB bundle. Suspense fallback
          // shows a short "loading" message on first `.tex` open.
          <Suspense
            fallback={
              <div className="text-sm text-slate-500 dark:text-slate-400">
                Loading LaTeX engine…
              </div>
            }
          >
            <LatexPreview source={markdown} paper={paper} onError={handleLatexError} />
          </Suspense>
        ) : (
          <>
            {isLatex && latexFailure && (
              // Small non-blocking notice above the fallback so users
              // know why they're seeing the simplified render and can
              // act on it (fix the offending macro / package).
              <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                <span className="font-semibold">LaTeX engine couldn't parse this document.</span>{' '}
                Showing simplified preview.
                <div className="mt-1 font-mono opacity-80">{latexFailure}</div>
              </div>
            )}
            <ReactMarkdown
            remarkPlugins={remarkPlugins}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            rehypePlugins={rehypePlugins as any}
            // Without this, remark-rehype drops raw HTML strings so
            // rehype-raw never sees them — the symptom is `<span>` /
            // `<div>` tags emitted by the LaTeX converter appearing as
            // *escaped visible text* in the preview instead of being
            // rendered as real DOM elements.
            remarkRehypeOptions={{ allowDangerousHtml: true }}
            components={{
              // Intercept ```mermaid fenced blocks BEFORE rehype-highlight
              // gets to them. react-markdown passes the code element with
              // `className="language-mermaid"` — we swap in our own async
              // renderer that produces an inline SVG plus a
              // copy/download toolbar.
              code: ({ className, children, ...rest }) => {
                const isMermaid = /(^|\s)language-mermaid(\s|$)/.test(
                  className || '',
                );
                if (isMermaid) {
                  const mermaidSource = Array.isArray(children)
                    ? children.join('')
                    : String(children ?? '');
                  return <MermaidBlock code={mermaidSource} paper={paper} />;
                }
                return (
                  <code className={className} {...rest}>
                    {children}
                  </code>
                );
              },
              a: ({ node: _node, href, ...props }) => {
                // In-document anchor links (`#foo`) must stay inside this pane
                // — otherwise the default `target="_blank"` sends the user to
                // a fresh tab where the hash never resolves to a heading.
                const isAnchor = typeof href === 'string' && href.startsWith('#');
                if (isAnchor) {
                  return (
                    <a
                      {...props}
                      href={href}
                      onClick={(e) => {
                        e.preventDefault();
                        const id = href.slice(1);
                        const target = proseRef.current?.querySelector<HTMLElement>(
                          `#${CSS.escape(id)}`,
                        );
                        if (target) {
                          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          history.replaceState(null, '', `#${id}`);
                        }
                      }}
                    />
                  );
                }
                return <a {...props} href={href} target="_blank" rel="noopener noreferrer" />;
              },
            }}
          >
            {source || '_Nothing to preview yet — start writing in the editor._'}
          </ReactMarkdown>
          </>
        )}
      </div>
    );

    if (paper) {
      return (
        <div ref={ref} className="pdf-page">
          {body}
        </div>
      );
    }
    // Style panel only makes sense for LaTeX documents in the visible
    // preview — plain Markdown ignores every `--doc-*` var and the PDF
    // export mirror shouldn't render UI chrome.
    if (isLatex) {
      return (
        <>
          <LatexStylePanel value={latexStyle} onChange={setLatexStyle} />
          {body}
        </>
      );
    }
    return body;
  }),
);
