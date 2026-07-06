import { useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, FolderArchive, FolderPlus, FileText, FileCode, FileImage, FileType, Trash2, Eye, Download, Upload, X, Pencil, Package } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { formatSize, unpackArchive, detectArchiveKind } from '@/lib/archive';
import { extractXfaXml } from '@/lib/pdfXfaExtract';
import { ArchiveExportDialog } from '@/components/Dialogs/ArchiveExportDialog';
import { toast } from '@/components/ui/Toast';
import type { Archive, ArchiveEntry } from '@/types';

/** Marker filename used to keep an otherwise-empty folder visible in the
 *  tree. Filtered out of the rendered UI and skipped by export. Matches
 *  the sentinel written by `createCollectionFolder` in the store. */
const FOLDER_KEEP = '.folder-keep';

/** MIME-ish type strings we set on `DataTransfer` for cross-collection
 *  drags. Kept as constants so both the setter and the reader agree —
 *  DataTransfer silently returns "" if the type string doesn't match. */
const DND_ENTRY = 'application/x-docstudio-entry';
const DND_FOLDER = 'application/x-docstudio-folder';
/** Payload emitted by tabs in ActiveFiles when the user drags a loose
 *  workspace doc onto a collection. Semantically an "add" — the doc gets
 *  linked to the collection via `addToCollection`, which also patches
 *  the workspace file so it re-parents into the collection group. */
const DND_DOC = 'application/x-docstudio-doc';

/** Payload shape shared by both internal-entry drag types. */
interface DndPayload {
  archiveId: string;
  path: string;
}
interface DndDocPayload {
  fileId: string;
}

interface Props {
  onSelect?: () => void;
}

/**
 * Sidebar panel that surfaces every registered container archive
 * (docx / xlsx / pptx / epub / zip) as a browsable folder tree.
 *
 * Clicking a text entry opens it as a tab (or switches to the existing one
 * if already open). Binary entries (images, fonts) are shown for context
 * but not clickable. A `×` next to each archive header removes the archive
 * and closes all of its tabs.
 */
