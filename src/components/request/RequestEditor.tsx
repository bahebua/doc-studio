import { X } from 'lucide-react';
import type { ParsedCurl, FormPart } from '@/lib/curlParser';

// ───────────────────────────────────────────────────────────────────────
// Types & conversion helpers
// ───────────────────────────────────────────────────────────────────────

/** Local, editable mirror of ParsedCurl. Header list uses a positional
 *  array so the user can add/remove/reorder without React key thrash.
 *  `formParts` is carried through untouched — the UI treats each part
 *  as a labelled row (text parts show the value; file parts show the
 *  basename + a file-picker for attaching bytes). */
export interface EditableRequest {
  url: string;
  method: string;
  headers: { name: string; value: string }[];
  body: string;
  insecure: boolean;
  formParts: FormPart[];
  /** Attachments the user has picked for `formParts` file entries this
   *  session, keyed by field name. Not persisted with the envelope —
   *  saved binaries live in the collection's `<apiName>/input/` folder
   *  instead. Populated only after the reviewer picks a real File. */
  attachments: Record<string, File>;
}

export function toEditable(p: ParsedCurl): EditableRequest {
  return {
    url: p.url,
    method: p.method,
    headers: Object.entries(p.headers).map(([name, value]) => ({ name, value })),
    body: p.body ?? '',
    insecure: !!p.insecure,
    formParts: p.formParts ? p.formParts.map((f) => ({ ...f })) : [],
    attachments: {},
  };
}

export function toParsedCurl(e: EditableRequest): ParsedCurl {
  const headers: Record<string, string> = {};
  for (const { name, value } of e.headers) {
    const trimmed = name.trim();
    if (trimmed) headers[trimmed] = value;
  }
  return {
    url: e.url.trim(),
    method: e.method.trim().toUpperCase() || 'GET',
    headers,
    body: e.body.trim() ? e.body : undefined,
    insecure: e.insecure || undefined,
    formParts: e.formParts.length > 0 ? e.formParts.map((f) => ({ ...f })) : undefined,
  };
}

/** Blob → base64 string, chunked so multi-MB attachments don't blow the
 *  JS call stack via `String.fromCharCode.apply(…, huge)`. Mirrors the
 *  helper in `proxyClient.ts` — duplicated because pulling it in from
 *  there would need an export and this is a one-liner in spirit. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

// ───────────────────────────────────────────────────────────────────────
// Editable request review
// ───────────────────────────────────────────────────────────────────────

/**
 * Full editor surface for a request — method + URL, headers, body OR
 * multipart form parts, and the `-k` insecure toggle. Purely controlled:
 * every keystroke calls `onChange` with the next request. Callers own
 * the state and decide when to persist (Run / Save / dialog dismiss).
 *
 * Used by both the cURL import dialog and the saved-envelope preview
 * so the two edit surfaces behave identically.
 */
