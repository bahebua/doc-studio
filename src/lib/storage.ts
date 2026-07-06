import localforage from 'localforage';
import type { Archive, Document, Language } from '@/types';

localforage.config({
  name: 'doc-studio',
  storeName: 'documents',
  description: 'Local documents for Doc Studio',
});

/**
 * Workspace instance id — namespaces storage so different windows /
 * shared URLs stay isolated. Resolution order:
 *
 *   1. `?ws=<id>` in the URL — wins. Bookmark / share-friendly.
 *   2. `sessionStorage` — persists across reloads of the SAME tab but
 *      NOT across new windows, giving "duplicate → same, new window →
 *      fresh" out of the box.
 *   3. Fresh random id — generated once per new session.
 *
 * The id is also written back to the URL (without reloading) so users
 * can copy the current URL to re-open the exact workspace elsewhere.
 * Settings (theme / view mode) stay global — they aren't namespaced.
 */
const DEFAULT_WORKSPACE_ID = 'main';
const WS_SESSION_KEY = '__ds_workspace_id__';

function readWorkspaceIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const ws = url.searchParams.get('ws');
    return ws && /^[a-zA-Z0-9_.-]{1,64}$/.test(ws) ? ws : null;
  } catch {
    return null;
  }
}

function generateWorkspaceId(): string {
  // Short, URL-safe, human-typeable when needed.
  const rand = Math.random().toString(36).slice(2, 8);
  return `ws-${Date.now().toString(36).slice(-4)}-${rand}`;
}

/** The active workspace id for this window/tab. Immutable after first
 *  resolution — a fresh id requires a new window or explicit URL change. */
export const WORKSPACE_ID: string = (() => {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE_ID;
  const fromUrl = readWorkspaceIdFromUrl();
  if (fromUrl) {
    try {
      window.sessionStorage.setItem(WS_SESSION_KEY, fromUrl);
    } catch {
      /* private mode / storage disabled — non-fatal */
    }
    return fromUrl;
  }
  try {
    const fromSession = window.sessionStorage.getItem(WS_SESSION_KEY);
    if (fromSession) return fromSession;
  } catch {
    /* ignore */
  }
  const fresh = generateWorkspaceId();
  try {
    window.sessionStorage.setItem(WS_SESSION_KEY, fresh);
  } catch {
    /* ignore */
  }
  // Best-effort URL sync so the tab is shareable. `replaceState` doesn't
  // trigger a navigation and keeps the browser back-stack clean.
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('ws', fresh);
    window.history.replaceState(null, '', url.toString());
  } catch {
    /* non-browser env; ignore */
  }
  return fresh;
})();

/** Prefix a key with the active workspace id so different instances
 *  don't collide in IndexedDB. Settings stay unprefixed (global). */
const nsKey = (base: string): string => `${WORKSPACE_ID}:${base}`;

const WORKSPACE_KEY = nsKey('__workspace__');
const RECENT_KEY = nsKey('__recent_documents__');
const SETTINGS_KEY = '__settings__'; // global — not per-instance
const MAX_RECENTS = 12;

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  viewMode: 'split' | 'editor' | 'preview';
  previewMode: 'html' | 'pdf';
  zenMode: boolean;
}

export const defaultSettings: AppSettings = {
  theme: 'system',
  viewMode: 'split',
  previewMode: 'html',
  zenMode: false,
};

export interface StoredWorkspace {
  files: Document[];
  activeId: string | null;
  /** Registered archives (docx / xlsx / zip / …). Optional for back-compat
   *  with workspaces saved before archive support landed. */
  archives?: Archive[];
}

export async function loadSettings(): Promise<AppSettings> {
  const s = await localforage.getItem<AppSettings>(SETTINGS_KEY);
  return { ...defaultSettings, ...(s ?? {}) };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const existing = await loadSettings();
  await localforage.setItem(SETTINGS_KEY, { ...existing, ...patch });
}

export async function saveWorkspace(ws: StoredWorkspace): Promise<void> {
  await localforage.setItem(WORKSPACE_KEY, ws);
}

export async function loadWorkspace(): Promise<StoredWorkspace | null> {
  return (await localforage.getItem<StoredWorkspace>(WORKSPACE_KEY)) ?? null;
}

export async function listRecents(): Promise<Document[]> {
  return (await localforage.getItem<Document[]>(RECENT_KEY)) ?? [];
}

export async function pushRecent(doc: Document): Promise<void> {
  const recents = await listRecents();
  const filtered = recents.filter((r) => r.id !== doc.id);
  filtered.unshift(doc);
  await localforage.setItem(RECENT_KEY, filtered.slice(0, MAX_RECENTS));
}

export async function removeRecent(id: string): Promise<void> {
  const recents = await listRecents();
  await localforage.setItem(
    RECENT_KEY,
    recents.filter((r) => r.id !== id),
  );
}

/** Discover every workspace instance ever created in this browser.
 *  Scans all localForage keys for the `${id}:__workspace__` pattern. */
export async function listWorkspaces(): Promise<string[]> {
  const keys = await localforage.keys();
  const ids = new Set<string>();
  for (const k of keys) {
    const m = /^([a-zA-Z0-9_.-]+):__workspace__$/.exec(k);
    if (m) ids.add(m[1]);
  }
  ids.add(WORKSPACE_ID); // always include the current one, even if empty
  return Array.from(ids).sort();
}

/** Open a specific workspace instance in a new browser window / native
 *  window. Passes `?ws=<id>` so the target boots into that namespace. */
export function openWorkspaceInNewWindow(id: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('ws', id);
  window.open(url.toString(), '_blank', 'noopener');
}

/** Wipe a workspace instance completely (files, archives, recents).
 *  Used by the "delete instance" action in the workspace switcher. */
export async function deleteWorkspace(id: string): Promise<void> {
  await localforage.removeItem(`${id}:__workspace__`);
  await localforage.removeItem(`${id}:__recent_documents__`);
}

export function newDocument(
  content = '',
  language: Language = 'markdown',
  title = 'Untitled document',
): Document {
  const now = Date.now();
  return {
    id: (crypto as unknown as { randomUUID?: () => string }).randomUUID?.() ??
      `doc-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    content,
    createdAt: now,
    updatedAt: now,
    language,
    original: content,
  };
}
