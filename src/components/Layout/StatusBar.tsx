import { useEffect, useMemo, useState } from 'react';
import { Check, Cloud } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { computeStats } from '@/lib/stats';

export function StatusBar() {
  const content = useAppStore((s) => s.document.content);
  const updatedAt = useAppStore((s) => s.document.updatedAt);
  const language = useAppStore((s) => s.document.language ?? 'markdown');
  const previewMode = useAppStore((s) => s.previewMode);
  const setPreviewMode = useAppStore((s) => s.setPreviewMode);
  const stats = useMemo(() => computeStats(content), [content]);

  const [saved, setSaved] = useState(true);
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => setSaved(true), 900);
    return () => clearTimeout(t);
  }, [updatedAt]);

  // The HTML / PDF preview toggle only makes sense for Markdown — for JSON/XML
  // the preview shows pretty-printed source regardless, and for HTML it's
  // rendered live. Hiding the toggle keeps the status bar honest.
  const showPreviewToggle = language === 'markdown';

  return (
    <footer
      className={clsx(
        'no-print h-8 flex items-center gap-3 px-3 sm:px-4 text-[11px]',
        'bg-slate-100/80 dark:bg-night-soft border-t border-slate-200 dark:border-slate-800',
        'text-slate-500 dark:text-slate-400',
      )}
    >
      <span className="flex items-center gap-1.5">
        {saved ? <Check size={12} className="text-emerald-500" /> : <Cloud size={12} />}
        {saved ? 'Saved locally' : 'Saving…'}
      </span>
      <span className="tabular-nums hidden sm:inline">
        {stats.words.toLocaleString()} words · {stats.characters.toLocaleString()} chars ·{' '}
        {stats.readingTimeMinutes} min read
      </span>
      <span className="sm:hidden tabular-nums">{stats.words.toLocaleString()} words</span>
      {showPreviewToggle && (
        <span className="ml-auto flex items-center gap-0.5 rounded-md bg-white dark:bg-night-muted p-0.5 border border-slate-200 dark:border-slate-700">
          {(['html', 'pdf'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setPreviewMode(mode)}
              className={clsx(
                'px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide',
                previewMode === mode
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white',
              )}
            >
              {mode}
            </button>
          ))}
        </span>
      )}
      {!showPreviewToggle && (
        <span className="ml-auto uppercase tracking-wider text-[10px] text-slate-400 dark:text-slate-500">
          {language} · read-only preview
        </span>
      )}
    </footer>
  );
}
