import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';

import { useAppStore } from '@/store/useAppStore';
import { setEditorView } from '@/lib/editorBus';
import type { Language } from '@/types';

interface Props {
  onDropFiles?: (files: File[]) => void;
}

function langExtension(lang: Language) {
  switch (lang) {
    case 'json':
      return json();
    case 'xml':
      return xml();
    case 'html':
      return html();
    case 'markdown':
    default:
      return markdown({ codeLanguages: [] });
  }
}

function isDarkNow(theme: string): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * CodeMirror 6 -backed editor. Replaces the old <textarea>-based editor with:
 *   - real syntax highlighting per language (md / json / xml / html)
 *   - in-editor search highlight + navigation + replace (driven from the
 *     sidebar Search panel via `editorBus`)
 *   - line numbers, bracket matching, code folding, active-line highlight
 *   - preserves the old drag-drop behaviour
 */
export function CodeEditor({ onDropFiles }: Props) {
  const content = useAppStore((s) => s.document.content);
  const language = useAppStore((s) => s.document.language ?? 'markdown');
  const docId = useAppStore((s) => s.document.id);
  const theme = useAppStore((s) => s.theme);
  const setContent = useAppStore((s) => s.setContent);

  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompRef = useRef(new Compartment());
  const themeCompRef = useRef(new Compartment());
  // Track which doc the current EditorState belongs to so we can rebuild
  // (rather than diff-patch) when the user switches tabs — that also resets
  // the CodeMirror undo history so undo doesn't cross file boundaries.
  const currentDocIdRef = useRef<string | null>(null);
  // Prevents feedback loops: when the store update comes back to us after WE
  // originated the change, we must not re-dispatch it into the editor.
  const applyingExternalRef = useRef(false);

  const buildState = (initialDoc: string, lang: Language, dark: boolean) =>
    EditorState.create({
      doc: initialDoc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        foldGutter(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        search({ top: true }),
        highlightSelectionMatches(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        langCompRef.current.of(langExtension(lang)),
        themeCompRef.current.of(dark ? oneDark : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !applyingExternalRef.current) {
            setContent(u.state.doc.toString());
          }
        }),
      ],
    });

  // ----- Create the view exactly once ---------------------------------------
  useEffect(() => {
    if (!parentRef.current) return;
    const state = buildState(content, language, isDarkNow(theme));
    const view = new EditorView({ state, parent: parentRef.current });
    viewRef.current = view;
    currentDocIdRef.current = docId;
    setEditorView(view);
    return () => {
      setEditorView(null);
      view.destroy();
      viewRef.current = null;
      currentDocIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Active tab changed → replace state (resets undo cleanly) -----------
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (currentDocIdRef.current === docId) return;
    applyingExternalRef.current = true;
    try {
      view.setState(buildState(content, language, isDarkNow(theme)));
    } finally {
      applyingExternalRef.current = false;
    }
    currentDocIdRef.current = docId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // ----- Sync store → editor when content changes from outside --------------
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (currentDocIdRef.current !== docId) return; // handled by the state-swap effect above
    const current = view.state.doc.toString();
    if (current === content) return;
    applyingExternalRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
      });
    } finally {
      applyingExternalRef.current = false;
    }
  }, [content, docId]);

  // ----- Language swap ------------------------------------------------------
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langCompRef.current.reconfigure(langExtension(language)),
    });
  }, [language]);

  // ----- Theme swap ---------------------------------------------------------
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompRef.current.reconfigure(isDarkNow(theme) ? oneDark : []),
    });
  }, [theme]);

  // ----- Drag & drop (mirrors old behaviour) --------------------------------
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    let counter = 0;
    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      counter++;
      el.classList.add('drop-active');
    };
    const onOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      e.preventDefault();
      counter--;
      if (counter <= 0) {
        counter = 0;
        el.classList.remove('drop-active');
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      counter = 0;
      el.classList.remove('drop-active');
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) onDropFiles?.(files);
    };
    el.addEventListener('dragenter', onEnter);
    el.addEventListener('dragover', onOver);
    el.addEventListener('dragleave', onLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragenter', onEnter);
      el.removeEventListener('dragover', onOver);
      el.removeEventListener('dragleave', onLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, [onDropFiles]);

  return <div ref={parentRef} className="cm-host h-full w-full" />;
}
