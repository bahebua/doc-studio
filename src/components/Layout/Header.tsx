import {
  Download,
  FilePlus2,
  Menu,
  Monitor,
  Moon,
  Redo2,
  Sun,
  Undo2,
  Upload,
  Link2,
  Terminal,
  Maximize2,
  Minimize2,
  Columns2,
  FileText,
  Eye,
  Wand2,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { ExportDialog } from '@/components/Dialogs/ExportDialog';
import { UrlImportDialog } from '@/components/Dialogs/UrlImportDialog';
import { CurlImportDialog } from '@/components/Dialogs/CurlImportDialog';
import { WorkspaceSwitcher } from '@/components/Layout/WorkspaceSwitcher';
import { toast } from '@/components/ui/Toast';
import { docxToMarkdown } from '@/lib/converters/docxToMd';
import { htmlToMarkdown } from '@/lib/converters/htmlToMd';
import { formatCodeBlocks, formatJson, formatXml } from '@/lib/formatters';
import { detectArchiveKind, unpackArchive } from '@/lib/archive';
import type { Language } from '@/types';
import clsx from 'clsx';

interface Props {
  onOpenSidebar: () => void;
}

interface LoadedFile {
  content: string;
  language: Language;
}

/**
 * Sentinel returned for container archives (docx / zip / …). These are
 * handled through the archive store action (registered + primary entry
 * opened) rather than the flat `openFile` path.
 */
const ARCHIVE_HANDLED = Symbol('archive-handled');
type ReadResult = LoadedFile | typeof ARCHIVE_HANDLED;

async function readFile(file: File, openArchive: (a: Awaited<ReturnType<typeof unpackArchive>>) => void): Promise<ReadResult> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  // Container archives — unpack and register with the store. The primary
  // entry gets opened as a tab automatically; the sidebar Archive panel
  // surfaces the rest.
  const kind = detectArchiveKind(file.name);
  if (kind) {
    const archive = await unpackArchive(file, file.name, kind);
    openArchive(archive);
    return ARCHIVE_HANDLED;
  }

  // Legacy: allow importing a .docx as flattened markdown when the user
  // explicitly opts out of the archive view (currently unreachable — the
  // detector above always matches — but kept so callers can still request
  // the mammoth path programmatically).
  if (ext === 'docx') return { content: await docxToMarkdown(file), language: 'markdown' };

  const text = await file.text();
  if (ext === 'html' || ext === 'htm') return { content: await htmlToMarkdown(text), language: 'markdown' };
  if (ext === 'json') return { content: text, language: 'json' };
  if (ext === 'xml') return { content: text, language: 'xml' };
  return { content: text, language: 'markdown' }; // .md / .markdown / .txt / anything
}

