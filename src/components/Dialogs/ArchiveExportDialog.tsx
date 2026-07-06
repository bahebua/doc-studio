import { useMemo, useState } from 'react';
import { FolderArchive, FileText, Files, Loader2, Package } from 'lucide-react';
import JSZip from 'jszip';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import type { Archive, ArchiveEntry } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  archive: Archive;
  /** Restrict the export to a subfolder inside the archive. When omitted
   *  the whole archive is exported. */
  folderPath?: string;
}

type Mode = 'zip' | 'concat-by-type' | 'concat-all';

/**
 * Trigger a browser download for a Blob / string with a chosen filename.
 * Uses a one-off object URL that we revoke on the next tick to avoid
 * leaking blobs across large exports.
 */
function downloadBlob(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Sanitize a filename fragment: strip characters Windows/macOS reject. */
function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').replace(/^\.+|\.+$/g, '') || 'export';
}

/** Return only entries under `folderPath` (or all entries when omitted).
 *  Paths are stripped of the folder prefix so ZIP export produces a flat
 *  archive rooted at the folder, not the entire original tree. */
function selectEntries(
  archive: Archive,
  folderPath: string | undefined,
): { entry: ArchiveEntry; relPath: string }[] {
  const results: { entry: ArchiveEntry; relPath: string }[] = [];
  const prefix = folderPath ? `${folderPath.replace(/\/$/, '')}/` : '';
  for (const entry of archive.entries) {
    if (entry.isRendered) continue; // synthetic previews — not on-disk content
    if (prefix && !entry.path.startsWith(prefix)) continue;
    const relPath = prefix ? entry.path.slice(prefix.length) : entry.path;
    if (!relPath) continue;
    results.push({ entry, relPath });
  }
  return results;
}

/**
 * Dialog that exports an archive (or a subfolder within it) via one of
 * three strategies. Chosen deliberately so the user can hand off content
 * to another tool without a manual "download each file" ritual.
 *
 *   • Download as ZIP        — one-to-one archive of the selection.
 *   • Concatenate by type    — group entries by extension, one glued file
 *                              per type, all bundled in a small ZIP.
 *   • Concatenate all        — single Markdown document with each entry
 *                              as a section (non-MD content gets fenced).
 *
 * The concatenation modes intentionally include a small header per entry
 * so a downstream reader can still tell which piece came from which file.
 */
