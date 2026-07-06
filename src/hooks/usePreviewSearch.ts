import { useEffect, useMemo, useRef } from 'react';
import { useSearchStore } from '@/store/useSearchStore';
import { registerPreviewSearch } from '@/lib/previewBus';

const ALL_NAME = 'search-preview';
const CURRENT_NAME = 'search-preview-current';

interface HighlightConstructor {
  new (...ranges: Range[]): unknown;
}

function getHighlightApi() {
  const win = window as unknown as {
    Highlight?: HighlightConstructor;
    CSS?: { highlights?: Map<string, unknown> };
  };
  const Highlight = win.Highlight;
  const highlights = win.CSS?.highlights;
  if (!Highlight || !highlights) return null;
  return { Highlight, highlights };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(query: string, caseSensitive: boolean, useRegex: boolean): RegExp | null {
  if (!query) return null;
  try {
    const flags = caseSensitive ? 'g' : 'gi';
    return new RegExp(useRegex ? query : escapeRegExp(query), flags);
  } catch {
    return null;
  }
}

function collectRanges(root: Element, pattern: RegExp): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? '';
    if (!text) continue;
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text))) {
      if (m[0].length === 0) {
        pattern.lastIndex++;
        continue;
      }
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      ranges.push(range);
    }
  }
  return ranges;
}

/**
 * Shared search-highlight logic for any preview pane (Markdown, HTML, raw
 * source). Maintains two CSS Custom Highlights — one for all matches, one for
 * the "current" match so it stands out — and registers next/prev handlers with
 * `previewBus` so the Search panel can drive iteration.
 *
 * `contentKey` is any value that changes whenever the underlying preview
 * content is re-rendered (typically the text itself, or a nonce for iframe
 * previews).
 */
export function usePreviewSearch(
  rootRef: React.RefObject<HTMLElement | null>,
  contentKey: unknown,
  opts: { disabled?: boolean } = {},
): void {
  const disabled = opts.disabled ?? false;
  const query = useSearchStore((s) => s.query);
  const caseSensitive = useSearchStore((s) => s.caseSensitive);
  const useRegex = useSearchStore((s) => s.useRegex);

  const rangesRef = useRef<Range[]>([]);
  const indexRef = useRef(0);

  const pattern = useMemo(
    () => (disabled ? null : buildRegex(query, caseSensitive, useRegex)),
    [disabled, query, caseSensitive, useRegex],
  );

  // Recompute ranges when content or query changes.
  useEffect(() => {
    if (disabled) return;
    const api = getHighlightApi();
    if (!api) return;
    api.highlights.delete(ALL_NAME);
    api.highlights.delete(CURRENT_NAME);

    const root = rootRef.current;
    if (!root || !pattern) {
      rangesRef.current = [];
      indexRef.current = 0;
      return;
    }

    const ranges = collectRanges(root, pattern);
    rangesRef.current = ranges;
    indexRef.current = 0;

    if (ranges.length > 0) {
      api.highlights.set(ALL_NAME, new api.Highlight(...ranges));
      api.highlights.set(CURRENT_NAME, new api.Highlight(ranges[0]));
      // Scroll first match into view on brand-new query so the user sees where they are.
      scrollRangeIntoView(ranges[0]);
    }
  }, [disabled, pattern, contentKey, rootRef]);

  // Register the next/prev handlers so SearchPanel can drive us.
  useEffect(() => {
    if (disabled) return;
    const api = getHighlightApi();

    const activate = (idx: number) => {
      const ranges = rangesRef.current;
      if (ranges.length === 0) return;
      const next = ((idx % ranges.length) + ranges.length) % ranges.length;
      indexRef.current = next;
      if (api) {
        api.highlights.set(CURRENT_NAME, new api.Highlight(ranges[next]));
      }
      scrollRangeIntoView(ranges[next]);
    };

    registerPreviewSearch({
      next: () => activate(indexRef.current + 1),
      prev: () => activate(indexRef.current - 1),
      jumpTo: (i) => activate(i),
      jumpToText: (text, occurrence) => {
        const ranges = rangesRef.current;
        if (ranges.length === 0) return;
        // Walk in document order; find the `occurrence`-th range whose
        // text equals `text`. Case-insensitive comparison mirrors the
        // regex's own case sensitivity when the user disabled it.
        const target = text.toLowerCase();
        let seen = 0;
        for (let i = 0; i < ranges.length; i++) {
          const t = ranges[i].toString();
          if (t === text || t.toLowerCase() === target) {
            seen++;
            if (seen === occurrence) {
              activate(i);
              return;
            }
          }
        }
        // Best-effort fallback: clamp to the last available range so the
        // click still moves the user somewhere sensible.
        activate(Math.min(Math.max(occurrence - 1, 0), ranges.length - 1));
      },
    });
    return () => registerPreviewSearch(null);
  }, [disabled]);

  // Clean up highlights on unmount so they don't linger onto other views.
  useEffect(() => {
    return () => {
      const api = getHighlightApi();
      if (!api) return;
      api.highlights.delete(ALL_NAME);
      api.highlights.delete(CURRENT_NAME);
    };
  }, []);
}

function scrollRangeIntoView(range: Range): void {
  // range.getBoundingClientRect works, but scrollIntoView on a range isn't
  // universally supported — fall back to a temp span if needed. For our case
  // (mainstream Chromium/Firefox/Safari), scrolling the parent element is
  // cheap and reliable.
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  // Walk up to the nearest scrollable ancestor.
  let el: Node | null = range.startContainer;
  while (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentNode;
  const startEl = el as Element | null;
  if (!startEl) return;

  const scrollable = findScrollableAncestor(startEl);
  if (!scrollable) return;

  const containerRect = scrollable.getBoundingClientRect();
  const isVisible =
    rect.top >= containerRect.top + 12 && rect.bottom <= containerRect.bottom - 12;
  if (isVisible) return;

  const offset = rect.top - containerRect.top - scrollable.clientHeight / 3;
  scrollable.scrollBy({ top: offset, behavior: 'smooth' });
}

function findScrollableAncestor(el: Element): Element | null {
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement as Element | null;
}
