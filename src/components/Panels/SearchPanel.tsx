import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  Regex,
  Replace,
  Search,
} from 'lucide-react';
import clsx from 'clsx';
import {
  SearchQuery,
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from '@codemirror/search';
import { useAppStore } from '@/store/useAppStore';
import { useSearchStore } from '@/store/useSearchStore';
import { getEditorView } from '@/lib/editorBus';
import { previewNext, previewPrev, previewJumpToText } from '@/lib/previewBus';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Match {
  /** Absolute character offset of the match start in the document. */
  start: number;
  end: number;
  /** 1-based line number. */
  line: number;
  /** Full text of the line the match falls on. */
  lineText: string;
  /** Offset of the match within `lineText`. */
  matchStartInLine: number;
  matchLength: number;
  /** The exact substring the regex matched (preserves the original case). */
  matchText: string;
  /** 1-based occurrence index *of this specific matchText* within the doc.
   *  Used to sync the preview: the preview's DOM-walked ranges have a
   *  different total count than the source, but the Nth "foo" in the
   *  source is still the Nth "foo" in the preview. */
  occurrence: number;
}

/** Cap how many hits we render — beyond this the list is noise. */
const MAX_LIST_MATCHES = 500;

/**
 * Scan the document once and produce a flat list of match locations plus
 * the containing line for each one. Uses a precomputed line-offset table
 * with binary search so a 500-hit scan on a 1 MB file stays instant.
 */
function collectMatches(content: string, regex: RegExp): Match[] {
  const lineOffsets: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lineOffsets.push(i + 1);
  }
  regex.lastIndex = 0;
  const out: Match[] = [];
  // Per-matchText occurrence counter. Keying by the literal match text
  // (case-preserving) means the Nth "Foo" is counted separately from the
  // Nth "foo" even under a case-insensitive regex — which is what the
  // preview side needs to line up occurrences.
  const perText = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    // Binary-search the greatest lineOffset ≤ m.index.
    let lo = 0;
    let hi = lineOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (lineOffsets[mid] <= m.index) lo = mid;
      else hi = mid - 1;
    }
    const lineStart = lineOffsets[lo];
    const lineEnd = lo + 1 < lineOffsets.length ? lineOffsets[lo + 1] - 1 : content.length;
    const matchText = m[0];
    const occurrence = (perText.get(matchText) ?? 0) + 1;
    perText.set(matchText, occurrence);
    out.push({
      start: m.index,
      end: m.index + matchText.length,
      line: lo + 1,
      lineText: content.slice(lineStart, lineEnd),
      matchStartInLine: m.index - lineStart,
      matchLength: matchText.length,
      matchText,
      occurrence,
    });
    if (out.length >= MAX_LIST_MATCHES) break;
    // Zero-length match guard — otherwise `regex.exec` never advances.
    if (m.index === regex.lastIndex) regex.lastIndex++;
  }
  return out;
}

/**
 * Sidebar search panel. Drives the live CodeMirror editor's search state via
 * `editorBus` so matches highlight inline, and Next / Prev / Replace all route
 * through CM's own commands (so undo history stays consistent).
 */