export function ArchiveExportDialog({ open, onClose, archive, folderPath }: Props) {
  const [mode, setMode] = useState<Mode>('zip');
  const [busy, setBusy] = useState(false);

  const items = useMemo(
    () => selectEntries(archive, folderPath),
    [archive, folderPath],
  );
  const targetLabel = folderPath ? folderPath.replace(/\/$/, '') : archive.name;
  const baseName = safeName(
    folderPath
      ? folderPath.replace(/\/$/, '').split('/').pop() ?? archive.name
      : archive.name.replace(/\.[^.]+$/, ''),
  );

  const textCount = items.filter((it) => !it.entry.isBinary).length;
  const binaryCount = items.length - textCount;

  const canConcat = textCount > 0;
  const effectiveMode: Mode = mode !== 'zip' && !canConcat ? 'zip' : mode;

  const runExport = async () => {
    if (items.length === 0) {
      toast.info('Nothing to export in that selection.');
      return;
    }
    setBusy(true);
    try {
      if (effectiveMode === 'zip') {
        // Straight repack: preserves binary content (images, fonts) too.
        const zip = new JSZip();
        for (const { entry, relPath } of items) {
          if (entry.content != null) {
            zip.file(relPath, entry.content);
          } else {
            // Binary entries whose bytes we never loaded — skip with a note.
            // Currently our unpacker only preserves text + inline images, so
            // this branch only fires for large binaries we discarded.
            zip.file(`${relPath}.SKIPPED.txt`, `Binary content not available in-browser.`);
          }
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(blob, `${baseName}.zip`);
        toast.success(`Exported ${items.length} entries to ${baseName}.zip`);
      } else if (effectiveMode === 'concat-by-type') {
        // Group by extension, glue each group into one file, zip the results.
        const groups = new Map<string, { relPath: string; content: string }[]>();
        for (const { entry, relPath } of items) {
          if (entry.isBinary || entry.content == null) continue;
          const ext = (relPath.split('.').pop() ?? 'txt').toLowerCase();
          const bucket = groups.get(ext) ?? [];
          bucket.push({ relPath, content: entry.content });
          groups.set(ext, bucket);
        }
        if (groups.size === 0) {
          toast.info('No text entries to concatenate.');
          return;
        }
        const zip = new JSZip();
        for (const [ext, bucket] of groups) {
          const glued = bucket
            .map((b) => sectionHeader(ext, b.relPath) + b.content.replace(/\s+$/, ''))
            .join(sectionSeparator(ext));
          zip.file(`all-${ext}.${ext}`, glued);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(blob, `${baseName}-by-type.zip`);
        toast.success(`Exported ${groups.size} concatenated files (by type)`);
      } else {
        // Single Markdown document with each entry as a fenced section.
        const parts: string[] = [`# ${targetLabel}`, ''];
        for (const { entry, relPath } of items) {
          if (entry.isBinary || entry.content == null) continue;
          parts.push(`## ${relPath}`, '');
          const ext = (relPath.split('.').pop() ?? '').toLowerCase();
          if (ext === 'md' || ext === 'markdown') {
            parts.push(entry.content.trim(), '');
          } else {
            const fenceLang = ext || '';
            parts.push('```' + fenceLang, entry.content.replace(/\s+$/, ''), '```', '');
          }
        }
        const blob = new Blob([parts.join('\n')], { type: 'text/markdown' });
        downloadBlob(blob, `${baseName}.md`);
        toast.success(`Exported ${textCount} entries as ${baseName}.md`);
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Export "${targetLabel}"`}>
      <div className="space-y-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {items.length} entries in scope
          {textCount > 0 && ` — ${textCount} text`}
          {binaryCount > 0 && `, ${binaryCount} binary`}
          {folderPath ? ` (folder: ${folderPath})` : ''}
        </p>

        <div className="space-y-2">
          <ModeOption
            id="zip"
            current={effectiveMode}
            onSelect={setMode}
            icon={<Package size={16} />}
            title="Download as ZIP"
            desc="Repack the selection as-is. Preserves the folder structure."
          />
          <ModeOption
            id="concat-by-type"
            current={effectiveMode}
            onSelect={setMode}
            disabled={!canConcat}
            icon={<Files size={16} />}
            title="Concatenate by type"
            desc="Group entries by extension (.md → all-md.md, .tex → all-tex.tex, …) and ship the bundle as a ZIP."
          />
          <ModeOption
            id="concat-all"
            current={effectiveMode}
            onSelect={setMode}
            disabled={!canConcat}
            icon={<FileText size={16} />}
            title="Concatenate everything into one Markdown"
            desc="Single .md file with each entry as a section. Non-Markdown content is wrapped in fenced code blocks."
          />
        </div>

        {binaryCount > 0 && effectiveMode !== 'zip' && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {binaryCount} binary entries will be skipped in this mode.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={runExport} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FolderArchive size={14} />}
            Export
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ModeOption({
  id,
  current,
  onSelect,
  disabled,
  icon,
  title,
  desc,
}: {
  id: Mode;
  current: Mode;
  onSelect: (m: Mode) => void;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  const isSelected = current === id;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(id)}
      className={
        'w-full text-left rounded-lg border p-3 flex items-start gap-3 transition-colors ' +
        (disabled
          ? 'opacity-50 cursor-not-allowed border-slate-200 dark:border-slate-700'
          : isSelected
            ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600')
      }
    >
      <span className="mt-0.5 text-brand-500">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">{desc}</span>
      </span>
    </button>
  );
}

/** Per-entry header inserted into the "concatenate by type" output. Uses a
 *  language-appropriate comment so the resulting file is still valid. */
function sectionHeader(ext: string, relPath: string): string {
  switch (ext) {
    case 'md':
    case 'markdown':
      return `\n\n<!-- ═══ ${relPath} ═══ -->\n\n`;
    case 'html':
    case 'htm':
    case 'xml':
      return `\n\n<!-- ═══ ${relPath} ═══ -->\n\n`;
    case 'json':
      return ''; // JSON can't take comments; header goes into the separator label
    case 'tex':
    case 'latex':
      return `\n\n% ═══ ${relPath} ═══\n\n`;
    default:
      return `\n\n# ═══ ${relPath} ═══\n\n`;
  }
}

/** Separator between sections, matching sectionHeader semantics. */
function sectionSeparator(ext: string): string {
  if (ext === 'json') {
    // Turn the whole thing into a JSON array of {path, content} pairs
    // when we detect JSON — signalled by returning a special separator
    // handled by the caller. For simplicity we just newline-separate here;
    // the header is empty for JSON so the output is a stream of JSON docs
    // (NDJSON-like), which most tools accept.
    return '\n';
  }
  return '\n';
}
