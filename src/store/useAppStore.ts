import { create } from 'zustand';
import type { Archive, ArchiveEntry, Document, Language, PreviewMode, Theme, ViewMode } from '@/types';
import {
  defaultSettings,
  listRecents,
  loadSettings,
  loadWorkspace,
  newDocument,
  pushRecent,
  removeRecent,
  saveSettings,
  saveWorkspace,
} from '@/lib/storage';
import { detectLanguage } from '@/lib/languageDetect';

interface HistoryEntry {
  content: string;
}

/**
 * The set of files currently "open" in the editor. Tabs. Persisted so a page
 * refresh restores your workspace.
 */
interface Workspace {
  files: Document[];
  activeId: string | null;
  /** Registered container archives (docx / xlsx / pptx / epub / zip). Every
   *  document whose `archiveId` matches one of these belongs to that
   *  archive and is browsable via the sidebar Archive panel. */
  archives: Archive[];
}

interface AppState {
  /** The active file, mirrored for O(1) consumer reads. Always defined:
   *  when no files are open the store keeps a blank scratch document. */
  document: Document;
  workspace: Workspace;
  recents: Document[];

  theme: Theme;
  viewMode: ViewMode;
  previewMode: PreviewMode;
  zenMode: boolean;
  showToc: boolean;

  past: HistoryEntry[];
  future: HistoryEntry[];

  isHydrated: boolean;

  // --- lifecycle -----------------------------------------------------------
  hydrate: () => Promise<void>;

  // --- active-file mutations ----------------------------------------------
  setContent: (content: string, opts?: { recordHistory?: boolean }) => void;
  setTitle: (title: string) => void;
  setLanguage: (language: Language) => void;

  // --- workspace mutations ------------------------------------------------
  /** Create a blank markdown tab and switch to it. */
  newFile: () => void;
  /** Open a file's content as a new tab and switch to it. */
  openFile: (content: string, language: Language, title?: string) => void;
  /** Open a previously-saved document (from Recents) as a new tab. */
  openDoc: (doc: Document) => void;
  /** Switch to a tab by id. */
  switchFile: (id: string) => void;
  /** Close a tab. If it's the last tab, replace with a blank scratch tab.
   *  When `stashUnsaved` is true and the doc has unsaved edits AND no
   *  collection linkage, the content is preserved in an auto-created
   *  "Unsaved" collection before the tab is removed. Default false so
   *  the tab-strip × behaves like a normal close — call sites that want
   *  the safety-net behaviour (sidebar × in Open Files) pass true. */
  closeFile: (id: string, opts?: { stashUnsaved?: boolean }) => void;
  /** Close every tab except the one with `keepId`. Silent — same rules
   *  as `closeFile` apply per tab (unsaved orphans stashed when the
   *  caller asks). */
  closeOthers: (keepId: string, opts?: { stashUnsaved?: boolean }) => void;
  /** Close every tab positioned to the right of `pivotId` in the tab
   *  strip (i.e. after it in `workspace.files`). */
  closeToRight: (pivotId: string, opts?: { stashUnsaved?: boolean }) => void;
  /** Close every tab positioned to the left of `pivotId` in the tab strip. */
  closeToLeft: (pivotId: string, opts?: { stashUnsaved?: boolean }) => void;
  /** Close every tab. Same stash-unsaved rules as `closeFile`. */
  closeAll: (opts?: { stashUnsaved?: boolean }) => void;
  /** Find-or-create the fixed "Unsaved" collection. Kept as a stable id
   *  (`col-unsaved`) so repeated stashes accumulate into one bucket
   *  instead of leaking a new archive per session. */
  ensureUnsavedCollection: () => string;
  /** Legacy alias — keeps existing callers working. Opens a new tab. */
  newDoc: (content?: string, language?: Language) => void;

  // --- archive mutations --------------------------------------------------
  /** Register a freshly-unpacked archive and open its primary entry as a tab. */
  openArchive: (archive: Archive) => void;
  /** Open (or switch to) a single entry inside a registered archive. */
  openArchiveEntry: (archiveId: string, entryPath: string) => void;
  /** Remove an archive and close every tab that originated from it. */
  closeArchive: (archiveId: string) => void;

  // --- collections (user-created archives) --------------------------------
  /** Create a new empty user archive (kind='zip') and return its id. */
  createCollection: (name: string) => string;
  /** Add a document into a collection at the given path (default:
   *  `${doc.title}.${ext}`). Existing paths are overwritten. */
  addToCollection: (archiveId: string, doc: Document, path?: string) => void;
  /** Import raw files (from a file picker) directly into a collection.
   *  Skips container archives — those should be opened as their own
   *  archives, not nested. Returns the first added entry path so the
   *  caller can optionally open it. */
  importFilesIntoCollection: (archiveId: string, files: File[]) => Promise<string | null>;
  /** Rename an entry inside a collection (e.g. move it into a subfolder). */
  renameCollectionEntry: (archiveId: string, oldPath: string, newPath: string) => void;
  /** Remove an entry from a collection. Does NOT close open tabs — the tab
   *  simply becomes a standalone document again. */
  removeFromCollection: (archiveId: string, entryPath: string) => void;
  /** Move an entry (or an entire subtree, when `fromPath` ends with `/`)
   *  between collections — or within a collection. `toArchiveId` must
   *  reference a `kind='zip'` archive; moves into real container archives
   *  are refused. `toFolder` is a folder prefix (may be empty for root).
   *  Open tabs pointing at the moved entries have their `archiveId` /
   *  `archivePath` fields patched in-place so nothing closes. */
  moveEntryToCollection: (
    fromArchiveId: string,
    fromPath: string,
    toArchiveId: string,
    toFolder?: string,
  ) => void;
  /** Register a new empty folder inside a collection. Implemented as a
   *  zero-byte `.folder-keep` sentinel entry so the folder shows up in the
   *  tree even before any file lands in it. */
  createCollectionFolder: (archiveId: string, folderPath: string) => void;
  /** Import a raw payload (from cURL response / drag-drop) into a
   *  collection at a specific path. Returns the final (possibly de-duped)
   *  path or `null` on failure. Pass `opts.overwrite` to update an
   *  existing entry in place instead of suffix-deduping. */
  addRawToCollection: (
    archiveId: string,
    path: string,
    content: string,
    language?: Language,
    opts?: { overwrite?: boolean },
  ) => string | null;
  /** Same as `addRawToCollection` but for binary payloads (PDF / image /
   *  octet-stream responses from cURL). `base64` is the encoded body,
   *  `mimeType` is what the origin server declared (used by the preview
   *  to pick a renderer), `byteSize` is the raw byte length for the size
   *  column in the tree UI. Returns the final path or `null`. Pass
   *  `opts.overwrite` to replace an existing entry at the same path. */
  addBinaryToCollection: (
    archiveId: string,
    path: string,
    base64: string,
    mimeType: string,
    byteSize: number,
    opts?: { overwrite?: boolean },
  ) => string | null;

