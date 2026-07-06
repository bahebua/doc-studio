import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, FolderArchive } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/components/ui/Toast';
import type { Document, Language } from '@/types';

const LANG_BADGE: Record<Language, string> = {
  markdown: 'MD',
  json: 'JS',
  xml: 'XM',
  html: 'HT',
};

function isDirty(file: Document): boolean {
  return typeof file.original === 'string' && file.original !== file.content;
}

/** Position + target for the right-click / long-press context menu. */
interface MenuState {
  x: number;
  y: number;
  fileId: string;
}

/**
 * Horizontal tab strip above the editor pane. Each open workspace file gets
 * a tab; the active tab is highlighted, and a small dot indicates unsaved
 * changes.
 *
 * Close behaviour follows the "collections are the source of truth" story:
 *
 *   - Tabs backed by a collection close silently — the data stays put in
 *     the archive tree, closing just unmounts the tab.
 *   - Orphan tabs (no `archiveId`) with unsaved content pop a confirm
 *     that offers "Move to Unsaved", or cancel. This is the safety net:
 *     users lose work only when they explicitly opt in.
 *
 * Right-clicking a tab surfaces the standard IDE menu (Close, Close
 * others, Close to the right / left, Close all). Batch closes reuse the
 * same orphan-stash prompt so a "Close all" with several dirty scratch
 * tabs asks once instead of nagging per-tab.
 */
