import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Loader2, ShieldAlert, Info, Copy, Save } from 'lucide-react';
import clsx from 'clsx';
import type { ParsedCurl } from '@/lib/curlParser';
import {
  fetchViaProxyOrDirect,
  isPrivateHost,
  type ProxyResult,
} from '@/lib/proxyClient';
import { resolveResponseFormat } from '@/lib/mimeExt';
import { toast } from '@/components/ui/Toast';
import {
  RequestEditor,
  toEditable,
  toParsedCurl,
  blobToBase64,
  type EditableRequest,
} from '@/components/request/RequestEditor';
import { useAppStore } from '@/store/useAppStore';
import type { Language } from '@/types';

interface Props {
  /** Raw JSON text of the current document — expected to be a
   *  `doc-studio/curl-request` envelope. If parse fails the caller
   *  should render the plain JSON preview instead. */
  json: string;
}

/** Envelope shape written by CurlImportDialog when the user saves a
 *  parsed cURL into a collection. Kept loose (`unknown` for `request`
 *  fields) — we do a runtime shape check before trusting it. */
interface CurlEnvelope {
  kind: string;
  version?: number;
  savedAt?: string;
  request: ParsedCurl;
}

function tryParseEnvelope(text: string): CurlEnvelope | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { kind?: unknown }).kind === 'doc-studio/curl-request' &&
      typeof (parsed as { request?: unknown }).request === 'object' &&
      (parsed as { request?: { url?: unknown } }).request?.url !== undefined
    ) {
      return parsed as CurlEnvelope;
    }
  } catch {
    /* fall through — not JSON, or malformed */
  }
  return null;
}

/** Fast detector for the calling preview switch — cheap enough to run
 *  on every keystroke because it only does a substring probe before
 *  bothering with `JSON.parse`. */
export function looksLikeCurlEnvelope(text: string): boolean {
  return text.includes('"doc-studio/curl-request"');
}

/** Language guess for the response tab — mirrors the same heuristic
 *  used in CurlImportDialog. */
function classifyResponse(url: string, contentType: string): {
  kind: 'html' | 'json' | 'xml' | 'markdown';
  language: Language;
} {
  const ct = contentType.toLowerCase();
  const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() ?? '';
  if (ct.includes('json') || ext === 'json') return { kind: 'json', language: 'json' };
  if (ct.includes('xml') || ext === 'xml') return { kind: 'xml', language: 'xml' };
  if (ct.includes('html') || ext === 'html' || ext === 'htm')
    return { kind: 'html', language: 'markdown' };
  if (ext === 'md' || ext === 'markdown' || ext === 'txt')
    return { kind: 'markdown', language: 'markdown' };
  return ct.startsWith('text/')
    ? { kind: 'markdown', language: 'markdown' }
    : { kind: 'json', language: 'json' };
}

function shortHost(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return 'request';
  }
}

/** Choose the extension for a TEXT response body when the header/URL
 *  didn't already give us a nice one. `resolveResponseFormat` returns
 *  `bin` on nothing-matched, which is fine for binary but wrong for
 *  text — collapse it to `txt` here. */
function textExtFor(ext: string, contentType: string): string {
  if (ext && ext !== 'bin') return ext;
  const t = contentType.toLowerCase();
  if (t.includes('json')) return 'json';
  if (t.includes('xml')) return 'xml';
  if (t.includes('html')) return 'html';
  return 'txt';
}

/**
 * Rendered preview for a saved cURL request. Shows the parsed request in
 * a Postman-ish card and offers a **Run** button — hitting the endpoint
 * via the dev proxy (with all the same TLS / private-host / header
 * plumbing as the import dialog).
 *
 * The document itself stays as raw JSON on disk (round-trippable, safe
 * to version-control); this is purely a nicer view of it.
 */
