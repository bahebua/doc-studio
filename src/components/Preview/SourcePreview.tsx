import { forwardRef, memo, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { usePreviewSearch } from '@/hooks/usePreviewSearch';
import { usePreviewFocus } from '@/hooks/usePreviewFocus';
import type { Language } from '@/types';

interface Props {
  text: string;
  language: 'json' | 'xml';
  className?: string;
}

/**
 * Pretty-print JSON. Returns the original text unchanged if it can't be
 * parsed, so a user mid-edit doesn't lose context.
 */
function prettyJson(text: string): { output: string; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { output: '', error: null };
  try {
    return { output: JSON.stringify(JSON.parse(trimmed), null, 2), error: null };
  } catch (err) {
    return { output: text, error: (err as Error).message };
  }
}

/**
 * Pretty-print XML by walking the parsed DOM. Falls back to the original on
 * any parse error (invalid XML while typing is normal).
 */
function prettyXml(text: string): { output: string; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { output: '', error: null };
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(trimmed, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) return { output: text, error: err.textContent?.trim() ?? 'Invalid XML' };
    return { output: serializeXml(doc.documentElement, 0), error: null };
  } catch (err) {
    return { output: text, error: (err as Error).message };
  }
}

function serializeXml(node: Element, depth: number): string {
  const indent = '  '.repeat(depth);
  const attrs = Array.from(node.attributes)
    .map((a) => ` ${a.name}="${escapeAttr(a.value)}"`)
    .join('');
  const children = Array.from(node.childNodes).filter(
    (n) => n.nodeType === Node.ELEMENT_NODE || (n.nodeType === Node.TEXT_NODE && n.nodeValue?.trim()),
  );
  if (children.length === 0) return `${indent}<${node.tagName}${attrs} />`;
  const onlyText = children.every((n) => n.nodeType === Node.TEXT_NODE);
  if (onlyText) {
    return `${indent}<${node.tagName}${attrs}>${escapeText((node.textContent ?? '').trim())}</${node.tagName}>`;
  }
  const inner = children
    .map((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) return serializeXml(child as Element, depth + 1);
      return `${'  '.repeat(depth + 1)}${escapeText((child.nodeValue ?? '').trim())}`;
    })
    .join('\n');
  return `${indent}<${node.tagName}${attrs}>\n${inner}\n${indent}</${node.tagName}>`;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Preview pane for JSON / XML. These formats don't have a "rendered" form —
 * they're data protocols — so we just show the source, pretty-printed and
 * monospaced. Searching still works via the shared preview-search hook so
 * jumping between matches in the preview mirrors the editor.
 */
export const SourcePreview = memo(
  forwardRef<HTMLDivElement, Props>(function SourcePreview({ text, language, className }, ref) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    usePreviewSearch(rootRef, text);
    usePreviewFocus(rootRef);

    const { output, error } = useMemo(
      () => (language === 'json' ? prettyJson(text) : prettyXml(text)),
      [text, language],
    );

    const setRef = (el: HTMLDivElement | null) => {
      rootRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    };

    const label: Record<Language, string> = {
      markdown: 'Markdown',
      html: 'HTML',
      json: 'JSON',
      xml: 'XML',
    };

    return (
      <div ref={setRef} className={clsx('source-preview', className)}>
        <div className="flex items-center justify-between mb-2 px-3 py-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px]">
          <span className="font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {label[language]} preview
          </span>
          {error ? (
            <span className="text-red-600 dark:text-red-400 truncate ml-4" title={error}>
              {error}
            </span>
          ) : (
            <span className="text-slate-400">pretty-printed · read-only</span>
          )}
        </div>
        <pre className="text-xs leading-5 whitespace-pre font-mono text-slate-800 dark:text-slate-200 p-3 rounded-md bg-white dark:bg-night-soft border border-slate-200 dark:border-slate-800 overflow-x-auto">
          {output || <span className="text-slate-400 italic">Nothing to preview yet.</span>}
        </pre>
      </div>
    );
  }),
);
