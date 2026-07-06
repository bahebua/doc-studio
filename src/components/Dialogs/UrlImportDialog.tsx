import { useMemo, useState } from 'react';
import { Link2, Loader2, ChevronDown, ChevronRight, X, KeyRound } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { htmlToMarkdown } from '@/lib/converters/htmlToMd';
import { detectArchiveKind, unpackArchive } from '@/lib/archive';
import { fetchViaProxyOrDirect } from '@/lib/proxyClient';
import { useAppStore } from '@/store/useAppStore';
import type { Language } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface HeaderRow {
  name: string;
  value: string;
}

/**
 * Pick a language + optional post-processing from a URL and its
 * `content-type` header. Falls back to file-extension guessing when the
 * server returns a generic type (many static hosts serve `.md` as
 * `text/plain`).
 */
function classify(
  url: string,
  contentType: string,
): { kind: 'html' | 'json' | 'xml' | 'markdown' | 'archive'; ext?: string } {
  const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() ?? '';
  if (['docx', 'xlsx', 'pptx', 'epub', 'zip', 'tex', 'latex'].includes(ext)) {
    return { kind: 'archive', ext };
  }
  const ct = contentType.toLowerCase();
  if (ct.includes('json') || ext === 'json') return { kind: 'json' };
  if (ct.includes('xml') || ext === 'xml') return { kind: 'xml' };
  if (ct.includes('html') || ext === 'html' || ext === 'htm') return { kind: 'html' };
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return { kind: 'markdown' };
  return ct.startsWith('text/') ? { kind: 'markdown' } : { kind: 'html' };
}

/**
 * Small dialog that pulls a URL and drops its content straight into the
 * editor. HTML → Markdown via Turndown, container formats (.docx / .zip
 * / …) go through the archive pipeline, and text formats open as-is.
 *
 * The "Advanced" section (collapsed by default) lets the user attach:
 * - Custom headers (Authorization / X-API-Key / etc.) — required for any
 *   protected endpoint.
 * - `Insecure TLS` — mirrors cURL's `-k` so corp APIs with self-signed
 *   certs can be hit while inside the org network.
 *
 * CORS caveat: browsers block cross-origin fetches unless the target site
 * opts in. When the dev proxy is available (Vite dev-server plugin) we
 * route through it automatically, which sidesteps CORS and TLS issues.
 * If the browser can't fetch AND the proxy isn't running, we surface a
 * specific error so the user knows to grab the file manually.
 */