  removeRecentDoc: (id: string) => Promise<void>;

  setTheme: (theme: Theme) => void;
  setViewMode: (mode: ViewMode) => void;
  setPreviewMode: (mode: PreviewMode) => void;
  toggleZen: () => void;
  toggleToc: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const HISTORY_LIMIT = 100;
const HISTORY_MIN_INTERVAL_MS = 400;

/** Stable id for the auto-created "Unsaved" bucket collection. Kept as a
 *  fixed string so the find-or-create dance always resolves to the same
 *  archive across sessions rather than leaking a new one per stash. */
const UNSAVED_COLLECTION_ID = 'col-unsaved';

let lastHistoryPush = 0;
let autosaveTimer: number | undefined;

function scheduleWorkspaceSave(getWs: () => Workspace) {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(async () => {
    const ws = getWs();
    await saveWorkspace(ws);
    // Also push the active doc into recents so it shows up again after full clear.
    const active = ws.files.find((f) => f.id === ws.activeId);
    if (active && (active.content || active.title !== 'Untitled document')) {
      await pushRecent(active);
    }
  }, 700);
}

/**
 * Immutably replace / add / remove a file inside a workspace, keeping the
 * active-id valid, and produce the new document mirror.
 */
function withFile(ws: Workspace, id: string, patch: Partial<Document>): { workspace: Workspace; document: Document } | null {
  const idx = ws.files.findIndex((f) => f.id === id);
  if (idx < 0) return null;
  const updated: Document = { ...ws.files[idx], ...patch, updatedAt: Date.now() };
  const files = ws.files.slice();
  files[idx] = updated;
  const nextWs: Workspace = { files, activeId: ws.activeId, archives: ws.archives };
  return { workspace: nextWs, document: id === ws.activeId ? updated : ws.files.find((f) => f.id === ws.activeId) ?? updated };
}

/**
 * Retro-fix persisted workspaces where `.tex`/`.latex` entries (and any
 * documents opened from them) were tagged `language: 'xml'`. That was
 * the previous default for LaTeX sources, but it fed the tab into
 * `SourcePreview`, which failed with a DOMParser "Start tag expected"
 * error on the leading `\`. Migration is idempotent — a workspace
 * loaded fresh after this ships is a no-op.
 */
function migrateTexLanguage(ws: Workspace): Workspace {
  const isTexPath = (p?: string) =>
    !!p && /\.(tex|latex)$/i.test(p);

  let filesChanged = false;
  const files = ws.files.map((f) => {
    if (f.language === 'xml' && isTexPath(f.archivePath)) {
      filesChanged = true;
      return { ...f, language: 'markdown' as const };
    }
    return f;
  });

  let archivesChanged = false;
  const archives = ws.archives.map((archive) => {
    let entryChanged = false;
    const entries = archive.entries.map((e) => {
      if (e.language === 'xml' && isTexPath(e.path)) {
        entryChanged = true;
        return { ...e, language: 'markdown' as const };
      }
      return e;
    });
    if (!entryChanged) return archive;
    archivesChanged = true;
    return { ...archive, entries };
  });

  if (!filesChanged && !archivesChanged) return ws;
  return { ...ws, files, archives };
}

/**
 * Close one or more tabs in a single transaction. Kept as a helper (not a
 * store action) so batch operations like "close all" can commit exactly
 * one state update, avoiding a flurry of active-tab bounces on the way.
 *
 * When `stashUnsaved` is true, every closing tab that has real content
 * AND no collection linkage is copied into the auto-created "Unsaved"
 * collection first. This is the safety net for the sidebar × in Open
 * Files — the user asked for close-doesn't-lose-work semantics there.
 * Tabs that already belong to a collection are left alone; the collection
 * IS the persistent home.
 */
function closeFilesHelper(
  getState: () => AppState,
  applyState: (partial: Partial<AppState>) => void,
  ids: string[],
  stashUnsaved: boolean,
): void {
  if (ids.length === 0) return;
  const state = getState();
  const toClose = new Set(ids.filter((id) => state.workspace.files.some((f) => f.id === id)));
  if (toClose.size === 0) return;

  // Language → extension for the stash filename.
  const extForLang: Record<Language, string> = {
    markdown: 'md',
    html: 'html',
    json: 'json',
    xml: 'xml',
  };

  let archives = state.workspace.archives;

  if (stashUnsaved) {
    // Only stash orphans (no archiveId) that actually have content — a
    // brand-new blank tab is safe to drop.
    const orphans = state.workspace.files.filter(
      (f) => toClose.has(f.id) && !f.archiveId && (f.content?.length ?? 0) > 0,
    );
    if (orphans.length > 0) {
      // Materialise the Unsaved collection lazily — never create it
      // until we actually have something to put in it.
      let unsaved = archives.find((a) => a.id === UNSAVED_COLLECTION_ID);
      if (!unsaved) {
        unsaved = {
          id: UNSAVED_COLLECTION_ID,
          name: 'Unsaved',
          kind: 'zip',
          entries: [],
        };
        archives = [...archives, unsaved];
      }
      const claimed = new Set(unsaved.entries.map((e) => e.path));
      const newEntries: ArchiveEntry[] = [];
      for (const doc of orphans) {
        const lang = (doc.language ?? 'markdown') as Language;
        const ext = extForLang[lang] ?? 'txt';
        const safe = (doc.title || 'untitled').replace(/[\\/:*?"<>|]+/g, '_');
        let path = `${safe}.${ext}`;
        // Timestamp collisions to keep the sidebar chronological instead of overwriting.
        if (claimed.has(path)) {
          const base = path.replace(/\.[^.]+$/, '');
          path = `${base}.${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
        }
        claimed.add(path);
        newEntries.push({
          path,
          size: doc.content.length,
          language: lang,
          content: doc.content,
        });
      }
      archives = archives.map((a) =>
        a.id === UNSAVED_COLLECTION_ID
          ? { ...a, entries: [...a.entries, ...newEntries] }
          : a,
      );
    }
  }

  // Push each closing tab into recents so nothing is truly lost — the
  // Recents pane is our secondary safety net regardless of stash mode.
  for (const doc of state.workspace.files) {
    if (!toClose.has(doc.id)) continue;
    if (doc.content || doc.title !== 'Untitled document') {
      // Fire-and-forget; recents refresh happens once per batch below.
      void pushRecent(doc);
    }
  }
  // Kick a single recents refresh at the end of the batch instead of one per doc.
  void listRecents().then((r) => applyState({ recents: r }));

  const files = state.workspace.files.filter((f) => !toClose.has(f.id));
  if (files.length === 0) {
    const scratch = newDocument('', 'markdown');
    applyState({
      workspace: { files: [scratch], activeId: scratch.id, archives },
      document: scratch,
      past: [],
      future: [],
    });
  } else {
    // Pick the neighbour of the ORIGINAL active-tab position when it's
    // closing — feels right vs. always defaulting to the first tab.
    let nextActiveId = state.workspace.activeId;
    if (nextActiveId && toClose.has(nextActiveId)) {
      const origIdx = state.workspace.files.findIndex((f) => f.id === nextActiveId);
      // Walk right, then left, to find the first survivor.
      let picked: string | undefined;
      for (let k = origIdx + 1; k < state.workspace.files.length; k++) {
        if (!toClose.has(state.workspace.files[k].id)) {
          picked = state.workspace.files[k].id;
          break;
        }
      }
      if (!picked) {
        for (let k = origIdx - 1; k >= 0; k--) {
          if (!toClose.has(state.workspace.files[k].id)) {
            picked = state.workspace.files[k].id;
            break;
          }
        }
      }
      nextActiveId = picked ?? files[0].id;
    }
    const active = files.find((f) => f.id === nextActiveId) ?? files[0];
    applyState({
      workspace: { files, activeId: active.id, archives },
      document: active,
      past: [],
      future: [],
    });
  }
  scheduleWorkspaceSave(() => getState().workspace);
}

export const useAppStore = create<AppState>((set, get) => {
  const initialDoc = newDocument('');
  return {
    document: initialDoc,
    workspace: { files: [initialDoc], activeId: initialDoc.id, archives: [] },
    recents: [],
    theme: defaultSettings.theme,
    viewMode: defaultSettings.viewMode,
    previewMode: defaultSettings.previewMode,
    zenMode: defaultSettings.zenMode,
    showToc: true,
    past: [],
    future: [],
    isHydrated: false,

    async hydrate() {
      const [settings, workspace, recents] = await Promise.all([
        loadSettings(),
        loadWorkspace(),
        listRecents(),
      ]);

      let ws: Workspace;
      let doc: Document;
      let migrated = false;
      if (workspace && workspace.files.length > 0) {
        // Migrate older persisted workspaces that predate archive support.
        ws = { files: workspace.files, activeId: workspace.activeId, archives: workspace.archives ?? [] };
        doc = ws.files.find((f) => f.id === ws.activeId) ?? ws.files[0];
        if (!ws.files.some((f) => f.id === ws.activeId)) {
          ws = { ...ws, activeId: doc.id };
        }
        // One-shot migration: `.tex` archive entries used to be stored as
        // `language: 'xml'` (so CodeMirror had *some* highlighting), but
        // that routed the tab to `SourcePreview`, which choked on the
        // leading backslash with a DOMParser "Start tag expected" error.
        // Now `.tex`/`.latex` entries live under the markdown language so
        // `MarkdownPreview` can auto-detect the LaTeX and render it.
        const migratedWs = migrateTexLanguage(ws);
        if (migratedWs !== ws) {
          ws = migratedWs;
          migrated = true;
          // If the currently-active doc got migrated, refresh the local
          // reference so the store publishes the corrected language.
          doc = ws.files.find((f) => f.id === ws.activeId) ?? doc;
        }
      } else {
        doc = newDocument(SAMPLE_MARKDOWN);
        ws = { files: [doc], activeId: doc.id, archives: [] };
      }

      set({
        theme: settings.theme,
        viewMode: settings.viewMode,
        previewMode: settings.previewMode,
        zenMode: settings.zenMode,
        document: doc,
        workspace: ws,
        recents,
        isHydrated: true,
      });

      // Persist the migration so a subsequent reload doesn't have to
      // redo the same fix (and so the archive JSON on disk is correct
      // when other consumers — export dialog, unsaved-collection — read
      // it back later).
      if (migrated) scheduleWorkspaceSave(() => get().workspace);
    },

    setContent(content, opts) {
      const recordHistory = opts?.recordHistory ?? true;
      const state = get();
      const active = state.document;
      const now = Date.now();

      let past = state.past;
      if (recordHistory && now - lastHistoryPush > HISTORY_MIN_INTERVAL_MS) {
        past = [...past, { content: active.content }].slice(-HISTORY_LIMIT);
        lastHistoryPush = now;
      }

      // Auto-language detection for fresh scratch tabs. We only fire
      // this on documents that (a) still carry the default markdown
      // language, (b) have never been loaded from disk (no `original`
      // snapshot), and (c) are still untitled — pasting a JSON payload
      // into an untouched tab should switch the preview + syntax mode
      // without hijacking a document the user has already saved.
      let nextLanguage: Language | undefined;
      const isScratch =
        (active.language ?? 'markdown') === 'markdown' &&
        active.original === undefined &&
        active.title === 'Untitled document';
      if (isScratch) {
        const detected = detectLanguage(content);
        if (detected && detected !== active.language) nextLanguage = detected;
      }

      const patch: Partial<Document> = { content };
      if (nextLanguage) patch.language = nextLanguage;
      const result = withFile(state.workspace, active.id, patch);
      if (!result) return;
      set({
        workspace: result.workspace,
        document: result.document,
        past,
        future: recordHistory ? [] : state.future,
      });
      scheduleWorkspaceSave(() => get().workspace);
    },

    setTitle(title) {
      const state = get();
      const result = withFile(state.workspace, state.document.id, { title });
      if (!result) return;
      set({ workspace: result.workspace, document: result.document });
      scheduleWorkspaceSave(() => get().workspace);
    },

    setLanguage(language) {
      const state = get();
      if (state.document.language === language) return;
      const result = withFile(state.workspace, state.document.id, { language });
      if (!result) return;
      set({ workspace: result.workspace, document: result.document });
      scheduleWorkspaceSave(() => get().workspace);
    },

    newFile() {
      const doc = newDocument('', 'markdown');
      const state = get();
      const files = [...state.workspace.files, doc];
      set({
        workspace: { files, activeId: doc.id, archives: state.workspace.archives },
        document: doc,
        past: [],
        future: [],
      });
      scheduleWorkspaceSave(() => get().workspace);
    },

    openFile(content, language, title) {
      const doc = newDocument(content, language, title ?? 'Untitled document');
      const state = get();
      const files = [...state.workspace.files, doc];
      set({
        workspace: { files, activeId: doc.id, archives: state.workspace.archives },
        document: doc,
        past: [],
        future: [],
      });
      scheduleWorkspaceSave(() => get().workspace);
    },

    openDoc(doc) {
      // Opening a recent doc — if it's already open, just switch to it.
      const state = get();
      const existing = state.workspace.files.find((f) => f.id === doc.id);
      if (existing) {
        set({ workspace: { ...state.workspace, activeId: existing.id }, document: existing });
        return;
      }
      // Otherwise clone into workspace with original snapshot.
      const opened: Document = { ...doc, original: doc.content };
      const files = [...state.workspace.files, opened];
      set({
        workspace: { files, activeId: opened.id, archives: state.workspace.archives },
        document: opened,
        past: [],
        future: [],
      });
      scheduleWorkspaceSave(() => get().workspace);
    },

    switchFile(id) {
      const state = get();
      const target = state.workspace.files.find((f) => f.id === id);
      if (!target || id === state.workspace.activeId) return;
      set({
        workspace: { ...state.workspace, activeId: id },
        document: target,
        past: [],
        future: [],
      });
      scheduleWorkspaceSave(() => get().workspace);
    },

    closeFile(id, opts) {
      closeFilesHelper(get, set, [id], !!opts?.stashUnsaved);
    },

    closeOthers(keepId, opts) {
      const ids = get()
        .workspace.files.filter((f) => f.id !== keepId)
        .map((f) => f.id);
      closeFilesHelper(get, set, ids, !!opts?.stashUnsaved);
    },

    closeToRight(pivotId, opts) {
      const files = get().workspace.files;
      const idx = files.findIndex((f) => f.id === pivotId);
      if (idx < 0) return;
      const ids = files.slice(idx + 1).map((f) => f.id);
      closeFilesHelper(get, set, ids, !!opts?.stashUnsaved);
    },

    closeToLeft(pivotId, opts) {
      const files = get().workspace.files;
      const idx = files.findIndex((f) => f.id === pivotId);
      if (idx < 0) return;
      const ids = files.slice(0, idx).map((f) => f.id);
      closeFilesHelper(get, set, ids, !!opts?.stashUnsaved);
    },

    closeAll(opts) {
      const ids = get().workspace.files.map((f) => f.id);
      closeFilesHelper(get, set, ids, !!opts?.stashUnsaved);
    },

    ensureUnsavedCollection() {
      const state = get();
      const existing = state.workspace.archives.find((a) => a.id === UNSAVED_COLLECTION_ID);
      if (existing) return existing.id;
      const collection: Archive = {
        id: UNSAVED_COLLECTION_ID,
        name: 'Unsaved',
        kind: 'zip',
        entries: [],
      };
      set({
        workspace: {
          ...state.workspace,
          archives: [...state.workspace.archives, collection],
        },
      });
      scheduleWorkspaceSave(() => get().workspace);
      return collection.id;
    },

    newDoc(content = '', language: Language = 'markdown') {
      // Legacy shim → opens as a new tab, keeps old callers working.
      get().openFile(content, language);
    },

    // --- archives ----------------------------------------------------------

    openArchive(archive) {
      const state = get();
      // Register the archive, then open its primary entry (if any) as a tab.
      const archives = [...state.workspace.archives, archive];
      set({
        workspace: { ...state.workspace, archives },
      });
      if (archive.primaryPath) {
        get().openArchiveEntry(archive.id, archive.primaryPath);
      } else {
        scheduleWorkspaceSave(() => get().workspace);
      }
    },

    openArchiveEntry(archiveId, entryPath) {
      const state = get();
      const archive = state.workspace.archives.find((a) => a.id === archiveId);
      if (!archive) return;
      const entry = archive.entries.find((e) => e.path === entryPath);
      if (!entry || entry.isBinary || entry.content == null) return;

      // Already opened? Just switch to the existing tab.
      if (entry.docId) {
        const existing = state.workspace.files.find((f) => f.id === entry.docId);
        if (existing) {
          // Correct the language for `.tex`/`.latex` tabs that were
          // opened before the language-migration landed. Otherwise
          // switching to the tab would land the user right back in the
          // broken XML preview.
          const isTexEntry = /\.(tex|latex)$/i.test(entryPath);
          if (isTexEntry && existing.language !== 'markdown') {
            const patched = withFile(state.workspace, existing.id, { language: 'markdown' });
            if (patched) {
              set({
                workspace: { ...patched.workspace, activeId: existing.id },
                document: patched.document,
              });
              scheduleWorkspaceSave(() => get().workspace);
              return;
            }
          }
          set({
            workspace: { ...state.workspace, activeId: existing.id },
            document: existing,
          });
          scheduleWorkspaceSave(() => get().workspace);
          return;
        }
      }

      // Create a new tab for the entry. The title uses just the basename so
      // the tab strip stays readable; the sidebar tree shows the full path.
      // Synthetic rendered previews get a friendlier "<archive> · preview" title.
      const basename = entryPath.split('/').pop() || entryPath;
      const archiveBaseName = archive.name.replace(/\.[^.]+$/, '');
      const title = entry.isRendered
        ? `${archiveBaseName} · preview`
        : basename;
      // Defensive override: `.tex`/`.latex` entries always open as
      // markdown so `MarkdownPreview` can auto-detect the LaTeX. Older
      // archives on disk still carry `language: 'xml'` from before the
      // fix landed; migrating on hydrate covers the persisted case, but
      // this line handles any freshly-unpacked archive that a future
      // caller might tag differently by mistake.
      const isTexEntry = /\.(tex|latex)$/i.test(entryPath);
      const entryLanguage: Language = isTexEntry
        ? 'markdown'
        : entry.language ?? 'markdown';
      const doc = newDocument(entry.content, entryLanguage, title);
      doc.archiveId = archive.id;
      doc.archivePath = entryPath;

      // Splice `docId` back into the archive so re-opens are O(1) switches.
      const archives = state.workspace.archives.map((a) => {
        if (a.id !== archiveId) return a;
        return {
          ...a,
          entries: a.entries.map((e) =>
            e.path === entryPath ? { ...e, docId: doc.id } : e,
          ),
        };
      });
      const files = [...state.workspace.files, doc];
      set({
        workspace: { files, activeId: doc.id, archives },
        document: doc,
        past: [],
        future: [],
      });
      scheduleWorkspaceSave(() => get().workspace);
    },

    closeArchive(archiveId) {
      const state = get();
      const archive = state.workspace.archives.find((a) => a.id === archiveId);
      if (!archive) return;
      // Remove the archive AND every tab that originated from it.
      const orphanIds = new Set(
        archive.entries.map((e) => e.docId).filter((id): id is string => !!id),
      );
      const files = state.workspace.files.filter(
        (f) => !(f.archiveId === archiveId || orphanIds.has(f.id)),
      );
      const archives = state.workspace.archives.filter((a) => a.id !== archiveId);

      if (files.length === 0) {
        const scratch = newDocument('', 'markdown');
        set({
          workspace: { files: [scratch], activeId: scratch.id, archives },
          document: scratch,
          past: [],
          future: [],
        });
      } else {
        let activeId = state.workspace.activeId;
        if (!files.some((f) => f.id === activeId)) {
          activeId = files[files.length - 1].id;
        }
        const active = files.find((f) => f.id === activeId) ?? files[0];
        set({
          workspace: { files, activeId: active.id, archives },
          document: active,
          past: [],
          future: [],
        });
      }
      scheduleWorkspaceSave(() => get().workspace);
    },

    // --- collections (user-created archives) ------------------------------

    createCollection(name) {
      const trimmed = name.trim() || 'Untitled collection';
      const id = `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const collection: Archive = {
        id,
        name: trimmed,
        kind: 'zip',
        entries: [],
      };
      const state = get();
      set({
        workspace: {
          ...state.workspace,
          archives: [...state.workspace.archives, collection],
        },
      });
      scheduleWorkspaceSave(() => get().workspace);
      return id;
    },

    addToCollection(archiveId, doc, path) {
      // Map editor languages back to sensible file extensions so archive
      // entries look natural on disk (Zip export uses these as filenames).
      const extForLang: Record<Language, string> = {
        markdown: 'md',
        html: 'html',
        json: 'json',
        xml: 'xml',
      };
      const lang: Language = doc.language ?? 'markdown';
      const ext = extForLang[lang] ?? 'txt';
      const safeTitle = (doc.title || 'document').replace(/[\\/:*?"<>|]+/g, '_');
      const finalPath = (path || `${safeTitle}.${ext}`).replace(/^\/+/, '');

      const state = get();
      const archive = state.workspace.archives.find(
        (a) => a.id === archiveId && a.kind === 'zip',
      );
      if (!archive) return;

      // Update-or-insert: rewriting the same path just refreshes the content.
      const existingIdx = archive.entries.findIndex((e) => e.path === finalPath);
      // Preserve the entry's `docId` back-pointer when overwriting so the
      // archive tree can still highlight "this entry is currently open".
      // Also link it to the source doc when we know it's a workspace file,
      // so subsequent renders in ActiveFiles group it under the collection.
      const existingDocId = existingIdx >= 0 ? archive.entries[existingIdx].docId : undefined;
      const isWorkspaceDoc = state.workspace.files.some((f) => f.id === doc.id);
      const entry: ArchiveEntry = {
        path: finalPath,
        size: doc.content.length,
        language: lang,
        content: doc.content,
        docId: existingDocId ?? (isWorkspaceDoc ? doc.id : undefined),
      };
      const entries = existingIdx >= 0
        ? archive.entries.map((e, i) => (i === existingIdx ? entry : e))
        : [...archive.entries, entry];
      const archives = state.workspace.archives.map((a) =>
        a.id === archiveId ? { ...a, entries } : a,
      );
      // When the source is an open workspace file, patch it so the tab
      // immediately reflows into the collection group. Without this the
      // entry lives in the archive but ActiveFiles still shows the doc as
      // "loose" until the user clicks the collection entry (which lazily
      // wires archiveId via openArchiveEntry).
      const files = isWorkspaceDoc
        ? state.workspace.files.map((f) =>
            f.id === doc.id ? { ...f, archiveId, archivePath: finalPath } : f,
          )
        : state.workspace.files;
      set({ workspace: { ...state.workspace, archives, files } });
      scheduleWorkspaceSave(() => get().workspace);
    },

    async importFilesIntoCollection(archiveId, files) {
      if (files.length === 0) return null;
      const state = get();
      const archive = state.workspace.archives.find(
        (a) => a.id === archiveId && a.kind === 'zip',
      );
      if (!archive) return null;

      // Detect language from the extension. Anything not text-like is
      // skipped with a note — nesting a full .docx inside a collection
      // would defeat the whole "one clean tree" story.
      const extToLang: Record<string, Language> = {
        md: 'markdown',
        markdown: 'markdown',
        txt: 'markdown',
        tex: 'markdown',
        latex: 'markdown',
        html: 'html',
        htm: 'html',
        json: 'json',
        xml: 'xml',
      };

      const existing = new Map(archive.entries.map((e) => [e.path, e] as const));
      let firstAdded: string | null = null;

      for (const file of files) {
        const ext = (file.name.split('.').pop() ?? '').toLowerCase();
        const lang = extToLang[ext];
        if (!lang) {
          // Container / binary — surface a hint but keep the loop moving so
          // a mixed selection still imports the text files.
          console.warn(`[collection] skipping ${file.name} — unsupported type`);
          continue;
        }
        const content = await file.text();
        // De-dupe by suffixing (N). Collections are user-curated so we don't
        // want a fresh drag to silently clobber earlier imports.
        let path = file.name.replace(/^\/+/, '');
        if (existing.has(path)) {
          const base = path.replace(/\.[^.]+$/, '');
          const dotExt = path.slice(base.length);
          let n = 2;
          while (existing.has(`${base} (${n})${dotExt}`)) n++;
          path = `${base} (${n})${dotExt}`;
        }
        const entry: ArchiveEntry = {
          path,
          size: content.length,
          language: lang,
          content,
        };
        existing.set(path, entry);
        firstAdded ??= path;
      }

      if (firstAdded === null) return null;

      const nextEntries = Array.from(existing.values());
      const archives = get().workspace.archives.map((a) =>
        a.id === archiveId ? { ...a, entries: nextEntries } : a,
      );
      set({ workspace: { ...get().workspace, archives } });
      scheduleWorkspaceSave(() => get().workspace);
      return firstAdded;
    },

    renameCollectionEntry(archiveId, oldPath, newPath) {
      const clean = newPath.replace(/^\/+/, '').trim();
      if (!clean || clean === oldPath) return;
      const state = get();
      const archive = state.workspace.archives.find((a) => a.id === archiveId);
      if (!archive) return;
      const archives = state.workspace.archives.map((a) => {
        if (a.id !== archiveId) return a;
        return {
          ...a,
          entries: a.entries.map((e) =>
            e.path === oldPath ? { ...e, path: clean } : e,
          ),
        };
      });
      // Also update any open tab that mirrors this entry so navigation stays in sync.
      const files = state.workspace.files.map((f) =>
        f.archiveId === archiveId && f.archivePath === oldPath
          ? { ...f, archivePath: clean }
          : f,
      );
      set({ workspace: { ...state.workspace, archives, files } });
      scheduleWorkspaceSave(() => get().workspace);
    },

    removeFromCollection(archiveId, entryPath) {
      const state = get();
      const archives = state.workspace.archives.map((a) => {
        if (a.id !== archiveId) return a;
        return { ...a, entries: a.entries.filter((e) => e.path !== entryPath) };
      });
      // Detach any open tab so it becomes a standalone doc (don't close — the
      // user may have unsaved work). Just clear the archive linkage.
      const files = state.workspace.files.map((f) =>
        f.archiveId === archiveId && f.archivePath === entryPath
          ? { ...f, archiveId: undefined, archivePath: undefined }
          : f,
      );
      set({ workspace: { ...state.workspace, archives, files } });
      scheduleWorkspaceSave(() => get().workspace);
    },

    moveEntryToCollection(fromArchiveId, fromPath, toArchiveId, toFolder) {
      // Guard: destination must be a user collection. Real container
      // archives (docx, xlsx, …) have strict structural expectations —
      // sneaking a random file into them would corrupt the export.
      const state = get();
      const dest = state.workspace.archives.find(
        (a) => a.id === toArchiveId && a.kind === 'zip',
      );
      const source = state.workspace.archives.find((a) => a.id === fromArchiveId);
      if (!dest || !source) return;

      // Normalize the destination folder — always forward-slashed, no
      // leading slash, always trailing slash when non-empty. Simplifies
      // path arithmetic below.
      let folder = (toFolder ?? '').replace(/^\/+|\/+$/g, '').trim();
      if (folder) folder = `${folder}/`;

      // "Directory move" support: if `fromPath` ends with `/`, treat it
      // as a folder prefix and move every entry underneath it. Otherwise
      // it's a single-entry move.
      const isDirMove = fromPath.endsWith('/');
      const prefix = fromPath.replace(/^\/+/, '');
      const matching = isDirMove
        ? source.entries.filter((e) => e.path.startsWith(prefix))
        : source.entries.filter((e) => e.path === prefix);
      if (matching.length === 0) return;

      // Build a dedupe set from the destination so we can rename on
      // collision instead of clobbering. Include both existing entries
      // AND any names we've already claimed in this batch.
      const claimed = new Set(dest.entries.map((e) => e.path));

      /** Given a proposed leaf filename, append " (2)" / " (3)" etc.
       *  until it's unique in `claimed`. */
      const uniquify = (path: string): string => {
        if (!claimed.has(path)) return path;
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
        const leaf = path.slice(dir.length);
        const base = leaf.replace(/\.[^.]+$/, '');
        const dotExt = leaf.slice(base.length);
        let n = 2;
        while (claimed.has(`${dir}${base} (${n})${dotExt}`)) n++;
        return `${dir}${base} (${n})${dotExt}`;
      };

      // Compute the (oldPath → newPath) mapping. For directory moves,
      // preserve the sub-structure below the moved folder.
      const rename = new Map<string, string>();
      for (const entry of matching) {
        const suffix = isDirMove ? entry.path.slice(prefix.length) : entry.path.split('/').pop()!;
        const proposed = `${folder}${suffix}`.replace(/^\/+/, '');
        const finalPath = uniquify(proposed);
        rename.set(entry.path, finalPath);
        claimed.add(finalPath);
      }

      // Special-case: same-archive move is just an entry mutation.
      const archives = state.workspace.archives.map((a) => {
        if (fromArchiveId === toArchiveId && a.id === fromArchiveId) {
          return {
            ...a,
            entries: a.entries.map((e) =>
              rename.has(e.path) ? { ...e, path: rename.get(e.path)! } : e,
            ),
          };
        }
        if (a.id === fromArchiveId) {
          return { ...a, entries: a.entries.filter((e) => !rename.has(e.path)) };
        }
        if (a.id === toArchiveId) {
          const moved = matching.map((e) => ({ ...e, path: rename.get(e.path)! }));
          return { ...a, entries: [...a.entries, ...moved] };
        }
        return a;
      });

      // Patch open tabs so nothing closes. Preserves scroll position,
      // undo history, edited state — the user just sees the item in a
      // new place.
      const files = state.workspace.files.map((f) => {
        if (f.archiveId !== fromArchiveId) return f;
        const newPath = f.archivePath ? rename.get(f.archivePath) : undefined;
        if (!newPath) return f;
        return { ...f, archiveId: toArchiveId, archivePath: newPath };
      });

      set({ workspace: { ...state.workspace, archives, files } });
      scheduleWorkspaceSave(() => get().workspace);
    },

    createCollectionFolder(archiveId, folderPath) {
      // Normalize: no leading slash, exactly one trailing slash. Empty /
      // whitespace-only names are ignored — the caller almost certainly
      // dismissed a prompt.
      const cleaned = folderPath.replace(/^\/+|\/+$/g, '').trim();
      if (!cleaned) return;
      const state = get();
      const archive = state.workspace.archives.find(
        (a) => a.id === archiveId && a.kind === 'zip',
      );
      if (!archive) return;

      // Sentinel-based folders — the archive tree just walks entry paths,
      // so an empty folder needs a placeholder entry. `.folder-keep` is
      // filtered out of most UI (rendered as an empty folder), stripped
      // on export, and skipped by "open entry" flows.
      const sentinelPath = `${cleaned}/.folder-keep`;
      if (archive.entries.some((e) => e.path === sentinelPath)) return;
      const entry: ArchiveEntry = {
        path: sentinelPath,
        size: 0,
        language: 'markdown',
        content: '',
      };
      const archives = state.workspace.archives.map((a) =>
        a.id === archiveId ? { ...a, entries: [...a.entries, entry] } : a,
      );
      set({ workspace: { ...state.workspace, archives } });
      scheduleWorkspaceSave(() => get().workspace);
    },

    addRawToCollection(archiveId, path, content, language, opts) {
      const state = get();
      const archive = state.workspace.archives.find(
        (a) => a.id === archiveId && a.kind === 'zip',
      );
      if (!archive) return null;
      const clean = path.replace(/^\/+/, '');
      if (!clean) return null;

      const existingIdx = archive.entries.findIndex((e) => e.path === clean);
      const claimed = new Set(archive.entries.map((e) => e.path));
      let finalPath = clean;
      // Suffix-dedup by default so accidental double-adds don't clobber
      // real data. Callers that intend to overwrite (e.g. saving edits
      // back into the same request.curl.json entry) opt in explicitly.
      if (claimed.has(finalPath) && !opts?.overwrite) {
        const base = finalPath.replace(/\.[^.]+$/, '');
        const dotExt = finalPath.slice(base.length);
        let n = 2;
        while (claimed.has(`${base} (${n})${dotExt}`)) n++;
        finalPath = `${base} (${n})${dotExt}`;
      }
      // Preserve `docId` linkage when overwriting so any open tab keeps
      // its "this entry is open" highlight without a re-open dance.
      const existingDocId =
        opts?.overwrite && existingIdx >= 0
          ? archive.entries[existingIdx].docId
          : undefined;
      const entry: ArchiveEntry = {
        path: finalPath,
        size: content.length,
        language: language ?? 'markdown',
        content,
        docId: existingDocId,
      };
      const entries =
        opts?.overwrite && existingIdx >= 0
          ? archive.entries.map((e, i) => (i === existingIdx ? entry : e))
          : [...archive.entries, entry];
      const archives = state.workspace.archives.map((a) =>
        a.id === archiveId ? { ...a, entries } : a,
      );
      set({ workspace: { ...state.workspace, archives } });
      scheduleWorkspaceSave(() => get().workspace);
      return finalPath;
    },

    addBinaryToCollection(archiveId, path, base64, mimeType, byteSize, opts) {
      const state = get();
      const archive = state.workspace.archives.find(
        (a) => a.id === archiveId && a.kind === 'zip',
      );
      if (!archive) return null;
      const clean = path.replace(/^\/+/, '');
      if (!clean) return null;

      // Same suffix-dedup as `addRawToCollection` — kept in-lined rather
      // than factored so each variant reads top-to-bottom without any
      // "wait, which helper does what" indirection.
      const existingIdx = archive.entries.findIndex((e) => e.path === clean);
      const claimed = new Set(archive.entries.map((e) => e.path));
      let finalPath = clean;
      if (claimed.has(finalPath) && !opts?.overwrite) {
        const base = finalPath.replace(/\.[^.]+$/, '');
        const dotExt = finalPath.slice(base.length);
        let n = 2;
        while (claimed.has(`${base} (${n})${dotExt}`)) n++;
        finalPath = `${base} (${n})${dotExt}`;
      }
      const existingDocId =
        opts?.overwrite && existingIdx >= 0
          ? archive.entries[existingIdx].docId
          : undefined;
      const entry: ArchiveEntry = {
        path: finalPath,
        size: byteSize,
        isBinary: true,
        binaryBase64: base64,
        mimeType,
        docId: existingDocId,
      };
      const entries =
        opts?.overwrite && existingIdx >= 0
          ? archive.entries.map((e, i) => (i === existingIdx ? entry : e))
          : [...archive.entries, entry];
      const archives = state.workspace.archives.map((a) =>
        a.id === archiveId ? { ...a, entries } : a,
      );
      set({ workspace: { ...state.workspace, archives } });
      scheduleWorkspaceSave(() => get().workspace);
      return finalPath;
    },

    async removeRecentDoc(id) {
      await removeRecent(id);
      set({ recents: await listRecents() });
    },

    setTheme(theme) {
      set({ theme });
      void saveSettings({ theme });
    },
    setViewMode(mode) {
      set({ viewMode: mode });
      void saveSettings({ viewMode: mode });
    },
    setPreviewMode(mode) {
      set({ previewMode: mode });
      void saveSettings({ previewMode: mode });
    },
    toggleZen() {
      const next = !get().zenMode;
      set({ zenMode: next });
      void saveSettings({ zenMode: next });
    },
    toggleToc() {
      set({ showToc: !get().showToc });
    },

    undo() {
      const state = get();
      if (state.past.length === 0) return;
      const previous = state.past[state.past.length - 1];
      const result = withFile(state.workspace, state.document.id, { content: previous.content });
      if (!result) return;
      set({
        past: state.past.slice(0, -1),
        future: [{ content: state.document.content }, ...state.future].slice(0, HISTORY_LIMIT),
        workspace: result.workspace,
        document: result.document,
      });
      scheduleWorkspaceSave(() => get().workspace);
    },
    redo() {
      const state = get();
      if (state.future.length === 0) return;
      const next = state.future[0];
      const result = withFile(state.workspace, state.document.id, { content: next.content });
      if (!result) return;
      set({
        past: [...state.past, { content: state.document.content }].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        workspace: result.workspace,
        document: result.document,
      });
      scheduleWorkspaceSave(() => get().workspace);
    },
    canUndo() {
      return get().past.length > 0;
    },
    canRedo() {
      return get().future.length > 0;
    },
  };
});

const SAMPLE_MARKDOWN = `# Welcome to **Doc Studio** ✨

A modern, mobile-first editor for **Markdown**, **HTML**, **JSON** and **XML** — all in your browser.

## What you can do

- ✍️ Write in a real editor with syntax highlighting per language
- 🗂️ Multiple files open at once — tabs above the editor
- 🔍 Search with inline highlight in both the editor **and** the preview
- 📥 Import from **Markdown**, **HTML**, **DOCX**, **JSON** or **XML**
- 📤 Export as **Markdown**, **HTML** or **PDF** (vector text — crisp at any zoom)
- 🌗 Switch between light, dark, or system theme
- 💾 Autosaves everything locally — works offline as a PWA

## Try it out

1. Type or paste some Markdown
2. Drag & drop a \`.md\`, \`.markdown\`, \`.txt\`, \`.docx\`, \`.json\` or \`.xml\` file
3. Hit **Export → PDF** when you're ready

### A little sample

> "Simplicity is the ultimate sophistication."
> — Leonardo da Vinci

\`\`\`ts
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

| Feature | Status |
| ------- | :----: |
| Live preview | ✅ |
| PDF export | ✅ |
| DOCX import | ✅ |
| JSON / XML editing | ✅ |
| Offline mode | ✅ |

- [x] Set up the project
- [x] Write some Markdown
- [ ] Publish the document

---

Happy writing! 🚀
`;
