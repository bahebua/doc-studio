import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/hooks/useTheme';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { Header } from '@/components/Layout/Header';
import { Sidebar } from '@/components/Layout/Sidebar';
import { StatusBar } from '@/components/Layout/StatusBar';
import { CodeEditor } from '@/components/Editor/CodeEditor';
import { EditorTabs } from '@/components/Editor/EditorTabs';
import { MarkdownPreview } from '@/components/Preview/MarkdownPreview';
import { HtmlPreview } from '@/components/Preview/HtmlPreview';
import { SourcePreview } from '@/components/Preview/SourcePreview';
import {
  CurlRequestPreview,
  looksLikeCurlEnvelope,
} from '@/components/Preview/CurlRequestPreview';
import { ToastHost, toast } from '@/components/ui/Toast';
import { docxToMarkdown } from '@/lib/converters/docxToMd';
import { htmlToMarkdown } from '@/lib/converters/htmlToMd';
import { extractXfaXml } from '@/lib/pdfXfaExtract';
import type { Language } from '@/types';

function useDebounced<T>(value: T, delay = 180): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface LoadedFile {
  content: string;
  language: Language;
}

async function fileToDoc(file: File): Promise<LoadedFile> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'docx') return { content: await docxToMarkdown(file), language: 'markdown' };
  if (ext === 'pdf') {
    // Editable / dynamic PDFs (XFA / LiveCycle) carry an `<xdp:xdp>` XML
    // wrapper. Surface it directly as an XML tab — mirrors what the
    // `extractXmlXdpFromDynamicPdf` server endpoint returns, but with
    // zero network round-trip. Static PDFs fall through to a plain
    // "binary — download to view" message so users aren't stuck.
    const buf = await file.arrayBuffer();
    const xfa = await extractXfaXml(new Uint8Array(buf));
    if (xfa) return { content: xfa.xml, language: 'xml' };
    return {
      content:
        `# ${file.name}\n\n` +
        `_This PDF has no XFA (dynamic-form) content, so there's no XML ` +
        `to extract. Static PDFs can be viewed by opening them in a new ` +
        `tab from the collection sidebar._\n`,
      language: 'markdown',
    };
  }
  if (ext === 'xdp' || ext === 'xfd' || ext === 'xfdf' || ext === 'fdf') {
    // Standalone XFA payloads — plain XML wearing a form-specific
    // extension. Load straight into the XML editor.
    return { content: await file.text(), language: 'xml' };
  }
  const text = await file.text();
  if (ext === 'html' || ext === 'htm') return { content: await htmlToMarkdown(text), language: 'markdown' };
  if (ext === 'json') return { content: text, language: 'json' };
  if (ext === 'xml') return { content: text, language: 'xml' };
  return { content: text, language: 'markdown' };
}

