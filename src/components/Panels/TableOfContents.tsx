import { useEffect, useMemo, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import clsx from 'clsx';
import { EditorSelection } from '@codemirror/state';
import { useAppStore } from '@/store/useAppStore';
import {
  extractJsonOutline,
  extractToc,
  extractXmlOutline,
} from '@/lib/stats';
import { getEditorView } from '@/lib/editorBus';
import { previewFocusItem } from '@/lib/previewBus';
import { toast } from '@/components/ui/Toast';
import type { Language, TocItem } from '@/types';

interface Props {
  onNavigate?: () => void;
}

/**
 * Outline panel. Displays the document's structure and lets the user:
 *   - jump to the source position in the editor by clicking a row
 *   - focus the same node inside the preview (for JSON/XML/HTML) so the
 *     preview scrolls and highlights the corresponding element
 *   - open a per-item actions menu (kebab or right-click) to copy the key,
 *     value, or path; and for JSON/XML, set the value inline
 */
export function TableOfContents({ onNavigate }: Props) {
  const content = useAppStore((s) => s.document.content);
  const language = useAppStore((s) => s.document.language ?? 'markdown');
  const setContent = useAppStore((s) => s.setContent);

  const items = useMemo<TocItem[]>(() => {
    switch (language) {
      case 'json':
        return extractJsonOutline(content);
      case 'xml':
      case 'html':
        return extractXmlOutline(content);
      case 'markdown':
      default:
        return extractToc(content);
    }
  }, [content, language]);

  if (items.length === 0) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400 italic px-2">
        {language === 'markdown'
          ? 'Add a heading (#, ##, …) to generate a table of contents.'
          : language === 'json'
            ? 'Nothing to outline — JSON needs at least one object or array of objects.'
            : 'Nothing to outline — add some elements to see the structure.'}
      </p>
    );
  }

  const handleJump = (item: TocItem) => {
    if (language === 'markdown') {
      // Preview: scroll the rendered heading into view.
      const el = document.getElementById(item.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', `#${item.id}`);
      }
      // Editor: put the caret on the heading line so both panes stay in
      // sync (previously only the preview moved).
      jumpEditor(item);
    } else {
      jumpEditor(item);
      previewFocusItem(item);
    }
    onNavigate?.();
  };

  return (
    <nav aria-label="Outline" className="space-y-0.5">
      {items.map((item, i) => (
        <OutlineRow
          key={`${item.id}-${i}`}
          item={item}
          language={language}
          content={content}
          onJump={handleJump}
          onSetValue={(newContent) => setContent(newContent)}
        />
      ))}
    </nav>
  );
}

function jumpEditor(item: TocItem): void {
  if (item.line == null) return;
  const view = getEditorView();
  if (!view) return;
  const doc = view.state.doc;
  if (item.line > doc.lines) return;
  const lineStart = doc.line(item.line).from;
  const anchor = lineStart + (item.col ?? 0);
  view.dispatch({
    selection: EditorSelection.cursor(anchor),
    scrollIntoView: true,
  });
  view.focus();
}

interface RowProps {
  item: TocItem;
  language: Language;
  content: string;
  onJump: (item: TocItem) => void;
  onSetValue: (newContent: string) => void;
}

function OutlineRow({ item, language, content, onJump, onSetValue }: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const hasActions = language !== 'markdown';

  return (
    <div
      ref={rowRef}
      className="group relative"
      onContextMenu={(e) => {
        if (!hasActions) return;
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onJump(item)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onJump(item);
          }
        }}
        className={clsx(
          'flex items-center gap-2 truncate rounded-md pr-1 py-1 text-sm transition-colors cursor-pointer',
          'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          'dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
        )}
        style={{ paddingLeft: `${(item.depth - 1) * 12 + 8}px` }}
        title={item.text}
      >
        <span className="truncate flex-1 min-w-0">{item.text}</span>
        {item.hint && (
          <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 flex-shrink-0">
            {item.hint}
          </span>
        )}
        {hasActions && (
          <button
            type="button"
            aria-label="Item actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className={clsx(
              'h-5 w-5 rounded flex items-center justify-center flex-shrink-0',
              'text-slate-400 hover:text-slate-900 dark:hover:text-white',
              'hover:bg-slate-200 dark:hover:bg-slate-700',
              menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
            )}
          >
            <MoreVertical size={13} />
          </button>
        )}
      </div>
      {menuOpen && (
        <OutlineMenu
          item={item}
          language={language}
          content={content}
          onClose={() => setMenuOpen(false)}
          onSetValue={onSetValue}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions menu
// ---------------------------------------------------------------------------

interface MenuProps {
  item: TocItem;
  language: Language;
  content: string;
  onClose: () => void;
  onSetValue: (newContent: string) => void;
}

async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Copy failed — clipboard not available');
  }
}

