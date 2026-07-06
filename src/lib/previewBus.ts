/**
 * Tiny publish/subscribe bus that lets the sidebar Search panel talk to
 * whichever preview component is currently mounted. Only one preview can be
 * registered at a time; the last mount wins (which matches the app since the
 * user only ever sees one preview pane).
 */
import type { TocItem } from '@/types';

export interface PreviewSearchApi {
  /** Advance to the next match (wraps). No-op if no matches. */
  next(): void;
  /** Step back to the previous match (wraps). No-op if no matches. */
  prev(): void;
  /** Jump directly to the Nth match (0-based). Clamps out-of-range values
   *  so the sidebar list can hand us any index without pre-checking. */
  jumpTo(index: number): void;
  /**
   * Jump to the Nth occurrence (1-based) of an exact match string. Preferred
   * over `jumpTo` for sidebar list clicks because source-side and preview-
   * side match indices don't line up (markdown syntax chars don't render).
   * Falls back to clamped-index behavior if no matching range is found.
   */
  jumpToText(text: string, occurrence: number): void;
}

export interface PreviewFocusApi {
  /** Scroll to and highlight the outline item inside the preview. */
  focus(item: TocItem): void;
}

let currentSearch: PreviewSearchApi | null = null;
let currentFocus: PreviewFocusApi | null = null;

export function registerPreviewSearch(api: PreviewSearchApi | null): void {
  currentSearch = api;
}

export function previewNext(): void {
  currentSearch?.next();
}

export function previewPrev(): void {
  currentSearch?.prev();
}

export function previewJumpTo(index: number): void {
  currentSearch?.jumpTo(index);
}

export function previewJumpToText(text: string, occurrence: number): void {
  currentSearch?.jumpToText(text, occurrence);
}

export function registerPreviewFocus(api: PreviewFocusApi | null): void {
  currentFocus = api;
}

export function previewFocusItem(item: TocItem): void {
  currentFocus?.focus(item);
}