export default function App() {
  useTheme();
  useKeyboardShortcuts();

  const hydrate = useAppStore((s) => s.hydrate);
  const isHydrated = useAppStore((s) => s.isHydrated);
  const viewMode = useAppStore((s) => s.viewMode);
  const previewMode = useAppStore((s) => s.previewMode);
  const zenMode = useAppStore((s) => s.zenMode);
  const content = useAppStore((s) => s.document.content);
  const language = useAppStore((s) => s.document.language ?? 'markdown');
  const openFile = useAppStore((s) => s.openFile);
  const setTitle = useAppStore((s) => s.setTitle);

  const debouncedContent = useDebounced(content, 160);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Update the document.title to reflect the current file
  const docTitle = useAppStore((s) => s.document.title);
  useEffect(() => {
    document.title = docTitle ? `${docTitle} — Doc Studio` : 'Doc Studio';
  }, [docTitle]);

  // Warn on tab close / refresh when any open document has unsaved edits.
  // "Dirty" is defined the same way the sidebar dot uses it:
  //   `original` is set AND differs from `content`.
  // Blank scratch tabs (original === undefined) are ignored so opening a
  // fresh tab and immediately closing the window doesn't nag.
  //
  // Modern browsers ignore the returnValue string and show their own
  // generic prompt — we still set it to empty for legacy Firefox / Safari.
  const openFiles = useAppStore((s) => s.workspace.files);
  const hasUnsaved = useMemo(
    () =>
      openFiles.some(
        (f) => typeof f.original === 'string' && f.original !== f.content,
      ),
    [openFiles],
  );
  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome/Edge require returnValue to be set explicitly.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);

  const handleDropFiles = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    try {
      toast.info(`Reading ${file.name}…`);
      const { content, language } = await fileToDoc(file);
      const title = file.name.replace(/\.[^.]+$/, '');
      openFile(content, language, title);
      // openFile already sets a default title from the argument; setTitle here
      // is a no-op safety net in case a future callsite passes no title.
      setTitle(title);
      toast.success(`Loaded ${file.name}`);
    } catch (err) {
      console.error(err);
      toast.error(`Could not load ${file.name}`);
    }
  };

  const showEditor = viewMode !== 'preview';
  const showPreview = viewMode !== 'editor';

  const previewContent = useMemo(() => {
    // Route by language. Markdown renders as prose; HTML renders as HTML;
    // JSON/XML are data protocols so we just show them pretty-printed.
    if (language === 'html') {
      return (
        <div className="px-4 sm:px-8 py-6 sm:py-10 max-w-4xl mx-auto">
          <HtmlPreview html={debouncedContent} />
        </div>
      );
    }
    if (language === 'json' || language === 'xml') {
      // Special-case: a saved cURL request envelope renders as a
      // Postman-ish card with a Run button. Falls back to plain source
      // pretty-print when the JSON isn't a recognised envelope.
      if (language === 'json' && looksLikeCurlEnvelope(debouncedContent)) {
        return (
          <div className="min-h-full">
            <CurlRequestPreview json={debouncedContent} />
          </div>
        );
      }
      return (
        <div className="px-4 sm:px-8 py-6 sm:py-10 max-w-4xl mx-auto">
          <SourcePreview text={debouncedContent} language={language} />
        </div>
      );
    }
    return previewMode === 'pdf' ? (
      <div className="min-h-full py-6 sm:py-10 flex justify-center">
        <MarkdownPreview markdown={debouncedContent} paper />
      </div>
    ) : (
      <div className="px-4 sm:px-8 py-6 sm:py-10 max-w-4xl mx-auto">
        <MarkdownPreview markdown={debouncedContent} />
      </div>
    );
  }, [debouncedContent, previewMode, language]);

  if (!isHydrated) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm text-slate-500">
        Loading Doc Studio…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {!zenMode && <Header onOpenSidebar={() => setSidebarOpen(true)} />}
      <div className="flex-1 flex overflow-hidden">
        {!zenMode && <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />}

        <main className="flex-1 flex overflow-hidden bg-surface-soft dark:bg-night">
          <AnimatePresence initial={false}>
            {showEditor && (
              <motion.section
                key="editor"
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={clsx(
                  'flex-1 min-w-0 border-r border-slate-200 dark:border-slate-800',
                  'bg-white dark:bg-night-soft',
                  showPreview ? 'md:basis-1/2' : 'basis-full',
                )}
              >
                <div className="h-full flex flex-col overflow-hidden">
                  <EditorTabs />
                  <div className="flex-1 overflow-hidden">
                    <CodeEditor onDropFiles={handleDropFiles} />
                  </div>
                </div>
              </motion.section>
            )}
            {showPreview && (
              <motion.section
                key="preview"
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={clsx(
                  'flex-1 min-w-0',
                  showEditor ? 'md:basis-1/2 hidden md:flex' : 'basis-full flex',
                  'flex-col',
                )}
                data-preview-root
              >
                <div className="h-full overflow-auto">{previewContent}</div>
              </motion.section>
            )}
          </AnimatePresence>
        </main>
      </div>
      {!zenMode && <StatusBar />}
      <ToastHost />

      {/* Always-mounted hidden preview so PDF / HTML export works even when
          the user is in Editor Only mode. Only makes sense for Markdown —
          PDF/HTML export from JSON/XML sources isn't defined. Positioned far
          offscreen. */}
      {language === 'markdown' && (
        <div
          aria-hidden
          data-export-preview
          style={{
            position: 'fixed',
            left: '-99999px',
            top: 0,
            width: '860px',
            pointerEvents: 'none',
            opacity: 0,
          }}
        >
          <MarkdownPreview markdown={debouncedContent} />
        </div>
      )}
    </div>
  );
}