function OutlineMenu({ item, language, content, onClose, onSetValue }: MenuProps) {
  const value = extractValue(item, content, language);
  const element = extractElement(item, content, language);

  interface Action {
    label: string;
    onSelect: () => void;
    disabled?: boolean;
  }

  const actions: Action[] = [];

  if (language === 'json') {
    actions.push(
      {
        label: 'Copy key',
        onSelect: () => copyToClipboard(item.text, 'Key'),
      },
      {
        label: 'Copy value',
        onSelect: () => copyToClipboard(value, 'Value'),
        disabled: !value,
      },
      {
        label: 'Copy "key": value',
        onSelect: () =>
          copyToClipboard(element || `"${item.text}": ${value}`, 'Entry'),
        disabled: !element && !value,
      },
      {
        label: 'Copy path',
        onSelect: () => copyToClipboard(item.path ?? item.text, 'Path'),
      },
      {
        label: 'Set value…',
        onSelect: () => promptAndSetValue(item, content, onSetValue),
        disabled: item.valueStart == null || item.valueEnd == null,
      },
    );
  } else if (language === 'xml' || language === 'html') {
    actions.push(
      {
        label: 'Copy tag',
        onSelect: () => copyToClipboard(item.text.split(' · ')[0], 'Tag'),
      },
      {
        label: 'Copy inner content',
        onSelect: () => copyToClipboard(value, 'Content'),
        disabled: !value,
      },
      {
        label: 'Copy element',
        onSelect: () => copyToClipboard(element, 'Element'),
        disabled: !element,
      },
      {
        label: 'Copy path',
        onSelect: () => copyToClipboard(item.path ?? item.text, 'Path'),
      },
      {
        label: 'Set inner content…',
        onSelect: () => promptAndSetValue(item, content, onSetValue),
        // Self-closing tags have valueStart == valueEnd but are still
        // editable — we rewrite them to `<tag>value</tag>` on set.
        disabled:
          (item.valueStart == null || item.valueEnd == null) && !item.selfClosing,
      },
    );
  }

  return (
    <div
      role="menu"
      className={clsx(
        'absolute right-1 top-full z-20 mt-0.5 min-w-[180px] py-1 rounded-lg',
        'bg-white dark:bg-night-muted border border-slate-200 dark:border-slate-700',
        'shadow-lg text-sm',
      )}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          role="menuitem"
          type="button"
          disabled={action.disabled}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            action.onSelect();
          }}
          className={clsx(
            'block w-full text-left px-3 py-1.5 text-slate-700 dark:text-slate-200',
            'hover:bg-slate-100 dark:hover:bg-slate-800',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
          )}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull the raw value text out of the source using the item's tracked range. */
function extractValue(item: TocItem, content: string, language: Language): string {
  if (item.valueStart == null || item.valueEnd == null) return '';
  const raw = content.slice(item.valueStart, item.valueEnd);
  if (language === 'json') {
    // Strip trailing whitespace/comma noise for cleanliness on primitives.
    return raw.replace(/[\s,]+$/, '');
  }
  return raw;
}

/** Pull the "whole element" out of the source (key+value for JSON, entire
 *  `<tag>...</tag>` block for XML/HTML). */
function extractElement(item: TocItem, content: string, language: Language): string {
  if (item.startOffset == null || item.endOffset == null) return '';
  const raw = content.slice(item.startOffset, item.endOffset);
  if (language === 'json') return raw.replace(/[\s,]+$/, '');
  return raw;
}

function promptAndSetValue(
  item: TocItem,
  content: string,
  onSetValue: (newContent: string) => void,
): void {
  // Special case: self-closing XML/HTML tag. We need to REWRITE the whole
  // element (`<tag attrs />` → `<tag attrs>value</tag>`) rather than splice
  // between the (equal) value offsets.
  if (item.selfClosing && item.startOffset != null && item.endOffset != null) {
    const raw = content.slice(item.startOffset, item.endOffset);
    const m = /^<([\w:.\-]+)([\s\S]*?)\s*\/\s*>$/.exec(raw);
    if (!m) {
      toast.error('Could not parse self-closing tag');
      return;
    }
    const [, tagName, attrs] = m;
    const next = window.prompt(`Set value for <${tagName}/>`, '');
    if (next == null) return;
    // Empty string → keep it self-closing (nothing to change).
    if (next === '') return;
    const openTag = `<${tagName}${attrs}>`;
    const closeTag = `</${tagName}>`;
    const updated =
      content.slice(0, item.startOffset) +
      openTag +
      escapeXmlText(next) +
      closeTag +
      content.slice(item.endOffset);
    onSetValue(updated);
    toast.success(`Expanded <${tagName}/> and set value`);
    return;
  }

  if (item.valueStart == null || item.valueEnd == null) return;
  const current = content.slice(item.valueStart, item.valueEnd);
  const trimmed = current.replace(/[\s,]+$/, '');
  const next = window.prompt(`Set new value for "${item.text}"`, trimmed);
  if (next == null) return; // user cancelled
  if (next === trimmed) return; // no change
  const preserved = current.slice(trimmed.length); // trailing whitespace/comma
  const updated =
    content.slice(0, item.valueStart) + next + preserved + content.slice(item.valueEnd);
  onSetValue(updated);
  toast.success(`Updated "${item.text}"`);
}

/** Minimal XML text escape — enough to keep `<tag>value</tag>` well-formed. */
function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