export function EditorTabs() {
  const files = useAppStore((s) => s.workspace.files);
  const activeId = useAppStore((s) => s.workspace.activeId);
  const archives = useAppStore((s) => s.workspace.archives);
  const switchFile = useAppStore((s) => s.switchFile);
  const closeFile = useAppStore((s) => s.closeFile);
  const closeOthers = useAppStore((s) => s.closeOthers);
  const closeToRight = useAppStore((s) => s.closeToRight);
  const closeToLeft = useAppStore((s) => s.closeToLeft);
  const closeAll = useAppStore((s) => s.closeAll);
  const newFile = useAppStore((s) => s.newFile);

  const archiveById = useMemo(
    () => new Map(archives.map((a) => [a.id, a] as const)),
    [archives],
  );

  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Dismiss the menu on outside click / Escape / scroll.
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    const onScroll = () => setMenu(null);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [menu]);

  /**
   * Ask the user how to handle orphan-dirty tabs before actually closing.
   * Returns `true` if the caller should proceed with `stashUnsaved: true`,
   * `false` if there are no orphans (silent close is fine), or `null` if
   * the user cancelled and no tabs should close.
   *
   * A plain `window.confirm` here is deliberate — the third choice
   * (force-close, discard changes) is a footgun we can add later behind a
   * proper Modal if users ask for it. Right now the safe default is to
   * always stash, never discard.
   */
  const askAboutOrphans = (ids: string[]): boolean | null => {
    const orphansWithContent = files.filter(
      (f) =>
        ids.includes(f.id) &&
        !f.archiveId &&
        isDirty(f) &&
        (f.content?.length ?? 0) > 0,
    );
    if (orphansWithContent.length === 0) return false;
    const list = orphansWithContent
      .map((f) => `  • ${f.title || 'Untitled'}`)
      .join('\n');
    const answer = window.confirm(
      `Some tabs have unsaved changes and aren't in any collection:\n${list}\n\n` +
        `Click OK to stash them in the "Unsaved" collection before closing.\n` +
        `Click Cancel to keep them open.`,
    );
    return answer ? true : null;
  };

  const handleCloseOne = (fileId: string) => {
    const answer = askAboutOrphans([fileId]);
    if (answer === null) return;
    closeFile(fileId, { stashUnsaved: answer });
    if (answer) toast.info('Stashed to "Unsaved" collection');
  };

  const handleCloseOthers = (fileId: string) => {
    const ids = files.filter((f) => f.id !== fileId).map((f) => f.id);
    if (ids.length === 0) {
      setMenu(null);
      return;
    }
    const answer = askAboutOrphans(ids);
    if (answer === null) {
      setMenu(null);
      return;
    }
    closeOthers(fileId, { stashUnsaved: answer });
    if (answer) toast.info('Stashed to "Unsaved" collection');
    setMenu(null);
  };

  const handleCloseSide = (fileId: string, side: 'left' | 'right') => {
    const idx = files.findIndex((f) => f.id === fileId);
    if (idx < 0) return setMenu(null);
    const ids =
      side === 'right'
        ? files.slice(idx + 1).map((f) => f.id)
        : files.slice(0, idx).map((f) => f.id);
    if (ids.length === 0) {
      setMenu(null);
      return;
    }
    const answer = askAboutOrphans(ids);
    if (answer === null) {
      setMenu(null);
      return;
    }
    if (side === 'right') closeToRight(fileId, { stashUnsaved: answer });
    else closeToLeft(fileId, { stashUnsaved: answer });
    if (answer) toast.info('Stashed to "Unsaved" collection');
    setMenu(null);
  };

  const handleCloseAll = () => {
    const ids = files.map((f) => f.id);
    const answer = askAboutOrphans(ids);
    if (answer === null) {
      setMenu(null);
      return;
    }
    closeAll({ stashUnsaved: answer });
    if (answer) toast.info('Stashed to "Unsaved" collection');
    setMenu(null);
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Open files"
        className={clsx(
          'no-print flex items-stretch gap-0.5 overflow-x-auto',
          'bg-slate-100 dark:bg-night border-b border-slate-200 dark:border-slate-800',
          'h-9 pr-1',
        )}
      >
        {files.map((file) => {
          const active = file.id === activeId;
          const dirty = isDirty(file);
          const lang = (file.language ?? 'markdown') as Language;
          const archive = file.archiveId ? archiveById.get(file.archiveId) : undefined;
          const tabTitle = archive
            ? `${archive.name} › ${file.archivePath ?? file.title}`
            : file.title || 'Untitled';
          return (
            <div
              key={file.id}
              role="tab"
              aria-selected={active}
              className={clsx(
                'group relative flex items-center gap-1.5 pl-3 pr-1 min-w-0 max-w-[220px]',
                'text-xs cursor-pointer select-none border-r border-slate-200 dark:border-slate-800',
                active
                  ? 'bg-white dark:bg-night-soft text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-night-muted',
              )}
              onClick={() => switchFile(file.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  handleCloseOne(file.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, fileId: file.id });
              }}
              title={tabTitle}
            >
              {archive ? (
                <FolderArchive
                  size={11}
                  className="flex-shrink-0 text-brand-500"
                  aria-label={`From ${archive.name}`}
                />
              ) : (
                <span
                  className={clsx(
                    'text-[9px] font-bold tracking-wider px-1 py-0.5 rounded',
                    'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
                  )}
                >
                  {LANG_BADGE[lang]}
                </span>
              )}
              <span className="truncate">{file.title || 'Untitled'}</span>
              {dirty && (
                <span
                  aria-label="Unsaved changes"
                  className="h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0"
                />
              )}
              <button
                type="button"
                aria-label={`Close ${file.title}`}
                className={clsx(
                  'ml-1 h-5 w-5 rounded flex items-center justify-center flex-shrink-0',
                  'text-slate-400 hover:text-slate-800 hover:bg-slate-200 dark:hover:text-white dark:hover:bg-slate-700',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseOne(file.id);
                }}
              >
                <X size={12} />
              </button>
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-px h-0.5 bg-brand-500"
                />
              )}
            </div>
          );
        })}
        <button
          type="button"
          aria-label="New file"
          onClick={newFile}
          className={clsx(
            'ml-1 my-1 h-7 px-2 rounded flex items-center gap-1 text-xs',
            'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
            'hover:bg-slate-200 dark:hover:bg-slate-700',
          )}
        >
          <Plus size={12} />
          <span className="hidden sm:inline">New</span>
        </button>
      </div>

      {/* ── Right-click context menu ────────────────────────────────── */}
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Tab options"
          className="fixed z-50 min-w-[180px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-night shadow-xl py-1"
          style={{
            // Anchor at the click point but clamp to viewport so the menu
            // never spills off the right or bottom edge.
            left: Math.min(menu.x, window.innerWidth - 210),
            top: Math.min(menu.y, window.innerHeight - 220),
          }}
        >
          <MenuItem onClick={() => handleCloseOne(menu.fileId)}>Close</MenuItem>
          <MenuItem
            onClick={() => handleCloseOthers(menu.fileId)}
            disabled={files.length <= 1}
          >
            Close others
          </MenuItem>
          <MenuItem
            onClick={() => handleCloseSide(menu.fileId, 'right')}
            disabled={files.findIndex((f) => f.id === menu.fileId) >= files.length - 1}
          >
            Close to the right
          </MenuItem>
          <MenuItem
            onClick={() => handleCloseSide(menu.fileId, 'left')}
            disabled={files.findIndex((f) => f.id === menu.fileId) <= 0}
          >
            Close to the left
          </MenuItem>
          <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
          <MenuItem onClick={handleCloseAll}>Close all</MenuItem>
        </div>
      )}
    </>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'w-full text-left px-3 py-1.5 text-xs',
        disabled
          ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800',
      )}
    >
      {children}
    </button>
  );
}