export function SearchPanel() {
  const content = useAppStore((s) => s.document.content);

  // Shared with the preview highlighter
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const caseSensitive = useSearchStore((s) => s.caseSensitive);
  const setCaseSensitive = useSearchStore((s) => s.setCaseSensitive);
  const useRegex = useSearchStore((s) => s.useRegex);
  const setUseRegex = useSearchStore((s) => s.setUseRegex);

  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);

  const regex = useMemo(() => {
    if (!query) return null;
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      return new RegExp(useRegex ? query : escapeRegExp(query), flags);
    } catch {
      return null;
    }
  }, [query, caseSensitive, useRegex]);

  const matches = useMemo(() => {
    if (!regex) return 0;
    return (content.match(regex) ?? []).length;
  }, [regex, content]);

  const matchList = useMemo<Match[]>(() => {
    if (!regex || !query) return [];
    return collectMatches(content, regex);
  }, [regex, query, content]);

  // Push the query into the editor so matches highlight inline.
  useEffect(() => {
    const view = getEditorView();
    if (!view) return;
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: query,
          caseSensitive,
          regexp: useRegex,
          replace: replacement,
        }),
      ),
    });
  }, [query, replacement, caseSensitive, useRegex]);

  const focusEditor = () => {
    const v = getEditorView();
    if (v) v.focus();
    return v;
  };

  // Note: don't focus the editor — keeping focus in the search input lets
  // the user hit Enter repeatedly to iterate matches. The editor's selection
  // still moves; only the focus stays here.
  const onNext = () => {
    const v = getEditorView();
    if (v) findNext(v);
    previewNext();
  };
  const onPrev = () => {
    const v = getEditorView();
    if (v) findPrevious(v);
    previewPrev();
  };
  const onReplaceOne = () => {
    const v = getEditorView();
    if (v) replaceNext(v);
  };
  const onReplaceAll = () => {
    const v = focusEditor(); // OK to focus — nothing more to iterate
    if (!v) return;
    const before = matches;
    replaceAll(v);
    toast.success(`Replaced ${before} occurrence${before === 1 ? '' : 's'}`);
  };

  /**
   * Move the editor selection to a specific match and scroll it into view.
   * Focuses the editor so subsequent keystrokes act on the highlighted
   * range — but the search box keeps the tab order so Shift-Tab returns.
   */
  const jumpTo = (m: Match, _index: number) => {
    const v = getEditorView();
    if (v) {
      v.dispatch({
        selection: { anchor: m.start, head: m.end },
        scrollIntoView: true,
      });
      v.focus();
    }
    // Preview alignment: source indices and preview-DOM indices can drift
    // apart (markdown syntax chars don't render), so we point the preview
    // at the Nth occurrence of the exact matched text. That's stable
    // across the source/DOM boundary for any non-syntax-only query.
    previewJumpToText(m.matchText, m.occurrence);
  };

  return (
    <div className="space-y-2.5">
      <label className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-night-muted px-2.5 h-9">
        <Search size={14} className="text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            }
          }}
          placeholder="Find in document"
          className="flex-1 bg-transparent outline-none text-sm"
        />
        {query && (
          <span className="text-[11px] text-slate-500 tabular-nums">{matches}</span>
        )}
      </label>

      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant={caseSensitive ? 'primary' : 'ghost'}
          onClick={() => setCaseSensitive(!caseSensitive)}
          aria-pressed={caseSensitive}
          title="Case sensitive"
        >
          <CaseSensitive size={14} />
        </Button>
        <Button
          size="icon"
          variant={useRegex ? 'primary' : 'ghost'}
          onClick={() => setUseRegex(!useRegex)}
          aria-pressed={useRegex}
          title="Use regular expression"
        >
          <Regex size={14} />
        </Button>
        <Button
          size="icon"
          variant={showReplace ? 'primary' : 'ghost'}
          onClick={() => setShowReplace((v) => !v)}
          aria-pressed={showReplace}
          title="Replace"
        >
          <Replace size={14} />
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={onPrev}
            disabled={!query || matches === 0}
            title="Previous match (Shift+Enter)"
          >
            <ArrowUp size={14} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onNext}
            disabled={!query || matches === 0}
            title="Next match (Enter)"
          >
            <ArrowDown size={14} />
          </Button>
        </div>
      </div>

      <div
        className={clsx(
          'grid transition-all duration-200',
          showReplace ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden space-y-2">
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="Replace with…"
            className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-night-muted px-2.5 text-sm outline-none"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="subtle"
              className="flex-1"
              onClick={onReplaceOne}
              disabled={!query || matches === 0}
            >
              Replace
            </Button>
            <Button
              size="sm"
              variant="primary"
              className="flex-1"
              onClick={onReplaceAll}
              disabled={!query || matches === 0}
            >
              Replace all ({matches})
            </Button>
          </div>
        </div>
      </div>

      <MatchesList matches={matchList} totalCount={matches} onJump={jumpTo} query={query} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results list — one row per match in the active document. Clicking a row
// jumps the editor selection to that offset (see `jumpTo` above).
// ---------------------------------------------------------------------------

interface MatchesListProps {
  matches: Match[];
  totalCount: number;
  query: string;
  onJump: (m: Match, index: number) => void;
}

/** How many characters of the line to show before / after the match. */
const CONTEXT_BEFORE = 30;
const CONTEXT_AFTER = 60;

function MatchesList({ matches, totalCount, query, onJump }: MatchesListProps) {
  if (!query) return null;
  if (matches.length === 0) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400 px-1 py-2">
        No matches in this file.
      </p>
    );
  }
  const truncated = totalCount > matches.length;

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 pt-2 space-y-1">
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-medium">
          Matches
        </span>
        <span className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
          {truncated
            ? `showing ${matches.length} of ${totalCount}`
            : `${totalCount}`}
        </span>
      </div>
      <ul className="max-h-[45vh] overflow-y-auto -mx-1 pr-1">
        {matches.map((m, i) => (
          <li key={`${m.start}-${i}`}>
            <button
              type="button"
              onClick={() => onJump(m, i)}
              className={clsx(
                'w-full text-left flex items-baseline gap-2 px-2 py-1.5 rounded-md',
                'text-xs font-mono leading-tight',
                'hover:bg-slate-100 dark:hover:bg-slate-800',
                'text-slate-700 dark:text-slate-300',
              )}
              title={`Line ${m.line}, column ${m.matchStartInLine + 1}`}
            >
              <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500 flex-shrink-0 w-8 text-right">
                {m.line}
              </span>
              <span className="truncate flex-1 min-w-0">
                <Snippet
                  line={m.lineText}
                  matchStart={m.matchStartInLine}
                  matchLength={m.matchLength}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Render one line of context with the matched region highlighted. Trims
 * long lines around the match so the important bit is always on-screen.
 */
function Snippet({
  line,
  matchStart,
  matchLength,
}: {
  line: string;
  matchStart: number;
  matchLength: number;
}) {
  const before = Math.max(0, matchStart - CONTEXT_BEFORE);
  const after = Math.min(line.length, matchStart + matchLength + CONTEXT_AFTER);
  const pre = (before > 0 ? '…' : '') + line.slice(before, matchStart);
  const hit = line.slice(matchStart, matchStart + matchLength);
  const post = line.slice(matchStart + matchLength, after) + (after < line.length ? '…' : '');
  return (
    <>
      <span className="text-slate-500 dark:text-slate-400">{pre}</span>
      <mark className="bg-amber-200/70 dark:bg-amber-500/40 text-slate-900 dark:text-amber-100 rounded-sm px-0.5">
        {hit}
      </mark>
      <span className="text-slate-500 dark:text-slate-400">{post}</span>
    </>
  );
}
