/**
 * A tiny module-level channel so sidebar panels can talk to the (single) live
 * CodeMirror editor without prop-drilling or context. The editor registers
 * itself on mount and unregisters on unmount.
 */
import type { EditorView } from '@codemirror/view';

let currentView: EditorView | null = null;
const listeners = new Set<(v: EditorView | null) => void>();

export function setEditorView(v: EditorView | null): void {
  currentView = v;
  for (const l of listeners) l(v);
}

export function getEditorView(): EditorView | null {
  return currentView;
}

/** Subscribe to view (un)mount events. Returns an unsubscribe function. */
export function subscribeEditorView(fn: (v: EditorView | null) => void): () => void {
  listeners.add(fn);
  fn(currentView);
  return () => listeners.delete(fn);
}
