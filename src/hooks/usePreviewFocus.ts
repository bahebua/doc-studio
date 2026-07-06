import { useEffect } from 'react';
import type { TocItem } from '@/types';
import { registerPreviewFocus } from '@/lib/previewBus';

interface HighlightConstructor {
  new (...ranges: Range[]): unknown;
}

const FOCUS_HIGHLIGHT_NAME = 'search-preview-current';

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

/**
 * Walk text nodes under `root` and produce a Range for the `nth` (0-based)
 * occurrence of `needle` (case-sensitive). Returns null if no such occurrence.
 */
function nthTextRange(root: Element, needle: string, nth: number): Range | null {
  if (!needle) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? '';
    if (!text) continue;
    let from = 0;
    while (true) {
      const idx = text.indexOf(needle, from);
      if (idx < 0) break;
      if (seen === nth) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + needle.length);
        return range;
      }
      seen++;
      from = idx + needle.length;
    }
  }
  return null;
}

function scrollRangeIntoView(range: Range): void {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
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

/**
 * For previews that show text (Markdown / SourcePreview): find the outline
 * item's needle at the right occurrence, highlight it as the "current match",
 * and scroll it into view. Reuses the search-preview-current highlight so a
 * subsequent search iteration overwrites it, which is fine — the user's
 * "focus" and "search" intents don't need to coexist.
 */
export function usePreviewFocus(rootRef: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    registerPreviewFocus({
      focus: (item: TocItem) => {
        const root = rootRef.current;
        if (!root) return;
        const needle = item.needle;
        if (!needle) return;
        const range = nthTextRange(root, needle, item.occurrence ?? 0);
        if (!range) return;
        const api = getHighlightApi();
        if (api) {
          api.highlights.set(FOCUS_HIGHLIGHT_NAME, new api.Highlight(range));
        }
        scrollRangeIntoView(range);
      },
    });
    return () => registerPreviewFocus(null);
  }, [rootRef]);
}

/**
 * For HTML previews: find the outline item's element by tag name and index,
 * highlight it, and scroll into view. Falls back to a text-needle search if
 * the tag lookup fails (e.g., for pseudo elements from CSS).
 */
export function useHtmlPreviewFocus(rootRef: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    registerPreviewFocus({
      focus: (item: TocItem) => {
        const root = rootRef.current;
        if (!root) return;
        const tag = item.needle?.startsWith('<') ? item.needle.slice(1) : null;
        const api = getHighlightApi();

        if (tag) {
          const elements = root.querySelectorAll(tag);
          const target = elements[item.occurrence ?? 0] as Element | undefined;
          if (target) {
            const range = document.createRange();
            range.selectNode(target);
            if (api) {
              api.highlights.set(FOCUS_HIGHLIGHT_NAME, new api.Highlight(range));
            }
            scrollRangeIntoView(range);
            return;
          }
        }

        // Fallback: text-needle search.
        if (!item.needle) return;
        const range = nthTextRange(root, item.needle, item.occurrence ?? 0);
        if (!range) return;
        if (api) {
          api.highlights.set(FOCUS_HIGHLIGHT_NAME, new api.Highlight(range));
        }
        scrollRangeIntoView(range);
      },
    });
    return () => registerPreviewFocus(null);
  }, [rootRef]);
}
