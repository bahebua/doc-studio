import { useState, useMemo, useRef, useEffect } from 'react';
import { X, FileText, FolderArchive, ChevronDown, ChevronRight, Eye, FolderPlus } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/components/ui/Toast';
import type { Archive, Document, Language } from '@/types';

const LANG_BADGE: Record<Language, string> = {
  markdown: 'MD',
  json: 'JS',
  xml: 'XM',
  html: 'HT',
};

function isDirty(file: Document): boolean {
  return typeof file.original === 'string' && file.original !== file.content;
}

interface Props {
  onSelect?: () => void;
}

/**
 * Sidebar mirror of the editor tab strip. Standalone files are listed at
 * the top; every tab that originated from an archive is nested under a
 * collapsible group headed by the archive's name — so a `.docx` with a
 * rendered preview plus several XML parts open reads as one unit rather
 * than eight peers.
 */
export function ActiveFiles({ onSelect }: Props) {
  const files = useAppStore((s) => s.workspace.files);
  const activeId = useAppStore((s) => s.workspace.activeId);
  const archives = useAppStore((s) => s.workspace.archives);
  const switchFile = useAppStore((s) => s.switchFile);
  const closeFile = useAppStore((s) => s.closeFile);
  const closeArchive = useAppStore((s) => s.closeArchive);

  const { looseFiles, groups } = useMemo(() => {
    const loose: Document[] = [];
    const byArchive = new Map<string, Document[]>();
    for (const file of files) {
      if (file.archiveId && archives.some((a) => a.id === file.archiveId)) {
        const list = byArchive.get(file.archiveId) ?? [];
        list.push(file);
        byArchive.set(file.archiveId, list);
      } else {
        loose.push(file);
      }
    }
    const groups = archives
      .map((archive) => ({ archive, files: byArchive.get(archive.id) ?? [] }))
      .filter((g) => g.files.length > 0);
    return { looseFiles: loose, groups };
  }, [files, archives]);

  if (files.length === 0) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400 px-2 py-3">
        No files open.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {looseFiles.length > 0 && (
        <ul className="space-y-0.5">
          {looseFiles.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              activeId={activeId}
              onSwitch={() => {
                switchFile(file.id);
                onSelect?.();
              }}
              // Sidebar × is the "safe close" surface: always stash
              // unsaved orphans into the "Unsaved" collection so nothing
              // is ever lost by mistake. Files already backed by a
              // collection close silently — their content stays in the
              // archive tree regardless.
              onClose={() => closeFile(file.id, { stashUnsaved: true })}
            />
          ))}
        </ul>
      )}

      {groups.map(({ archive, files: archiveFiles }) => (
        <ArchiveGroup
          key={archive.id}
          archive={archive}
          files={archiveFiles}
          activeId={activeId}
          onSwitch={(id) => {
            switchFile(id);
            onSelect?.();
          }}
          // Group entries always live in a collection — no stash needed.
          onClose={(id) => closeFile(id)}
          onCloseArchive={() => closeArchive(archive.id)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Archive group
// ---------------------------------------------------------------------------

interface ArchiveGroupProps {
  archive: Archive;
  files: Document[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onCloseArchive: () => void;
}

function ArchiveGroup({
  archive,
  files,
  activeId,
  onSwitch,
  onClose,
  onCloseArchive,
}: ArchiveGroupProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
      <header className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 dark:bg-night-muted border-b border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <FolderArchive size={13} className="text-brand-500 flex-shrink-0" />
          <span className="text-xs font-medium truncate" title={archive.name}>
            {archive.name}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 flex-shrink-0">
            {archive.kind}
          </span>
          <span className="ml-auto text-[10px] tabular-nums text-slate-400 dark:text-slate-500 flex-shrink-0">
            {files.length}
          </span>
        </button>
        <button
          type="button"
          aria-label={`Close archive ${archive.name}`}
          title="Close archive and its tabs"
          onClick={onCloseArchive}
          className="text-slate-400 hover:text-rose-500 p-0.5 rounded transition-colors flex-shrink-0"
        >
          <X size={12} />
        </button>
      </header>
      {expanded && (
        <ul className="py-1 px-1 space-y-0.5">
          {files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              activeId={activeId}
              archive={archive}
              indent
              onSwitch={() => onSwitch(file.id)}
              onClose={() => onClose(file.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Single-file row (used both loose and inside archive groups)
// ---------------------------------------------------------------------------

interface FileRowProps {
  file: Document;
  activeId: string | null;
  archive?: Archive;
  indent?: boolean;
  onSwitch: () => void;
  onClose: () => void;
}

function FileRow({ file, activeId, archive, indent, onSwitch, onClose }: FileRowProps) {
  const active = file.id === activeId;
  const dirty = isDirty(file);
  const lang = (file.language ?? 'markdown') as Language;
  const isRendered = archive?.entries.find((e) => e.path === file.archivePath)?.isRendered;
  const title = archive
    ? `${archive.name} › ${file.archivePath ?? file.title}`
    : file.title;

  // Add-to-collection lives on the row so a doc can be assigned without
  // hunting through a menu. Only surfaces for loose files (archive tabs are
  // already scoped to an archive).
  //
  // IMPORTANT: select the raw archives array (referentially stable across
  // renders) and derive `collections` via useMemo. Filtering inside the
  // selector returns a new array every render, which zustand treats as a
  // state change and triggers an infinite re-render loop.
  const allArchives = useAppStore((s) => s.workspace.archives);
  const collections = useMemo(
    () => allArchives.filter((a) => a.kind === 'zip' && a.id !== file.archiveId),
    [allArchives, file.archiveId],
  );
  const addToCollection = useAppStore((s) => s.addToCollection);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pickerOpen]);

  const handleAdd = (collectionId: string) => {
    addToCollection(collectionId, file);
    setPickerOpen(false);
    toast.success(`Added to collection`);
  };

  return (
    <li>
      <div
        // A row is always draggable. Two payload flavours are emitted so
        // ArchivePanel can distinguish an "already-in-a-collection entry
        // move" from a "loose doc → collection add":
        //   - `application/x-docstudio-entry`  → move an existing archive entry
        //   - `application/x-docstudio-doc`    → drop a workspace doc into a collection
        // We include both when the file belongs to a collection; the drop
        // target picks whichever it understands (entry-move wins so a
        // same-collection drop is a no-op instead of a duplicate add).
        draggable
        onDragStart={(e) => {
          if (archive && archive.kind === 'zip' && file.archivePath) {
            const entryPayload = { archiveId: archive.id, path: file.archivePath };
            e.dataTransfer.setData(
              'application/x-docstudio-entry',
              JSON.stringify(entryPayload),
            );
          }
          e.dataTransfer.setData(
            'application/x-docstudio-doc',
            JSON.stringify({ fileId: file.id }),
          );
          e.dataTransfer.effectAllowed = 'move';
        }}
        className={clsx(
          'group flex items-center gap-2 py-1.5 rounded-md text-sm cursor-pointer',
          indent ? 'pl-3 pr-2' : 'px-2',
          active
            ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-800 dark:text-brand-200'
            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
        )}
        onClick={onSwitch}
        title={title}
      >
        {isRendered ? (
          <Eye size={14} className="flex-shrink-0 text-brand-500" />
        ) : archive ? (
          <FolderArchive size={14} className="flex-shrink-0 text-brand-500 opacity-70" />
        ) : (
          <FileText size={14} className="flex-shrink-0 opacity-60" />
        )}
        <span
          className={clsx(
            'text-[9px] font-bold tracking-wider px-1 py-0.5 rounded flex-shrink-0',
            'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
          )}
        >
          {LANG_BADGE[lang]}
        </span>
        <span className="truncate flex-1 min-w-0" title={file.title}>
          {file.title || 'Untitled'}
        </span>
        {dirty && (
          <span
            aria-label="Unsaved changes"
            className="h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0"
          />
        )}
        {!archive && collections.length > 0 && (
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              aria-label="Add to collection"
              title="Add to collection"
              onClick={(e) => {
                e.stopPropagation();
                if (collections.length === 1) {
                  handleAdd(collections[0].id);
                } else {
                  setPickerOpen((v) => !v);
                }
              }}
              className={clsx(
                'h-5 w-5 rounded flex items-center justify-center flex-shrink-0',
                'text-slate-400 hover:text-emerald-600 hover:bg-slate-200',
                'dark:hover:text-emerald-300 dark:hover:bg-slate-700',
                active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
            >
              <FolderPlus size={12} />
            </button>
            {pickerOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-6 z-20 min-w-[180px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-night shadow-lg py-1"
              >
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Add to
                </div>
                {collections.map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => handleAdd(col.id)}
                    className="w-full text-left px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5"
                  >
                    <FolderArchive size={11} className="text-emerald-500 flex-shrink-0" />
                    <span className="truncate">{col.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          aria-label={`Close ${file.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={clsx(
            'h-5 w-5 rounded flex items-center justify-center flex-shrink-0',
            'text-slate-400 hover:text-slate-800 hover:bg-slate-200',
            'dark:hover:text-white dark:hover:bg-slate-700',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <X size={12} />
        </button>
      </div>
    </li>
  );
}