export function RequestEditor({
  request,
  onChange,
}: {
  request: EditableRequest;
  onChange: (r: EditableRequest) => void;
}) {
  const update = <K extends keyof EditableRequest>(key: K, value: EditableRequest[K]) => {
    onChange({ ...request, [key]: value });
  };

  const setHeader = (idx: number, patch: Partial<{ name: string; value: string }>) => {
    const next = request.headers.map((h, i) => (i === idx ? { ...h, ...patch } : h));
    onChange({ ...request, headers: next });
  };
  const addHeader = () => {
    onChange({ ...request, headers: [...request.headers, { name: '', value: '' }] });
  };
  const removeHeader = (idx: number) => {
    onChange({ ...request, headers: request.headers.filter((_, i) => i !== idx) });
  };

  const addFormPart = (kind: 'text' | 'file') => {
    const base: FormPart =
      kind === 'file'
        ? { name: '', kind: 'file', filename: '' }
        : { name: '', kind: 'text', value: '' };
    onChange({ ...request, formParts: [...request.formParts, base] });
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50/50 dark:bg-night-muted/50">
      <div className="flex items-center gap-2">
        <select
          value={request.method}
          onChange={(e) => update('method', e.target.value)}
          className="text-xs font-semibold uppercase rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-night px-2 h-8"
        >
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="url"
          value={request.url}
          onChange={(e) => update('url', e.target.value)}
          placeholder="https://…"
          className="flex-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-night px-2 h-8 outline-none focus:border-brand-400 dark:focus:border-brand-500 font-mono"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
            Headers
          </span>
          <button
            type="button"
            onClick={addHeader}
            className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline"
          >
            + Add
          </button>
        </div>
        <div className="space-y-1">
          {request.headers.length === 0 && (
            <p className="text-[11px] text-slate-400 italic">No headers</p>
          )}
          {request.headers.map((h, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="text"
                value={h.name}
                onChange={(e) => setHeader(i, { name: e.target.value })}
                placeholder="name"
                className="w-32 text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-night px-1.5 h-7 outline-none focus:border-brand-400 dark:focus:border-brand-500 font-mono"
              />
              <input
                type="text"
                value={h.value}
                onChange={(e) => setHeader(i, { value: e.target.value })}
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

      {(request.body || request.method !== 'GET') && request.formParts.length === 0 && (
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
            Body
          </span>
          <textarea
            value={request.body}
            onChange={(e) => update('body', e.target.value)}
            placeholder="(empty)"
            rows={4}
            className="mt-1 w-full text-[11px] font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-night px-2 py-1.5 outline-none focus:border-brand-400 dark:focus:border-brand-500 resize-y"
          />
        </label>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
            {request.formParts.length > 0
              ? `Multipart form (${request.formParts.length})`
              : 'Multipart form'}
          </span>
          <div className="flex items-center gap-2">
            {request.formParts.length > 0 && (
              <span className="text-[10px] text-slate-400">multipart/form-data</span>
            )}
            <button
              type="button"
              onClick={() => addFormPart('text')}
              className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline"
            >
              + Text
            </button>
            <button
              type="button"
              onClick={() => addFormPart('file')}
              className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline"
            >
              + File
            </button>
          </div>
        </div>
        {request.formParts.length > 0 && (
          <div className="space-y-1.5">
            {request.formParts.map((part, i) => (
              <FormPartRow
                key={`${part.name}-${i}`}
                part={part}
                attachedFile={request.attachments[part.name]}
                onPartChange={(patch) => {
                  const next = request.formParts.map((p, idx) =>
                    idx === i ? { ...p, ...patch } : p,
                  );
                  onChange({ ...request, formParts: next });
                }}
                onAttach={(file) => {
                  // Store attachment keyed by field name so re-picks
                  // overwrite the previous choice for the same field.
                  onChange({
                    ...request,
                    attachments: { ...request.attachments, [part.name]: file },
                  });
                }}
                onClearAttach={() => {
                  const next = { ...request.attachments };
                  delete next[part.name];
                  onChange({ ...request, attachments: next });
                }}
                onRemove={() => {
                  const nextParts = request.formParts.filter((_, idx) => idx !== i);
                  const nextAttachments = { ...request.attachments };
                  delete nextAttachments[part.name];
                  onChange({
                    ...request,
                    formParts: nextParts,
                    attachments: nextAttachments,
                  });
                }}
              />
            ))}
          </div>
        )}
      </div>

      <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
        <input
          type="checkbox"
          checked={request.insecure}
          onChange={(e) => update('insecure', e.target.checked)}
          className="rounded"
        />
        <span>
          <code className="font-mono">-k</code> insecure — skip TLS verification (for corp APIs
          with self-signed certs)
        </span>
      </label>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Multipart form part row
// ───────────────────────────────────────────────────────────────────────

/** One editable row inside the "Multipart form" panel. Text parts render
 *  as an inline `<textarea>` (JSON blobs are common — `input` would clip
 *  them). File parts render the recorded basename, the currently attached
 *  file if any, a `<input type=file>` picker, and a Clear button. */
function FormPartRow({
  part,
  attachedFile,
  onPartChange,
  onAttach,
  onClearAttach,
  onRemove,
}: {
  part: FormPart;
  attachedFile: File | undefined;
  onPartChange: (patch: Partial<FormPart>) => void;
  onAttach: (file: File) => void;
  onClearAttach: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-night p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className={
            'text-[9px] font-bold tracking-wider px-1 py-0.5 rounded ' +
            (part.kind === 'file'
              ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300')
          }
        >
          {part.kind === 'file' ? 'FILE' : 'TEXT'}
        </span>
        <input
          type="text"
          value={part.name}
          onChange={(e) => onPartChange({ name: e.target.value })}
          placeholder="field name"
          className="flex-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-night px-1.5 h-7 outline-none focus:border-brand-400 dark:focus:border-brand-500 font-mono"
        />
        {part.contentType && (
          <span
            className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-[120px]"
            title={part.contentType}
          >
            {part.contentType}
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${part.name || 'part'}`}
          className="text-slate-400 hover:text-rose-500 p-1 rounded"
        >
          <X size={11} />
        </button>
      </div>
      {part.kind === 'text' ? (
        <textarea
          value={part.value ?? ''}
          onChange={(e) => onPartChange({ value: e.target.value })}
          placeholder="(empty)"
          rows={3}
          className="w-full text-[11px] font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-night px-2 py-1.5 outline-none focus:border-brand-400 dark:focus:border-brand-500 resize-y"
        />
      ) : (
        <div className="flex items-center gap-1.5">
          <span
            className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate flex-1 min-w-0"
            title={part.filename}
          >
            {part.filename || '(no reference filename)'}
          </span>
          {attachedFile ? (
            <>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium truncate max-w-[140px]">
                ✓ {attachedFile.name} ({attachedFile.size.toLocaleString()} B)
              </span>
              <button
                type="button"
                onClick={onClearAttach}
                className="text-[10px] text-slate-400 hover:text-rose-500 underline"
              >
                clear
              </button>
            </>
          ) : (
            <label className="text-[10px] text-brand-600 dark:text-brand-300 hover:underline cursor-pointer whitespace-nowrap">
              Attach file…
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onAttach(f);
                  // Reset so re-picking the same file still fires change.
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}
