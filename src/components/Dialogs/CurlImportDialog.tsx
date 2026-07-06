import { useCallback, useEffect, useMemo, useState } from 'react';
import { Terminal, Loader2, ShieldAlert, Info, Play, Save, RefreshCw, FolderPlus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { htmlToMarkdown } from '@/lib/converters/htmlToMd';
import { parseCurl } from '@/lib/curlParser';
import { fetchViaProxyOrDirect, isProxyAvailable, type ProxyResult } from '@/lib/proxyClient';
import { resolveResponseFormat } from '@/lib/mimeExt';
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
  open: boolean;
  onClose: () => void;
}

/** Language guessed from a Content-Type / URL — response classifier. */
function classifyResponse(url: string, contentType: string): { kind: 'html' | 'json' | 'xml' | 'markdown'; language: Language } {
  const ct = contentType.toLowerCase();
  const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() ?? '';
  if (ct.includes('json') || ext === 'json') return { kind: 'json', language: 'json' };
  if (ct.includes('xml') || ext === 'xml') return { kind: 'xml', language: 'xml' };
  if (ct.includes('html') || ext === 'html' || ext === 'htm') return { kind: 'html', language: 'markdown' };
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return { kind: 'markdown', language: 'markdown' };
  return ct.startsWith('text/') ? { kind: 'markdown', language: 'markdown' } : { kind: 'json', language: 'json' };
}

/** Short host label for filenames — strips leading `www.`. */
function shortHost(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return 'request';
  }
}

/**
 * Derive an "API name" folder from a URL. Uses the last non-empty path
 * segment (query/hash-stripped) — e.g. `.../events/send-email-message?x=1`
 * → `send-email-message`. Falls back to the hostname if the URL has no
 * meaningful path.
 *
 * This is what groups a saved cURL request with its response files: each
 * import becomes a `<apiName>/` folder inside the target collection with
 * a canonical layout (request.curl.json, input/, output/), so the user
 * doesn't end up with a flat pile of `POST_host_xxx.curl.json` files.
 */
function apiNameFromUrl(u: string): string {
  try {
    const url = new URL(u);
    // Split, drop empties (leading `/` and trailing `/…`), keep only real segments.
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      const raw = decodeURIComponent(segments[segments.length - 1]);
      // Sanitize for use as a folder name — keep it filesystem-friendly and
      // human-readable. Collapse runs of separators to a single dash.
      const clean = raw
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '')
        .trim();
      if (clean) return clean;
    }
    return url.hostname.replace(/^www\./, '') || 'request';
  } catch {
    return 'request';
  }
}

/**
 * Two-phase cURL importer:
 *
 *   1. **Parse.** Paste a raw cURL command, hit "Parse". The dialog
 *      renders an editable review — every field can be tweaked before
 *      running (fix a stale token, retarget the URL, drop noisy headers).
 *   2. **Save and/or Run.** "Save to collection" writes the parsed
 *      request as a `.curl.json` doc under `input/` so it can be
 *      replayed later. "Run" executes via the dev proxy (or direct fetch
 *      as fallback) and, on success, opens the response as a new tab
 *      plus an inline snippet right in the dialog. When both are done,
 *      saving also stores the response under `output/`.
 *
 * The two-phase flow deliberately mirrors how people use Postman /
 * Insomnia: import the definition first, poke at it, THEN fire. A failed
 * proxy round trip therefore doesn't lose the parse work.
 */