export function CurlRequestPreview({ json }: Props) {
  const envelope = useMemo(() => tryParseEnvelope(json), [json]);
  const openFile = useAppStore((s) => s.openFile);
  const setTitle = useAppStore((s) => s.setTitle);
  const setContent = useAppStore((s) => s.setContent);
  const document_ = useAppStore((s) => s.document);
  const addRawToCollection = useAppStore((s) => s.addRawToCollection);
  const addBinaryToCollection = useAppStore((s) => s.addBinaryToCollection);
  // Archives feed the attachment auto-resolver: when the saved request
  // has `formParts` with file references, we look up matching binary
  // entries in `<apiName>/input/` and wire them into the run.
  const archives = useAppStore((s) => s.workspace.archives);

  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [response, setResponse] = useState<ProxyResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Local editable working copy. Seeded from the parsed envelope; any
  // edits are held here until the user clicks Save. Re-seeded whenever
  // the underlying document JSON changes (e.g. undo/redo, or the tab is
  // pointed at a different envelope). Attachments picked in this session
  // live under `editable.attachments` — persisted separately as binary
  // entries when the user saves.
  const [editable, setEditable] = useState<EditableRequest | null>(() =>
    envelope ? toEditable(envelope.request) : null,
  );
  // Signature of the persisted envelope, so we can flag "dirty" and skip
  // reseeding when only irrelevant fields change. `attachments` are
  // intentionally excluded — they're session-only until Save.
  const envelopeSignature = useMemo(
    () => (envelope ? JSON.stringify(envelope.request) : ''),
    [envelope],
  );
  useEffect(() => {
    if (!envelope) return;
    setEditable((prev) => {
      const nextSeed = toEditable(envelope.request);
      // Preserve any in-flight attachments across reseeds so a background
      // save doesn't wipe the user's file-picker choices.
      return prev ? { ...nextSeed, attachments: prev.attachments } : nextSeed;
    });
    // Reset local response/error whenever the source doc changes.
  }, [envelopeSignature, envelope]);

  const isDirty = useMemo(() => {
    if (!editable || !envelope) return false;
    // Compare the projected ParsedCurl, not raw EditableRequest — that
    // way trailing-whitespace and header-order changes that round-trip
    // to the same on-disk shape don't spuriously flag as dirty.
    const projected = JSON.stringify(toParsedCurl(editable));
    const original = JSON.stringify(envelope.request);
    // A newly-attached file also counts as dirty even if the shape matches.
    return (
      projected !== original || Object.keys(editable.attachments).length > 0
    );
  }, [editable, envelope]);

  // The request the run/copy/display helpers work against. Prefers the
  // in-progress edit so the user can Run edits before saving.
  const request = editable ? toParsedCurl(editable) : envelope?.request;

  const handleRun = useCallback(async () => {
    if (!request) return;
    setBusy(true);
    setRunError(null);
    setResponse(null);
    try {
      // Auto-resolve file attachments from the collection: for every
      // file part in the saved request, look for a matching binary
      // entry at `<apiName>/input/<basename>` in the source archive.
      // Missing bytes become a 0-byte file part (the server sees the
      // multipart shape, just no content). Users who need to attach
      // real bytes should re-import via the dialog and pick files.
      const attachments: Record<string, Blob> = {};
      if (request.formParts && document_.archiveId && document_.archivePath) {
        const archive = archives.find((a) => a.id === document_.archiveId);
        if (archive) {
          const lastSlash = document_.archivePath.lastIndexOf('/');
          const apiFolder =
            lastSlash >= 0 ? document_.archivePath.slice(0, lastSlash) : '';
          for (const part of request.formParts) {
            if (part.kind !== 'file' || !part.filename) continue;
            const wanted = apiFolder
              ? `${apiFolder}/input/${part.filename}`
              : `input/${part.filename}`;
            const entry = archive.entries.find(
              (e) => e.path === wanted && e.binaryBase64,
            );
            if (!entry?.binaryBase64) continue;
            // Rehydrate base64 → Blob so the fetch layer can treat it
            // like a browser-picked File without special-casing.
            const bin = atob(entry.binaryBase64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            attachments[part.name] = new Blob([bytes], {
              type: entry.mimeType ?? 'application/octet-stream',
            });
          }
        }
      }
      // Session-picked attachments always win over archive-resolved
      // ones — they represent the reviewer's most recent intent.
      if (editable) {
        for (const [name, file] of Object.entries(editable.attachments)) {
          attachments[name] = file;
        }
      }

      const result = await fetchViaProxyOrDirect(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        insecure: request.insecure,
        formParts: request.formParts,
        attachments,
      });
      setResponse(result);

      const cls = classifyResponse(request.url, result.contentType);
      const title = `${request.method} ${shortHost(request.url)} (${result.status})`;
      // Only open a tab for text responses — binary bodies would just
      // dump base64 into the editor which is worse than useless.
      if (!result.binaryBase64) {
        openFile(result.text, cls.language, title);
        setTitle(title);
      }

      // If the source doc lives inside a collection, park the response
      // next to it in the same `<apiName>/output/` folder that the save
      // flow uses. When the source doc is at `<apiName>/request.curl.json`
      // (the new canonical layout) the api-folder prefix is preserved.
      // Legacy loose `<name>.curl.json` docs (no api-folder) fall back
      // to a flat `output/` sibling so nothing breaks for older saves.
      if (document_.archiveId && document_.archivePath) {
        const path = document_.archivePath;
        const lastSlash = path.lastIndexOf('/');
        const folder = lastSlash >= 0 ? path.slice(0, lastSlash) : '';
        // Timestamp with high enough resolution to disambiguate rapid runs
        // but readable in a file tree (no colons, no dots — Windows-safe).
        const ts = new Date()
          .toISOString()
          .replace(/[:.]/g, '-')
          .replace(/Z$/, '');
        if (result.binaryBase64) {
          // Multi-signal filename resolution: server's Content-Disposition
          // wins, otherwise MIME → ext, otherwise magic bytes (catches
          // servers that return `application/octet-stream` for a real
          // ZIP), otherwise URL suffix, otherwise `.bin`. Anchoring the
          // filesystem name on the SERVER'S suggested basename is what
          // makes the ZIP path Just Work — click it in the tree and the
          // existing zip-container handler unpacks it in place.
          const fmt = resolveResponseFormat({
            url: result.finalUrl || request.url,
            contentType: result.contentType,
            contentDisposition: result.contentDisposition,
            base64Body: result.binaryBase64,
          });
          const filename =
            fmt.suggestedFilename || `response.${ts}.${fmt.ext}`;
          const outPath = folder
            ? `${folder}/output/${filename}`
            : `output/${filename}`;
          addBinaryToCollection(
            document_.archiveId,
            outPath,
            result.binaryBase64,
            fmt.mime,
            result.byteSize ?? 0,
          );
        } else {
          const fmt = resolveResponseFormat({
            url: result.finalUrl || request.url,
            contentType: result.contentType,
            contentDisposition: result.contentDisposition,
          });
          // Text branch: prefer server filename if present, else stamp
          // the timestamp so re-runs don't clobber each other.
          const filename =
            fmt.suggestedFilename ||
            `response.${ts}.${textExtFor(fmt.ext, result.contentType)}`;
          const outPath = folder
            ? `${folder}/output/${filename}`
            : `output/${filename}`;
          addRawToCollection(document_.archiveId, outPath, result.text, cls.language);
        }
      }

      if (result.binaryBase64) {
        toast.info(
          `${request.method} ${result.status} — ${result.byteSize ?? 0} bytes ` +
            `(${result.contentType || 'binary'}) saved to output/`,
        );
      } else if (result.upstreamError) {
        toast.info(`Upstream ${result.status}. Body opened as a tab.`);
      } else {
        toast.success(
          result.viaProxy
            ? `${request.method} ${result.status} — via dev proxy`
            : `${request.method} ${result.status}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setRunError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [
    request,
    openFile,
    setTitle,
    document_.archiveId,
    document_.archivePath,
    addRawToCollection,
    addBinaryToCollection,
    archives,
    editable,
  ]);

  /**
   * Persist edits back to the envelope + archive. Steps:
   *
   *   1. Re-serialize the envelope with the projected `ParsedCurl` and
   *      write it to the tab via `setContent`. The `filePreview` layer
   *      will re-parse and this component reseeds cleanly (see effect).
   *   2. If the doc is backed by an archive entry, upsert the JSON at
   *      `archivePath` via `addRawToCollection` (which overwrites when
   *      the path already exists — same-path re-add is defined as
   *      update-in-place, not suffix-dedup).
   *   3. For every session-picked attachment, base64 the bytes and
   *      write them next to the request at `<apiName>/input/<basename>`
   *      via `addBinaryToCollection`. The reference filename on the
   *      form part is updated to match the picked file's name so
   *      auto-resolution finds it on the next run.
   */
  const handleSave = useCallback(async () => {
    if (!editable || !envelope) return;
    setSaving(true);
    try {
      // Rewrite file-part filenames to match any freshly-picked file so
      // the recorded reference always resolves to the just-persisted
      // input entry. Users can still override the field manually later.
      const nextFormParts = editable.formParts.map((p) => {
        if (p.kind !== 'file') return p;
        const picked = editable.attachments[p.name];
        return picked ? { ...p, filename: picked.name } : p;
      });
      const alignedEditable: EditableRequest = { ...editable, formParts: nextFormParts };
      const parsed = toParsedCurl(alignedEditable);
      const nextEnvelope = {
        ...envelope,
        savedAt: new Date().toISOString(),
        request: parsed,
      };
      const nextJson = JSON.stringify(nextEnvelope, null, 2);

      // Push into the tab. `setContent` records history so undo works.
      setContent(nextJson);

      // Also push into the archive entry when there is one. Same path
      // → upsert. We don't touch other entries in the archive.
      if (document_.archiveId && document_.archivePath) {
        addRawToCollection(
          document_.archiveId,
          document_.archivePath,
          nextJson,
          'json',
          { overwrite: true },
        );
      }

      // Persist newly-attached bytes into `<apiName>/input/<basename>`.
      // Only writes files the user picked this session; archive-resolved
      // bytes are left where they are.
      if (
        document_.archiveId &&
        document_.archivePath &&
        Object.keys(alignedEditable.attachments).length > 0
      ) {
        const lastSlash = document_.archivePath.lastIndexOf('/');
        const apiFolder =
          lastSlash >= 0 ? document_.archivePath.slice(0, lastSlash) : '';
        for (const part of parsed.formParts ?? []) {
          if (part.kind !== 'file') continue;
          const file = alignedEditable.attachments[part.name];
          if (!file) continue;
          const base64 = await blobToBase64(file);
          const mime =
            part.contentType || file.type || 'application/octet-stream';
          const basename = part.filename ?? file.name;
          const outPath = apiFolder
            ? `${apiFolder}/input/${basename}`
            : `input/${basename}`;
          addBinaryToCollection(
            document_.archiveId,
            outPath,
            base64,
            mime,
            file.size,
            { overwrite: true },
          );
        }
      }

      // Drop session attachments — they now live in the archive and the
      // dirty flag should clear.
      setEditable({ ...alignedEditable, attachments: {} });
      toast.success('Request saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [
    editable,
    envelope,
    setContent,
    document_.archiveId,
    document_.archivePath,
    addRawToCollection,
    addBinaryToCollection,
  ]);

  const handleCopyCurl = useCallback(() => {
    if (!request) return;
    // Reconstruct a plausible cURL line so the user can paste it into a
    // terminal / Postman / another tool. Values are single-quoted; embedded
    // single quotes are escaped with the classic '"'"' trick.
    const q = (s: string) => `'${s.replace(/'/g, "'\"'\"'")}'`;
    const parts = ['curl', q(request.url)];
    if (request.method && request.method !== 'GET') {
      parts.push('-X', request.method);
    }
    for (const [k, v] of Object.entries(request.headers || {})) {
      parts.push('-H', q(`${k}: ${v}`));
    }
    if (request.body) parts.push('--data-raw', q(request.body));
    if (request.insecure) parts.push('--insecure');
    void navigator.clipboard.writeText(parts.join(' ')).then(
      () => toast.success('cURL copied to clipboard'),
      () => toast.error('Clipboard copy failed'),
    );
  }, [request]);

  if (!envelope || !request) {
    // Not a cURL envelope after all — signal caller by returning null so
    // the App preview switch can fall through to plain JSON rendering.
    return null;
  }

  const isPrivate = (() => {
    try {
      return isPrivateHost(new URL(request.url).hostname);
    } catch {
      return false;
    }
  })();

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <header className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <MethodBadge method={request.method} />
          <code className="text-sm font-mono break-all text-slate-800 dark:text-slate-100">
            {request.url}
          </code>
        </div>
        {envelope.savedAt && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Saved {new Date(envelope.savedAt).toLocaleString()}
          </p>
        )}
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleRun}
          disabled={busy}
          className={clsx(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium',
            'bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60',
          )}
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          {busy ? 'Sending…' : response ? 'Re-run' : 'Run request'}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !isDirty}
          title={
            isDirty
              ? 'Save edits back to this request'
              : 'No unsaved changes'
          }
          className={clsx(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border',
            isDirty
              ? 'bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600'
              : 'border-slate-200 dark:border-slate-700 text-slate-400 cursor-not-allowed',
            'disabled:opacity-60',
          )}
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {saving ? 'Saving…' : isDirty ? 'Save changes' : 'Saved'}
        </button>
        <button
          type="button"
          onClick={handleCopyCurl}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-slate-200 dark:border-slate-700 hover:border-brand-400 dark:hover:border-brand-500 text-slate-600 dark:text-slate-300"
        >
          <Copy size={13} /> Copy as cURL
        </button>
        {isPrivate && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1">
            <Info size={11} /> Private host — proxy will auto-allow
          </span>
        )}
        {request.insecure && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1">
            <ShieldAlert size={11} /> TLS check disabled (<code>-k</code>)
          </span>
        )}
      </div>

      {/* ── Editable request ──────────────────────────────────────── */}
      {editable && (
        <RequestEditor request={editable} onChange={setEditable} />
      )}

      {/* ── Attachment resolution status (read-only) ──────────────── */}
      {request.formParts && request.formParts.length > 0 && (
        <Section title="Attachments">
          <div className="space-y-1">
            {request.formParts.filter((p) => p.kind === 'file').length === 0 && (
              <p className="text-[11px] text-slate-400 italic">
                No file parts.
              </p>
            )}
            {request.formParts
              .filter((p) => p.kind === 'file')
              .map((part, i) => {
                // Mirror the auto-resolver logic so the user sees ahead
                // of time whether Run will find bytes or send a 0-byte
                // placeholder. Session-picked files always win.
                const sessionPicked = !!(
                  editable && editable.attachments[part.name]
                );
                let resolvedInArchive = false;
                if (
                  part.filename &&
                  document_.archiveId &&
                  document_.archivePath
                ) {
                  const archive = archives.find(
                    (a) => a.id === document_.archiveId,
                  );
                  if (archive) {
                    const lastSlash = document_.archivePath.lastIndexOf('/');
                    const apiFolder =
                      lastSlash >= 0
                        ? document_.archivePath.slice(0, lastSlash)
                        : '';
                    const wanted = apiFolder
                      ? `${apiFolder}/input/${part.filename}`
                      : `input/${part.filename}`;
                    resolvedInArchive = archive.entries.some(
                      (e) => e.path === wanted && !!e.binaryBase64,
                    );
                  }
                }
                return (
                  <div
                    key={`${part.name}-${i}`}
                    className="flex items-center gap-2 text-[11px] font-mono bg-slate-50 dark:bg-night-muted rounded px-2 py-1"
                  >
                    <span className="font-medium shrink-0">{part.name}</span>
                    <span className="text-slate-400">→</span>
                    <span className="text-slate-600 dark:text-slate-300 truncate flex-1">
                      {part.filename || '(no filename)'}
                    </span>
                    {sessionPicked ? (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                        ✓ picked — save to persist
                      </span>
                    ) : resolvedInArchive ? (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                        ✓ input/ found
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400">
                        ⚠ no bytes — will send 0-byte placeholder
                      </span>
                    )}
                  </div>
                );
              })}
          </div>
        </Section>
      )}

      {/* ── Response ──────────────────────────────────────────────── */}
      {(response || runError) && (
        <Section title="Response">
          {runError && (
            <p className="text-xs text-rose-600 dark:text-rose-300 mb-2">
              {runError}
            </p>
          )}
          {response && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={clsx(
                    'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded',
                    response.upstreamError
                      ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20'
                      : 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20',
                  )}
                >
                  {response.status}
                </span>
                <span
                  className="text-[11px] text-slate-500 dark:text-slate-400 truncate flex-1"
                  title={response.contentType}
                >
                  {response.contentType || '(no content-type)'}
                </span>
                <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
                  {response.text.length.toLocaleString()} chars
                </span>
                {document_.archiveId && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-300"
                    title="Response saved next to this request under output/"
                  >
                    <Save size={10} /> saved
                  </span>
                )}
              </div>
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-slate-50 dark:bg-night-muted rounded p-2 max-h-80 overflow-auto">
                {response.text.length > 4000
                  ? `${response.text.slice(0, 4000)}\n… (truncated — full body opened as a tab)`
                  : response.text || '(empty body)'}
              </pre>
            </>
          )}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <header className="px-3 py-1.5 bg-slate-50 dark:bg-night-muted border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
          {title}
        </h3>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function MethodBadge({ method }: { method: string }) {
  const upper = method.toUpperCase();
  const palette: Record<string, string> = {
    GET: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    POST: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    PUT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    PATCH: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    DELETE: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  };
  const cls = palette[upper] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return (
    <span className={clsx('text-[10px] font-mono font-bold px-1.5 py-0.5 rounded', cls)}>
      {upper}
    </span>
  );
}