export function UrlImportDialog({ open, onClose }: Props) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [insecure, setInsecure] = useState(false);

  const openFile = useAppStore((s) => s.openFile);
  const openArchive = useAppStore((s) => s.openArchive);
  const setTitle = useAppStore((s) => s.setTitle);

  const headersObject = useMemo(() => {
    const out: Record<string, string> = {};
    for (const { name, value } of headers) {
      const n = name.trim();
      if (n) out[n] = value;
    }
    return out;
  }, [headers]);

  const hasCustomHeaders = Object.keys(headersObject).length > 0;

  const reset = () => {
    setUrl('');
    setHeaders([]);
    setInsecure(false);
    setAdvancedOpen(false);
  };

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      toast.error('That does not look like a valid URL.');
      return;
    }
    setBusy(true);
    try {
      const suggestedTitle =
        parsed.pathname.split('/').filter(Boolean).pop() ?? parsed.hostname;

      // Detect archive first — those must go through direct fetch to
      // preserve binary bytes. The proxy pass-through would UTF-8-mangle
      // them.
      const preClassify = classify(trimmed, '');
      if (preClassify.kind === 'archive' && preClassify.ext) {
        // Direct fetch — headers still forwarded so private archives on
        // signed URLs still work.
        const res = await fetch(trimmed, {
          redirect: 'follow',
          headers: hasCustomHeaders ? headersObject : undefined,
        });
        if (!res.ok) {
          toast.error(`Fetch failed: ${res.status} ${res.statusText}`);
          return;
        }
        const buf = await res.arrayBuffer();
        const kind = detectArchiveKind(`x.${preClassify.ext}`);
        if (!kind) {
          toast.error(`Unsupported archive type: .${preClassify.ext}`);
          return;
        }
        const archive = await unpackArchive(buf, suggestedTitle, kind);
        openArchive(archive);
        toast.success(`Imported ${suggestedTitle}`);
        onClose();
        reset();
        return;
      }

      // Text-ish path — route through the dev proxy when available so
      // CORS-locked / TLS-unhappy docs still work locally.
      const result = await fetchViaProxyOrDirect(trimmed, {
        headers: hasCustomHeaders ? headersObject : undefined,
        insecure: insecure || undefined,
      });
      const classification = classify(trimmed, result.contentType);
      let content = result.text;
      let language: Language = 'markdown';
      if (classification.kind === 'html') {
        content = await htmlToMarkdown(result.text);
      } else if (classification.kind === 'json') {
        language = 'json';
      } else if (classification.kind === 'xml') {
        language = 'xml';
      }

      openFile(content, language, suggestedTitle);
      setTitle(suggestedTitle);

      if (result.upstreamError) {
        toast.info(`Imported ${parsed.hostname} — upstream returned ${result.status}`);
      } else {
        toast.success(
          result.viaProxy
            ? `Imported from ${parsed.hostname} (via dev proxy)`
            : `Imported from ${parsed.hostname}`,
        );
      }
      onClose();
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      // TypeError from fetch is nearly always CORS or network — give the
      // user actionable guidance instead of a raw stack.
      const friendly = /Failed to fetch|NetworkError|CORS/i.test(msg)
        ? 'Network or CORS block — the target site does not allow browser fetches. Try enabling the dev proxy (npm run dev), grab a raw file URL, or download manually.'
        : msg;
      toast.error(friendly);
    } finally {
      setBusy(false);
    }
  };

  // ── header-row manipulation ────────────────────────────────────────
  const addHeader = () => setHeaders((prev) => [...prev, { name: '', value: '' }]);
  const setHeaderField = (idx: number, patch: Partial<HeaderRow>) =>
    setHeaders((prev) => prev.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  const removeHeader = (idx: number) =>
    setHeaders((prev) => prev.filter((_, i) => i !== idx));
  const addPreset = (name: string, placeholder: string) => {
    setHeaders((prev) => {
      // Don't stack duplicates — if it's already there, focus intent by
      // no-op. User can just edit the existing row.
      if (prev.some((h) => h.name.toLowerCase() === name.toLowerCase())) return prev;
      return [...prev, { name, value: placeholder }];
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Import from URL" wide>
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
            URL
          </span>
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-night-muted px-2.5 h-10">
            <Link2 size={14} className="text-slate-400 flex-shrink-0" />
            <input
              type="url"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="https://raw.githubusercontent.com/user/repo/main/README.md"
              className="flex-1 bg-transparent outline-none text-sm"
            />
          </div>
        </label>

        {/* ── Advanced (headers + insecure) ────────────────────────── */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-night-muted/50">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            {advancedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Advanced
            {(hasCustomHeaders || insecure) && (
              <span className="ml-1 text-[10px] font-normal text-brand-600 dark:text-brand-300">
                ({[hasCustomHeaders && `${Object.keys(headersObject).length} header${Object.keys(headersObject).length > 1 ? 's' : ''}`, insecure && 'insecure']
                  .filter(Boolean)
                  .join(', ')})
              </span>
            )}
          </button>
          {advancedOpen && (
            <div className="px-3 pb-3 space-y-2 border-t border-slate-200 dark:border-slate-700 pt-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
                    Headers
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => addPreset('Authorization', 'Bearer ')}
                      className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-300 inline-flex items-center gap-1"
                      title="Add Authorization header"
                    >
                      <KeyRound size={10} /> Bearer
                    </button>
                    <button
                      type="button"
                      onClick={() => addPreset('X-API-Key', '')}
                      className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-300"
                      title="Add API key header"
                    >
                      + API Key
                    </button>
                    <button
                      type="button"
                      onClick={addHeader}
                      className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline"
                    >
                      + Add
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  {headers.length === 0 && (
                    <p className="text-[11px] text-slate-400 italic">
                      No custom headers. Use for API keys, bearer tokens, or content-type overrides.
                    </p>
                  )}
                  {headers.map((h, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <input
                        type="text"
                        value={h.name}
                        onChange={(e) => setHeaderField(i, { name: e.target.value })}
                        placeholder="name"
                        className="w-40 text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-night px-1.5 h-7 outline-none focus:border-brand-400 dark:focus:border-brand-500 font-mono"
                      />
                      <input
                        type="text"
                        value={h.value}
                        onChange={(e) => setHeaderField(i, { value: e.target.value })}
                        placeholder="value"
                        className="flex-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-night px-1.5 h-7 outline-none focus:border-brand-400 dark:focus:border-brand-500 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => removeHeader(i)}
                        aria-label={`Remove ${h.name || 'header'}`}
                        className="text-slate-400 hover:text-rose-500 p-1 rounded"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={insecure}
                  onChange={(e) => setInsecure(e.target.checked)}
                  className="rounded"
                />
                <span>
                  Insecure TLS — skip cert verification (equivalent to{' '}
                  <code className="font-mono">curl -k</code>). Requires dev proxy.
                </span>
              </label>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Fetches Markdown, HTML, JSON, XML, or an Office/EPUB/ZIP archive
          from the URL and opens it as a new document. HTML pages are
          auto-converted to Markdown.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={busy || !url.trim()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}