export function Header({ onOpenSidebar }: Props) {
  const document = useAppStore((s) => s.document);
  const setTitle = useAppStore((s) => s.setTitle);
  const openFile = useAppStore((s) => s.openFile);
  const openArchive = useAppStore((s) => s.openArchive);
  const newFile = useAppStore((s) => s.newFile);
  const setContent = useAppStore((s) => s.setContent);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const canUndo = useAppStore((s) => s.past.length > 0);
  const canRedo = useAppStore((s) => s.future.length > 0);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const zenMode = useAppStore((s) => s.zenMode);
  const toggleZen = useAppStore((s) => s.toggleZen);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [urlImportOpen, setUrlImportOpen] = useState(false);
  const [curlImportOpen, setCurlImportOpen] = useState(false);

  const handleImport = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    try {
      toast.info(`Importing ${file.name}…`);
      const result = await readFile(file, openArchive);
      if (result === ARCHIVE_HANDLED) {
        // Archive store already registered + opened the primary entry;
        // the sidebar Archive panel now shows the remaining parts.
        toast.success(`Opened ${file.name} — browse its parts in the sidebar`);
        return;
      }
      const nameNoExt = file.name.replace(/\.[^.]+$/, '');
      openFile(result.content, result.language, nameNoExt || 'Imported document');
      setTitle(nameNoExt || 'Imported document');
      toast.success('Import complete');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Could not import ${file.name}: ${msg}`);
    }
  };

  /**
   * Language-aware "Format" action:
   *   - markdown: pretty-print every ```json / ```xml fenced block in-place.
   *   - json:     prettify the whole document.
   *   - xml:      prettify the whole document.
   *   - html:     no-op (button is hidden by `canFormat` below).
   * Keeps a single button in the header instead of adding one per language,
   * which matches the user's mental model: "make this look right".
   */
  const handleFormat = () => {
    const lang = document.language ?? 'markdown';
    try {
      if (lang === 'json') {
        const pretty = formatJson(document.content);
        if (pretty !== document.content) setContent(pretty);
        toast.success('JSON formatted');
        return;
      }
      if (lang === 'xml') {
        const pretty = formatXml(document.content);
        if (pretty !== document.content) setContent(pretty);
        toast.success('XML formatted');
        return;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Format failed');
      return;
    }
    const result = formatCodeBlocks(document.content);
    if (result.formatted === 0 && result.skipped.length === 0) {
      toast.info('Nothing to format — no JSON or XML code blocks found.');
      return;
    }
    if (result.content !== document.content) {
      setContent(result.content);
    }
    if (result.formatted > 0 && result.skipped.length === 0) {
      toast.success(
        `Formatted ${result.formatted} code block${result.formatted === 1 ? '' : 's'}`,
      );
    } else if (result.formatted > 0) {
      toast.info(
        `Formatted ${result.formatted}, skipped ${result.skipped.length} (invalid)`,
      );
    } else {
      toast.error(`Could not format — ${result.skipped[0].error}`);
    }
  };

  // Which languages benefit from the Format button. Hiding it elsewhere
  // avoids the "click does nothing" trap for HTML docs.
  const canFormat = ['markdown', 'json', 'xml'].includes(
    document.language ?? 'markdown',
  );

  const formatTooltip =
    document.language === 'json'
      ? 'Format JSON'
      : document.language === 'xml'
        ? 'Format XML'
        : 'Format JSON / XML code blocks';

  const nextTheme = () => {
    const order = ['light', 'dark', 'system'] as const;
    const current = order.indexOf(theme);
    setTheme(order[(current + 1) % order.length]);
  };

  return (
    <header
      className={clsx(
        'no-print sticky top-0 z-30 flex items-center gap-2 px-3 sm:px-4 h-14',
        'glass border-b border-slate-200/60 dark:border-slate-700/60',
      )}
    >
      <Button
        size="icon"
        variant="ghost"
        onClick={onOpenSidebar}
        className="md:hidden"
        aria-label="Open menu"
      >
        <Menu size={18} />
      </Button>

      <div className="hidden md:flex items-center gap-2 pr-2 border-r border-slate-200 dark:border-slate-700">
        <div className="h-7 w-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-xs">
          M
        </div>
        <span className="font-semibold tracking-tight text-sm">
          Doc Studio
        </span>
      </div>

      <input
        value={document.title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Document title"
        className={clsx(
          'flex-1 min-w-0 h-9 px-2 rounded-md text-sm bg-transparent',
          'hover:bg-slate-100 focus:bg-white dark:hover:bg-slate-800 dark:focus:bg-slate-800',
          'outline-none border border-transparent focus:border-slate-200 dark:focus:border-slate-700',
          'truncate',
        )}
      />

      <div className="hidden sm:flex items-center gap-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
        {(
          [
            { m: 'editor', label: 'Editor', icon: <FileText size={14} /> },
            { m: 'split', label: 'Split', icon: <Columns2 size={14} /> },
            { m: 'preview', label: 'Preview', icon: <Eye size={14} /> },
          ] as const
        ).map(({ m, label, icon }) => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            className={clsx(
              'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors',
              viewMode === m
                ? 'bg-white dark:bg-night text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white',
            )}
            aria-pressed={viewMode === m}
          >
            {icon}
            <span className="hidden md:inline">{label}</span>
          </button>
        ))}
      </div>

      <Tooltip label="Undo (Ctrl+Z)">
        <Button size="icon" onClick={undo} disabled={!canUndo} aria-label="Undo">
          <Undo2 size={16} />
        </Button>
      </Tooltip>
      <Tooltip label="Redo (Ctrl+Shift+Z)">
        <Button size="icon" onClick={redo} disabled={!canRedo} aria-label="Redo">
          <Redo2 size={16} />
        </Button>
      </Tooltip>

      <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />

      <Tooltip label="New document">
        <Button size="icon" onClick={() => newFile()} aria-label="New document">
          <FilePlus2 size={16} />
        </Button>
      </Tooltip>
      <Tooltip label="Import file">
        <Button
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Import"
        >
          <Upload size={16} />
        </Button>
      </Tooltip>
      <Tooltip label="Import from URL">
        <Button
          size="icon"
          onClick={() => setUrlImportOpen(true)}
          aria-label="Import from URL"
          className="hidden sm:inline-flex"
        >
          <Link2 size={16} />
        </Button>
      </Tooltip>
      <Tooltip label="Import from cURL command">
        <Button
          size="icon"
          onClick={() => setCurlImportOpen(true)}
          aria-label="Import from cURL"
          className="hidden sm:inline-flex"
        >
          <Terminal size={16} />
        </Button>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".md,.markdown,.txt,.html,.htm,.docx,.xlsx,.pptx,.epub,.zip,.json,.xml,.tex,.latex"
        onChange={(e) => {
          void handleImport(e.target.files);
          e.currentTarget.value = '';
        }}
      />

      {canFormat && (
        <Tooltip label={formatTooltip}>
          <Button
            size="icon"
            onClick={handleFormat}
            aria-label="Format document"
            className="hidden sm:inline-flex"
          >
            <Wand2 size={16} />
          </Button>
        </Tooltip>
      )}

      <Button
        variant="primary"
        size="sm"
        onClick={() => setExportOpen(true)}
        className="hidden sm:inline-flex"
      >
        <Download size={14} /> Export
      </Button>
      <Button
        variant="primary"
        size="icon"
        onClick={() => setExportOpen(true)}
        className="sm:hidden"
        aria-label="Export"
      >
        <Download size={16} />
      </Button>

      <Tooltip label={`Theme: ${theme}`}>
        <Button size="icon" onClick={nextTheme} aria-label="Toggle theme">
          {theme === 'light' && <Sun size={16} />}
          {theme === 'dark' && <Moon size={16} />}
          {theme === 'system' && <Monitor size={16} />}
        </Button>
      </Tooltip>

      <WorkspaceSwitcher />

      <Tooltip label={zenMode ? 'Exit zen mode (F11)' : 'Zen mode (F11)'}>
        <Button
          size="icon"
          onClick={toggleZen}
          aria-label="Zen mode"
          className="hidden sm:inline-flex"
        >
          {zenMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </Button>
      </Tooltip>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <UrlImportDialog open={urlImportOpen} onClose={() => setUrlImportOpen(false)} />
      <CurlImportDialog open={curlImportOpen} onClose={() => setCurlImportOpen(false)} />
    </header>
  );
}