export function ArchivePanel({ onSelect }: Props) {
  const archives = useAppStore((s) => s.workspace.archives);
  const createCollection = useAppStore((s) => s.createCollection);

  const handleNewCollection = () => {
    const name = window.prompt('Collection name', 'My collection');
    if (name === null) return;
    const id = createCollection(name);
    toast.success(`Collection created`);
    // (id is unused here — the panel will auto-render the new archive.)
    void id;
  };

  if (archives.length === 0) {
    return (
      <div className="px-2 py-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
        <FolderArchive size={28} className="mx-auto opacity-40" />
        <p>No archives open yet.</p>
        <p className="opacity-70">
          Import a <code>.docx</code>, <code>.xlsx</code>, <code>.pptx</code>,{' '}
          <code>.epub</code>, <code>.tex</code> or plain <code>.zip</code> to browse its parts
          here.
        </p>
        <button
          type="button"
          onClick={handleNewCollection}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:border-brand-400 dark:hover:border-brand-500 text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-300 transition-colors"
        >
          <FolderPlus size={12} /> New collection
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end px-1">
        <button
          type="button"
          onClick={handleNewCollection}
          title="Create an empty collection you can drop files into"
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-300 transition-colors"
        >
          <FolderPlus size={11} /> New collection
        </button>
      </div>
      {archives.map((archive) => (
        <ArchiveNode key={archive.id} archive={archive} onSelect={onSelect} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-archive node with a nested folder tree
// ---------------------------------------------------------------------------

function ArchiveNode({ archive, onSelect }: { archive: Archive; onSelect?: () => void }) {
  const closeArchive = useAppStore((s) => s.closeArchive);
  const importFilesIntoCollection = useAppStore((s) => s.importFilesIntoCollection);
  const openArchiveEntry = useAppStore((s) => s.openArchiveEntry);
  const createCollectionFolder = useAppStore((s) => s.createCollectionFolder);
  const moveEntryToCollection = useAppStore((s) => s.moveEntryToCollection);
  const addToCollection = useAppStore((s) => s.addToCollection);
  // Grab file list lazily inside the drop handler — we don't need to
  // subscribe the whole panel to workspace.files churn.
  const getFiles = useAppStore.getState;
  const tree = useMemo(() => buildTree(archive.entries), [archive.entries]);
  // Export dialog state — driven either from the archive header ("export
  // everything") or from a folder row's kebab ("export this subfolder").
  const [exportFor, setExportFor] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // Hidden file input for the per-collection import button. Kept per-node
  // so multiple collections don't fight over the same input element.
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Drag-and-drop hover state. Only tracked for collections — dropping on
  // a real archive (docx/xlsx/…) makes no sense; those are read-only.
  const [dragOver, setDragOver] = useState(false);
  const [internalDragOver, setInternalDragOver] = useState(false);

  const openExport = (folderPath?: string) => {
    setExportFor(folderPath ?? null);
    setExportOpen(true);
  };

  const isCollection = archive.kind === 'zip';

  const handleImport = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const wasEmpty = archive.entries.length === 0;
    const first = await importFilesIntoCollection(archive.id, files);
    if (first) {
      toast.success(
        `Added ${files.length} file${files.length === 1 ? '' : 's'} to "${archive.name}"`,
      );
      // Open the first newly-added entry as a tab so the user sees
      // immediate feedback — matches the "import file" ergonomics of the
      // header button.
      if (wasEmpty) openArchiveEntry(archive.id, first);
    } else {
      toast.error('Nothing imported — unsupported file type(s).');
    }
  };

  const handleNewFolder = () => {
    const name = window.prompt('Folder name (use `/` for nested paths)', 'new-folder');
    if (name === null) return;
    const cleaned = name.trim();
    if (!cleaned) return;
    createCollectionFolder(archive.id, cleaned);
    toast.success(`Folder "${cleaned}" created`);
  };

  // ---- Drag-and-drop wiring (collections only) --------------------------
  // The three-handler dance is standard HTML5 DnD: dragOver + preventDefault
  // to signal "I accept this", dragLeave to reset hover state, drop to
  // consume the payload.
  //
  // Two accepted payload sources:
  //   1. External files from the OS (`Files` type) → import into collection.
  //   2. Internal entries (`application/x-docstudio-entry` type) → MOVE
  //      the entry from its source archive to this collection's root.
  const onDragOver = (e: React.DragEvent) => {
    if (!isCollection) return;
    const types = e.dataTransfer.types;
    const isExternal = types.includes('Files');
    const isInternal =
      types.includes(DND_ENTRY) || types.includes(DND_FOLDER) || types.includes(DND_DOC);
    if (!isExternal && !isInternal) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy';
    if (isExternal && !dragOver) setDragOver(true);
    if (isInternal && !internalDragOver) setInternalDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!isCollection) return;
    // relatedTarget can be null when dragging outside the window entirely,
    // or a child element on interior transitions. We only want to clear on
    // real exits.
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as Node).contains(next)) return;
    setDragOver(false);
    setInternalDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!isCollection) return;
    e.preventDefault();
    setDragOver(false);
    setInternalDragOver(false);
    // Priority order:
    //   1. Entry / folder move — the user grabbed an existing collection
    //      item and moved it here. Wins over Files because some OSes
    //      populate `.files` with a stale reference alongside our payload.
    //   2. Loose-doc add — a tab that wasn't in any collection was
    //      dragged onto this card. Fires `addToCollection` which also
    //      re-parents the workspace file so it flows into the group.
    //   3. External OS files — treated as a file-picker import.
    const internal = e.dataTransfer.getData(DND_ENTRY) || e.dataTransfer.getData(DND_FOLDER);
    if (internal) {
      try {
        const payload = JSON.parse(internal) as DndPayload;
        // No-op guard: dropping a root-level entry onto its own collection
        // root would create an infinite dedup loop (`file.md`, `file (2).md`, …).
        if (payload.archiveId === archive.id && !payload.path.includes('/')) return;
        moveEntryToCollection(payload.archiveId, payload.path, archive.id, '');
        toast.success(`Moved to "${archive.name}"`);
      } catch {
        toast.error('Move failed — malformed drag payload');
      }
      return;
    }
    const docRaw = e.dataTransfer.getData(DND_DOC);
    if (docRaw) {
      try {
        const payload = JSON.parse(docRaw) as DndDocPayload;
        const file = getFiles().workspace.files.find((f) => f.id === payload.fileId);
        if (!file) {
          toast.error('Dropped doc no longer exists');
          return;
        }
        // If the doc already lives in this collection, do nothing —
        // dragging a tab onto its own group is a no-op, not a duplicate.
        if (file.archiveId === archive.id) return;
        addToCollection(archive.id, file);
        toast.success(`Added to "${archive.name}"`);
      } catch {
        toast.error('Add failed — malformed drag payload');
      }
      return;
    }
    if (e.dataTransfer.files.length > 0) {
      void handleImport(e.dataTransfer.files);
    }
  };

  return (
    <section
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={clsx(
        'rounded-lg border overflow-hidden transition-colors',
        dragOver
          ? 'border-emerald-400 dark:border-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-900/50'
          : internalDragOver
            ? 'border-brand-400 dark:border-brand-500 ring-2 ring-brand-200 dark:ring-brand-900/50'
            : 'border-slate-200 dark:border-slate-700',
      )}
    >
      <header className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 dark:bg-night-muted border-b border-slate-200 dark:border-slate-700">
        <FolderArchive size={14} className={clsx('flex-shrink-0', isCollection ? 'text-emerald-500' : 'text-brand-500')} />
        <span className="text-xs font-medium truncate flex-1" title={archive.name}>
          {archive.name}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {isCollection ? 'collection' : archive.kind}
        </span>
        {isCollection && (
          <button
            type="button"
            aria-label={`New folder in ${archive.name}`}
            title="Create an empty folder"
            onClick={handleNewFolder}
            className="text-slate-400 hover:text-brand-500 p-0.5 rounded transition-colors"
          >
            <FolderPlus size={12} />
          </button>
        )}
        {isCollection && (
          <button
            type="button"
            aria-label={`Import files into ${archive.name}`}
            title="Import files into this collection"
            onClick={() => fileInputRef.current?.click()}
            className="text-slate-400 hover:text-emerald-500 p-0.5 rounded transition-colors"
          >
            <Upload size={12} />
          </button>
        )}
        <button
          type="button"
          aria-label={`Export ${archive.name}`}
          title="Export archive (ZIP or concatenated)"
          onClick={() => openExport(undefined)}
          disabled={archive.entries.length === 0}
          className="text-slate-400 hover:text-brand-500 disabled:opacity-30 disabled:hover:text-slate-400 p-0.5 rounded transition-colors"
        >
          <Download size={12} />
        </button>
        <button
          type="button"
          aria-label={`Close archive ${archive.name}`}
          title={isCollection ? 'Delete collection' : 'Close archive and its tabs'}
          onClick={() => closeArchive(archive.id)}
          className="text-slate-400 hover:text-rose-500 p-0.5 rounded transition-colors"
        >
          <Trash2 size={12} />
        </button>
      </header>
      {isCollection && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".md,.markdown,.txt,.html,.htm,.json,.xml,.tex,.latex"
          onChange={(e) => {
            void handleImport(e.target.files);
            e.currentTarget.value = '';
          }}
        />
      )}
      {archive.entries.length === 0 ? (
        <div className="px-3 py-4 text-center text-[11px] text-slate-400 dark:text-slate-500 space-y-2">
          <p>Empty collection.</p>
          {isCollection && (
            <div className="flex justify-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-300 transition-colors"
              >
                <Upload size={11} /> Import files
              </button>
              <button
                type="button"
                onClick={handleNewFolder}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:border-brand-400 dark:hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-300 transition-colors"
              >
                <FolderPlus size={11} /> New folder
              </button>
            </div>
          )}
          {isCollection && (
            <p className="opacity-70">
              …or drag &amp; drop files (or entries from other collections)
              onto this card.
            </p>
          )}
        </div>
      ) : (
        <div className="py-1">
          <TreeChildren
            nodes={tree}
            depth={0}
            archiveId={archive.id}
            primaryPath={archive.primaryPath}
            onSelect={onSelect}
            onExportFolder={openExport}
            isCollection={isCollection}
          />
        </div>
      )}
      {exportOpen && (
        <ArchiveExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          archive={archive}
          folderPath={exportFor ?? undefined}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Folder tree
// ---------------------------------------------------------------------------

interface TreeNode {
  name: string;
  fullPath: string;
  entry?: ArchiveEntry; // leaf
  children?: TreeNode[];
}

/** Build a nested folder tree from a flat list of entry paths. */
function buildTree(entries: ArchiveEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', fullPath: '', children: [] };
  for (const entry of entries) {
    const parts = entry.path.split('/');
    // `.folder-keep` sentinels exist purely to reify empty folders. The
    // parent-folder walk below still runs so the folder shows up, but we
    // stop before pushing the sentinel itself as a leaf so it never
    // renders as a phantom "file".
    const isSentinel = parts[parts.length - 1] === FOLDER_KEEP;
    const walkLen = isSentinel ? parts.length - 1 : parts.length;
    let cursor = root;
    for (let i = 0; i < walkLen; i++) {
      const part = parts[i];
      const isLeaf = !isSentinel && i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');
      cursor.children ??= [];
      let child = cursor.children.find((c) => c.name === part);
      if (!child) {
        child = isLeaf
          ? { name: part, fullPath, entry }
          : { name: part, fullPath, children: [] };
        cursor.children.push(child);
      } else if (!child.children && !isLeaf) {
        // A previous leaf entry occupied this slot and a later sentinel
        // now wants it as a folder. Convert to a folder — retain the
        // original entry as a hidden child so it isn't lost.
        child.children = [];
      }
      cursor = child;
    }
  }
  return sortNodes(root.children ?? []);
}

/** Directories first, then files, each alphabetically. Matches VS Code. */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  const sorted = nodes
    .map((n) => (n.children ? { ...n, children: sortNodes(n.children) } : n))
    .sort((a, b) => {
      const aIsDir = !!a.children;
      const bIsDir = !!b.children;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return sorted;
}

function TreeChildren({
  nodes,
  depth,
  archiveId,
  primaryPath,
  onSelect,
  onExportFolder,
  isCollection,
}: {
  nodes: TreeNode[];
  depth: number;
  archiveId: string;
  primaryPath?: string;
  onSelect?: () => void;
  onExportFolder: (folderPath?: string) => void;
  isCollection: boolean;
}) {
  return (
    <ul className="list-none">
      {nodes.map((node) => (
        <TreeNodeRow
          key={node.fullPath}
          node={node}
          depth={depth}
          archiveId={archiveId}
          primaryPath={primaryPath}
          onSelect={onSelect}
          onExportFolder={onExportFolder}
          isCollection={isCollection}
        />
      ))}
    </ul>
  );
}

function TreeNodeRow({
  node,
  depth,
  archiveId,
  primaryPath,
  onSelect,
  onExportFolder,
  isCollection,
}: {
  node: TreeNode;
  depth: number;
  archiveId: string;
  primaryPath?: string;
  onSelect?: () => void;
  onExportFolder: (folderPath?: string) => void;
  isCollection: boolean;
}) {
  const openArchiveEntry = useAppStore((s) => s.openArchiveEntry);
  const openArchive = useAppStore((s) => s.openArchive);
  const activeId = useAppStore((s) => s.workspace.activeId);
  const removeFromCollection = useAppStore((s) => s.removeFromCollection);
  const renameCollectionEntry = useAppStore((s) => s.renameCollectionEntry);
  const moveEntryToCollection = useAppStore((s) => s.moveEntryToCollection);
  const createCollectionFolder = useAppStore((s) => s.createCollectionFolder);
  // Default: expand top-level folders and any ancestor of the primary entry
  // so the interesting bit is visible on open. Deeper folders start collapsed.
  const [expanded, setExpanded] = useState(
    depth <= 1 || (!!primaryPath && primaryPath.startsWith(`${node.fullPath}/`)),
  );
  const [folderDragOver, setFolderDragOver] = useState(false);

  const isDir = !!node.children;
  const isActive = node.entry?.docId === activeId;
  const isOpenable = node.entry && !node.entry.isBinary;
  // Binary entries we created ourselves (base64 stashed on the entry)
  // are viewable: PDFs open in a new browser tab, images in a small
  // popup. Anything else offers a download. This complements
  // `isOpenable` — one of the two is always true for a leaf entry.
  const hasBinaryBlob = !!node.entry?.isBinary && !!node.entry?.binaryBase64;
  const isPrimary = node.entry && node.entry.path === primaryPath;

  const clickable = isDir || isOpenable || hasBinaryBlob;

  /** Turn a base64 string + MIME into a same-tab-lifetime blob URL. Kept
   *  as a helper because both "open in new tab" and "download" paths
   *  need the same conversion — data URLs blow up the browser at PDF
   *  sizes, so we always route through a Blob. */
  const blobUrlFromBase64 = (b64: string, mime: string): string => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  };

  const handleClick = () => {
    if (isDir) {
      setExpanded((v) => !v);
    } else if (isOpenable && node.entry) {
      openArchiveEntry(archiveId, node.entry.path);
      onSelect?.();
    } else if (hasBinaryBlob && node.entry) {
      // Binary open: PDFs and images render natively in a new browser
      // tab; anything else triggers a download so the user isn't
      // stranded with a file trapped in localStorage.
      const mime = node.entry.mimeType ?? 'application/octet-stream';
      const url = blobUrlFromBase64(node.entry.binaryBase64!, mime);
      if (mime === 'application/pdf' || mime.startsWith('image/')) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = node.entry.path.split('/').pop() ?? 'download';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // Revoke on the next tick so the new tab has time to grab the blob.
      // (Older Chromes need >0 ms; a small timeout is safer than 0.)
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };

  // Entries in ANY archive can be picked up; only collections can be the
  // destination (enforced by the move action).
  const handleDragStart = (e: React.DragEvent) => {
    if (node.entry) {
      const payload: DndPayload = { archiveId, path: node.entry.path };
      e.dataTransfer.setData(DND_ENTRY, JSON.stringify(payload));
    } else if (isDir) {
      // Folder drag: send the path with a trailing slash so the move
      // action treats it as a subtree operation.
      const payload: DndPayload = { archiveId, path: `${node.fullPath}/` };
      e.dataTransfer.setData(DND_FOLDER, JSON.stringify(payload));
    }
    e.dataTransfer.effectAllowed = 'move';
  };

  // Folder rows in collections accept drops → move-into-folder.
  const handleFolderDragOver = (e: React.DragEvent) => {
    if (!isDir || !isCollection) return;
    const types = e.dataTransfer.types;
    if (!types.includes(DND_ENTRY) && !types.includes(DND_FOLDER)) return;
    e.preventDefault();
    e.stopPropagation(); // don't let the archive-root handler also react
    e.dataTransfer.dropEffect = 'move';
    if (!folderDragOver) setFolderDragOver(true);
  };
  const handleFolderDragLeave = (e: React.DragEvent) => {
    if (!isDir || !isCollection) return;
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as Node).contains(next)) return;
    setFolderDragOver(false);
  };
  const handleFolderDrop = (e: React.DragEvent) => {
    if (!isDir || !isCollection) return;
    const internal =
      e.dataTransfer.getData(DND_ENTRY) || e.dataTransfer.getData(DND_FOLDER);
    if (!internal) return;
    e.preventDefault();
    e.stopPropagation();
    setFolderDragOver(false);
    try {
      const payload = JSON.parse(internal) as DndPayload;
      // No-op guard: dragging a folder into itself (or a descendant of
      // itself) would infinite-loop. Detect by prefix.
      if (
        payload.archiveId === archiveId &&
        (payload.path === `${node.fullPath}/` ||
          node.fullPath.startsWith(payload.path))
      ) {
        toast.error('Cannot move a folder into itself.');
        return;
      }
      moveEntryToCollection(payload.archiveId, payload.path, archiveId, node.fullPath);
      toast.success(`Moved into "${node.name}"`);
    } catch {
      toast.error('Move failed — malformed drag payload');
    }
  };

  const handleNewSubfolder = () => {
    const name = window.prompt(`New folder inside "${node.name}"`, 'subfolder');
    if (name === null) return;
    const cleaned = name.trim();
    if (!cleaned) return;
    createCollectionFolder(archiveId, `${node.fullPath}/${cleaned}`);
    setExpanded(true);
  };

  /** Rename this entry — kept in the same folder unless the user
   *  types a `/` in the new name (which effectively moves it). */
  const handleRename = () => {
    if (!node.entry) return;
    const oldPath = node.entry.path;
    const oldName = oldPath.split('/').pop() ?? oldPath;
    const nextName = window.prompt('New filename', oldName);
    if (nextName === null) return;
    const cleaned = nextName.trim();
    if (!cleaned || cleaned === oldName) return;
    // Preserve the folder unless the user explicitly typed a path.
    const newPath = cleaned.includes('/')
      ? cleaned
      : oldPath.slice(0, oldPath.length - oldName.length) + cleaned;
    try {
      renameCollectionEntry(archiveId, oldPath, newPath);
      toast.success(`Renamed to "${cleaned}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
    }
  };

  /** Unpack a ZIP-family binary entry as a nested archive so the user
   *  can browse its contents without downloading + re-importing. Only
   *  offered when the entry has retained bytes (base64 stashed by
   *  `addBinaryToCollection` — archive-unpacked entries don't). */
  const handleUnpack = async () => {
    if (!node.entry?.binaryBase64) return;
    const leaf = node.entry.path.split('/').pop() ?? node.entry.path;
    const kind = detectArchiveKind(leaf);
    if (!kind) {
      toast.error(`Cannot unpack — unknown archive type for "${leaf}"`);
      return;
    }
    try {
      const b64 = node.entry.binaryBase64;
      const bytes = new Uint8Array(atob(b64).length);
      const bin = atob(b64);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const archive = await unpackArchive(bytes.buffer, leaf, kind);
      openArchive(archive);
      toast.success(`Unpacked "${leaf}" (${archive.entries.length} entries)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unpack failed');
    }
  };

  /** Rough "is this a zip we can unpack?" test for gating the button. */
  const isUnpackable = (() => {
    if (!node.entry?.binaryBase64) return false;
    const leaf = node.entry.path.split('/').pop() ?? '';
    return !!detectArchiveKind(leaf);
  })();

  /** Is this a PDF we can attempt XFA extraction on? Any stored PDF blob
   *  qualifies — the extractor itself decides whether XFA is present. */
  const isXfaCandidate = (() => {
    if (!node.entry?.binaryBase64) return false;
    const mime = node.entry.mimeType ?? '';
    if (mime === 'application/pdf') return true;
    const leaf = node.entry.path.split('/').pop() ?? '';
    return /\.pdf$/i.test(leaf);
  })();

  /** Extract the XFA (XDP) XML from a stored dynamic-PDF entry and open
   *  it in a fresh XML tab. Mirrors what the server-side
   *  `extractXmlXdpFromDynamicPdf` endpoint returns, but without the
   *  round-trip. Static PDFs (no XFA content) get a clear toast. */
  const handleExtractXfa = async () => {
    if (!node.entry?.binaryBase64) return;
    try {
      const b64 = node.entry.binaryBase64;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const hit = await extractXfaXml(bytes);
      if (!hit) {
        toast.info('No XFA content found — this looks like a static PDF.');
        return;
      }
      const leaf = node.entry.path.split('/').pop() ?? 'form.pdf';
      const xdpName = leaf.replace(/\.pdf$/i, '.xdp');
      // Open as a new tab via the store's openFile so the user sees it
      // immediately in the editor. `openFile` also seeds `original` for
      // dirty tracking.
      useAppStore.getState().openFile(hit.xml, 'xml', xdpName);
      onSelect?.();
      toast.success(`Extracted XFA XML (${formatSize(hit.xml.length)})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'XFA extraction failed');
    }
  };

  return (
    <li>
      <div
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : -1}
        draggable={isCollection && (isDir || !!node.entry)}
        onDragStart={handleDragStart}
        onDragOver={handleFolderDragOver}
        onDragLeave={handleFolderDragLeave}
        onDrop={handleFolderDrop}
        onClick={clickable ? handleClick : undefined}
        onKeyDown={(e) => {
          if (!clickable) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        className={clsx(
          'group flex items-center gap-1 py-0.5 pr-2 text-xs rounded transition-colors',
          clickable ? 'cursor-pointer' : 'cursor-default',
          folderDragOver && 'ring-1 ring-brand-400 dark:ring-brand-500 bg-brand-50 dark:bg-brand-900/20',
          isActive
            ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-800 dark:text-brand-100'
            : clickable
              ? 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
              : 'text-slate-400 dark:text-slate-500',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={node.entry ? `${node.fullPath} · ${formatSize(node.entry.size)}` : node.fullPath}
      >
        {isDir ? (
          expanded ? (
            <ChevronDown size={12} className="flex-shrink-0" />
          ) : (
            <ChevronRight size={12} className="flex-shrink-0" />
          )
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        <EntryIcon node={node} />
        <span
          className={clsx(
            'truncate flex-1 min-w-0',
            isPrimary && !isActive && 'font-medium',
            node.entry?.isRendered && 'italic',
          )}
        >
          {node.entry?.isRendered ? 'Rendered preview' : node.name}
        </span>
        {node.entry && (
          <span className="text-[10px] tabular-nums opacity-50 group-hover:opacity-80 flex-shrink-0">
            {formatSize(node.entry.size)}
          </span>
        )}
        {isDir && isCollection && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNewSubfolder();
            }}
            title={`New folder inside "${node.name}"`}
            aria-label={`New folder inside ${node.name}`}
            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-brand-500 flex-shrink-0 transition-opacity"
          >
            <FolderPlus size={10} />
          </button>
        )}
        {isDir && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onExportFolder(node.fullPath);
            }}
            title={`Export "${node.name}" folder`}
            aria-label={`Export folder ${node.name}`}
            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-brand-500 flex-shrink-0 transition-opacity"
          >
            <Download size={10} />
          </button>
        )}
        {isCollection && node.entry && isUnpackable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleUnpack();
            }}
            title="Unpack this archive inline"
            aria-label={`Unpack ${node.name}`}
            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-brand-500 flex-shrink-0 transition-opacity"
          >
            <Package size={10} />
          </button>
        )}
        {isCollection && node.entry && isXfaCandidate && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleExtractXfa();
            }}
            title="Extract XFA (dynamic form) XML from this PDF"
            aria-label={`Extract XFA from ${node.name}`}
            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-emerald-500 flex-shrink-0 transition-opacity"
          >
            <FileCode size={10} />
          </button>
        )}
        {isCollection && node.entry && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRename();
            }}
            title="Rename entry"
            aria-label={`Rename ${node.name}`}
            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-brand-500 flex-shrink-0 transition-opacity"
          >
            <Pencil size={10} />
          </button>
        )}
        {isCollection && node.entry && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Remove "${node.name}" from this collection?`)) {
                removeFromCollection(archiveId, node.entry!.path);
              }
            }}
            title="Remove from collection"
            aria-label={`Remove ${node.name} from collection`}
            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500 flex-shrink-0 transition-opacity"
          >
            <X size={10} />
          </button>
        )}
      </div>
      {isDir && expanded && node.children && (
        <TreeChildren
          nodes={node.children}
          depth={depth + 1}
          archiveId={archiveId}
          primaryPath={primaryPath}
          onSelect={onSelect}
          onExportFolder={onExportFolder}
          isCollection={isCollection}
        />
      )}
    </li>
  );
}

function EntryIcon({ node }: { node: TreeNode }) {
  if (node.children) {
    // Folder icon slot — left blank so the chevron carries the affordance.
    return <span className="w-3 flex-shrink-0" />;
  }
  const entry = node.entry;
  if (!entry) return <span className="w-3 flex-shrink-0" />;
  const cls = 'flex-shrink-0 opacity-60';
  // Synthetic rendered preview → eye icon so it's obviously "the pretty view".
  if (entry.isRendered) {
    return <Eye size={12} className="flex-shrink-0 text-brand-500" />;
  }
  // Openable image entry — tinted so it stands out from raw binaries.
  if (entry.isImage) {
    return <FileImage size={12} className="flex-shrink-0 text-emerald-500" />;
  }
  if (entry.isBinary) {
    // Rough by extension — image vs everything else.
    const ext = entry.path.split('.').pop()?.toLowerCase() ?? '';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
      return <FileImage size={12} className={cls} />;
    }
    return <FileType size={12} className={cls} />;
  }
  if (entry.language === 'xml' || entry.language === 'html' || entry.language === 'json') {
    return <FileCode size={12} className={cls} />;
  }
  return <FileText size={12} className={cls} />;
}