export function CurlImportDialog({ open, onClose }: Props) {
  const [command, setCommand] = useState('');
  const [request, setRequest] = useState<EditableRequest | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proxyAvailable, setProxyAvailable] = useState<boolean | null>(null);
  const [response, setResponse] = useState<ProxyResult | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const openFile = useAppStore((s) => s.openFile);
  const setTitle = useAppStore((s) => s.setTitle);
  const collections = useAppStore((s) => s.workspace.archives);
  const createCollection = useAppStore((s) => s.createCollection);
  const importFilesIntoCollection = useAppStore((s) => s.importFilesIntoCollection);
  // Direct binary-write path — needed because `importFilesIntoCollection`
  // goes through `File.text()` which mangles PDFs / images.
  const addBinaryToCollection = useAppStore((s) => s.addBinaryToCollection);

  const zipCollections = useMemo(
    () => collections.filter((a) => a.kind === 'zip'),
    [collections],
  );

  // Reset state whenever the dialog re-opens so the previous session
  // doesn't leak between imports.
  useEffect(() => {
    if (!open) return;
    setCommand('');
    setRequest(null);
    setParseError(null);
    setResponse(null);
    setPickerOpen(false);
    void isProxyAvailable().then(setProxyAvailable);
  }, [open]);

  const handleParse = useCallback(() => {
    setParseError(null);
    setResponse(null);
    const raw = command.trim();
    if (!raw) return;
    try {
      const parsed = parseCurl(raw);
      setRequest(toEditable(parsed));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Parse failed');
      setRequest(null);
    }
  }, [command]);

  const handleRun = async () => {
    if (!request) return;
    setBusy(true);
    setResponse(null);
    try {
      const parsed = toParsedCurl(request);
      const result = await fetchViaProxyOrDirect(parsed.url, {
        method: parsed.method,
        headers: parsed.headers,
        body: parsed.body,
        insecure: parsed.insecure,
        formParts: parsed.formParts,
        attachments: request.attachments,
      });
      setResponse(result);

      // Binary responses (PDF / image / octet-stream) can't be usefully
      // opened as a text tab — we'd just render base64 in the editor,
      // which is a footgun. Save-to-collection is the only sensible sink
      // for these, and the picker below already knows how to route them.
      // For text responses we open a tab immediately since the inline
      // preview here is just a snippet.
      if (result.binaryBase64) {
        toast.info(
          `${parsed.method} ${result.status} — ${result.byteSize ?? 0} bytes ` +
            `(${result.contentType || 'binary'}). Use "Save to collection" to keep it.`,
        );
      } else {
        const cls = classifyResponse(parsed.url, result.contentType);
        let content = result.text;
        if (cls.kind === 'html') content = await htmlToMarkdown(result.text);
        const title = `${parsed.method} ${shortHost(parsed.url)} (${result.status})`;
        openFile(content, cls.language, title);
        setTitle(title);

        if (result.upstreamError) {
          toast.info(`Upstream ${result.status}. Body opened as a tab.`);
        } else {
          toast.success(
            result.viaProxy
              ? `${parsed.method} ${result.status} — via dev proxy`
              : `${parsed.method} ${result.status}`,
          );
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Save-request-to-collection flow. Bundles the parsed request into a
   * per-API folder inside the target collection:
   *
   *   <apiName>/
   *     request.curl.json           ← the parsed cURL envelope (this doc)
   *     input/                      ← reserved for attachment payloads
   *                                    (only materialised when the parser
   *                                    detects file uploads; currently a
   *                                    placeholder as the parser doesn't
   *                                    yet decode -F/--form)
   *     output/
   *       response.<ts>.<ext>       ← saved response for this run
   *
   * Multiple runs pile into `output/` with timestamped filenames so the
   * user can diff runs. `<apiName>` comes from the URL's last path
   * segment (e.g. `send-email-message`) — see `apiNameFromUrl`.
   */
  const handleSaveToCollection = async (collectionId: string) => {
    if (!request) return;
    const parsed = toParsedCurl(request);
    const collection = zipCollections.find((c) => c.id === collectionId);
    if (!collection) return;
    const apiName = apiNameFromUrl(parsed.url);
    // Compact response timestamp — enough resolution to disambiguate
    // rapid re-runs, short enough to skim in the file tree.
    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace(/Z$/, '');
    const files: File[] = [];
    // Request as a re-openable JSON envelope — keys mirror ParsedCurl so
    // the file opens back as an interactive card via CurlRequestPreview.
    const requestJson = JSON.stringify(
      {
        kind: 'doc-studio/curl-request',
        version: 1,
        savedAt: new Date().toISOString(),
        apiName,
        request: parsed,
      },
      null,
      2,
    );
    files.push(
      new File([requestJson], `${apiName}/request.curl.json`, {
        type: 'application/json',
      }),
    );

    // Text response (if any) goes through the same file-import path as
    // the request — same de-dup and language-inference rules. Binary
    // responses (PDF / image / octet-stream) go through
    // `addBinaryToCollection` directly, since `importFilesIntoCollection`
    // reads File.text() and would corrupt the bytes.
    if (response && !response.binaryBase64) {
      const fmt = resolveResponseFormat({
        url: response.finalUrl || parsed.url,
        contentType: response.contentType,
        contentDisposition: response.contentDisposition,
      });
      const respExt =
        fmt.ext && fmt.ext !== 'bin'
          ? fmt.ext
          : /json/i.test(response.contentType)
            ? 'json'
            : /xml/i.test(response.contentType)
              ? 'xml'
              : /html/i.test(response.contentType)
                ? 'html'
                : 'txt';
      const respName = fmt.suggestedFilename || `response.${ts}.${respExt}`;
      const respFile = new File(
        [response.text],
        `${apiName}/output/${respName}`,
        { type: response.contentType || 'text/plain' },
      );
      files.push(respFile);
    }

    const first = await importFilesIntoCollection(collection.id, files);

    // Binary side-channel — bypasses the File-based importer to keep bytes intact.
    if (response?.binaryBase64) {
      // Same multi-signal detection as the run-from-preview path: honour
      // Content-Disposition when present, fall back to MIME, then magic
      // bytes (fixes the "server sends a ZIP as application/octet-stream"
      // trap that otherwise stored the reply as an unopenable `.bin`).
      const fmt = resolveResponseFormat({
        url: response.finalUrl || parsed.url,
        contentType: response.contentType,
        contentDisposition: response.contentDisposition,
        base64Body: response.binaryBase64,
      });
      const filename = fmt.suggestedFilename || `response.${ts}.${fmt.ext}`;
      addBinaryToCollection(
        collection.id,
        `${apiName}/output/${filename}`,
        response.binaryBase64,
        fmt.mime,
        response.byteSize ?? 0,
      );
    }

    // Persist attached file bytes into `<apiName>/input/<basename>` so
    // future runs (from the saved envelope's CurlRequestPreview) can
    // auto-resolve them without asking the user to re-pick. Only bytes
    // the user explicitly attached are stored — reference-only file
    // parts remain "no attachment" until someone provides one.
    if (Object.keys(request.attachments).length > 0) {
      for (const part of parsed.formParts ?? []) {
        if (part.kind !== 'file') continue;
        const file = request.attachments[part.name];
        if (!file) continue;
        const base64 = await blobToBase64(file);
        const mime =
          part.contentType || file.type || 'application/octet-stream';
        // Use the recorded basename as the filesystem key. Two file parts
        // pointing at the same basename would collide — `addBinaryToCollection`
        // suffixes ` (2)` etc. so it stays reversible.
        const basename = part.filename ?? file.name;
        addBinaryToCollection(
          collection.id,
          `${apiName}/input/${basename}`,
          base64,
          mime,
          file.size,
        );
      }
    }

    if (first || response?.binaryBase64) {
      toast.success(`Saved to "${collection.name}" › ${apiName}/`);
    } else {
      toast.error('Save failed');
    }
    setPickerOpen(false);
  };

  const handleCreateAndSave = async () => {
    if (!request) return;
    const name = window.prompt('New collection name', 'API requests');
    if (name === null) return;
    const id = createCollection(name);
    await handleSaveToCollection(id);
  };

  return (
    <Modal open={open} onClose={onClose} title="Import from cURL" wide>
      <div className="space-y-3">
        {/* ── Step 1: paste + parse ─────────────────────────────────── */}
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
            cURL command
          </span>
          <textarea
            autoFocus
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleParse();
              }
            }}
            placeholder={`curl 'https://api.example.com/v1/docs/123' \\\n  -H 'accept: application/json' \\\n  -H 'authorization: Bearer …'`}
            spellCheck={false}
            rows={6}
            className="mt-1 w-full font-mono text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-night-muted px-3 py-2 outline-none focus:border-brand-400 dark:focus:border-brand-500 resize-y"
          />
        </label>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleParse} disabled={!command.trim()}>
            <Terminal size={14} /> Parse
          </Button>
          {parseError && (
            <span className="text-xs text-rose-600 dark:text-rose-400">{parseError}</span>
          )}
          <div className="ml-auto text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Ctrl / ⌘ + Enter to parse
          </div>
        </div>

        {/* ── Step 2: editable review ──────────────────────────────── */}
        {request && <RequestEditor request={request} onChange={setRequest} />}

        {/* ── Proxy status banner ──────────────────────────────────── */}
        {proxyAvailable === true && (
          <div className="flex items-start gap-2 text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 rounded-md px-2 py-1.5">
            <Info size={12} className="mt-0.5 flex-shrink-0" />
            <span>
              Dev proxy active — CORS-locked hosts, custom headers, and{' '}
              <code className="font-mono">-k</code> insecure TLS all work.
            </span>
          </div>
        )}
        {proxyAvailable === false && (
          <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-md px-2 py-1.5">
            <ShieldAlert size={12} className="mt-0.5 flex-shrink-0" />
            <span>
              Dev proxy is not running. Requests go directly from the browser and may fail with CORS.
              Start <code className="font-mono">npm run dev</code> to enable it.
            </span>
          </div>
        )}

        {/* ── Response preview (inline) ────────────────────────────── */}
        {response && <ResponsePreview response={response} />}

        {/* ── Action bar ───────────────────────────────────────────── */}
        <div className="flex justify-between items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
          <div className="flex gap-2">
            {request && (
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPickerOpen((v) => !v)}
                  disabled={busy}
                  title="Save this request (and last response, if any) to a collection"
                >
                  <Save size={14} /> Save to collection
                </Button>
                {pickerOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 bottom-full mb-1 z-20 min-w-[220px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-night shadow-lg py-1"
                  >
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Save into
                    </div>
                    {zipCollections.length === 0 && (
                      <p className="px-2 py-1 text-xs text-slate-500 dark:text-slate-400">
                        No collections yet.
                      </p>
                    )}
                    {zipCollections.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSaveToCollection(c.id)}
                        className="w-full text-left px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        {c.name}
                      </button>
                    ))}
                    <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
                    <button
                      type="button"
                      onClick={handleCreateAndSave}
                      className="w-full text-left px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 text-emerald-600 dark:text-emerald-300"
                    >
                      <FolderPlus size={11} /> New collection…
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {request && (
              <Button variant="primary" size="sm" onClick={handleRun} disabled={busy}>
                {busy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : response ? (
                  <RefreshCw size={14} />
                ) : (
                  <Play size={14} />
                )}
                {response ? 'Re-run' : 'Run'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Response preview
// ───────────────────────────────────────────────────────────────────────

function ResponsePreview({ response }: { response: ProxyResult }) {
  const preview = response.text.length > 800 ? `${response.text.slice(0, 800)}…` : response.text;
  const badgeColour = response.upstreamError
    ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20'
    : 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20';
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <header className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 dark:bg-night-muted border-b border-slate-200 dark:border-slate-700">
        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${badgeColour}`}>
          {response.status}
        </span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate flex-1" title={response.contentType}>
          {response.contentType || '(no content-type)'}
        </span>
        <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
          {response.text.length.toLocaleString()} chars
        </span>
      </header>
      <pre className="text-[11px] font-mono px-2.5 py-2 max-h-40 overflow-auto whitespace-pre-wrap break-words bg-white dark:bg-night">
        {preview || <span className="italic text-slate-400">(empty body)</span>}
      </pre>
    </div>
  );
}
