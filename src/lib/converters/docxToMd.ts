import { htmlToMarkdown } from './htmlToMd';
// `?url` tells Vite: "give me the built asset URL, don't try to transform it
// as a module". Mammoth ships a UMD build (`mammoth.browser.min.js`) that
// assigns `window.mammoth` when loaded via a `<script>` tag. Trying to
// `import()` the UMD directly leaves Vite / esbuild fighting over module
// interop and either loses the namespace shape or drops APIs.
//
// So: we grab the URL of the UMD, inject it as a `<script>` once, and then
// pull the global off `window`. This is the "just works" pattern for
// browser-only UMD libraries in a modern bundler.
import mammothScriptUrl from 'mammoth/mammoth.browser.min.js?url';

interface MammothLike {
  convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: { styleMap?: string[] },
  ): Promise<{ value: string; messages: unknown[] }>;
}

let mammothPromise: Promise<MammothLike> | null = null;

function loadMammoth(): Promise<MammothLike> {
  if (mammothPromise) return mammothPromise;
  const w = window as unknown as { mammoth?: MammothLike };
  if (w.mammoth) return Promise.resolve(w.mammoth);

  mammothPromise = new Promise<MammothLike>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = mammothScriptUrl;
    script.async = true;
    script.onload = () => {
      if (w.mammoth) resolve(w.mammoth);
      else reject(new Error('mammoth script loaded but window.mammoth is missing'));
    };
    script.onerror = () =>
      reject(new Error(`Failed to load mammoth from ${mammothScriptUrl}`));
    document.head.appendChild(script);
  });
  return mammothPromise;
}

/**
 * DOCX → Markdown: Mammoth converts .docx into HTML, then Turndown converts
 * that HTML into GitHub-flavored Markdown.
 */
export async function docxToMarkdown(file: File | ArrayBuffer): Promise<string> {
  const mammoth = await loadMammoth();
  const arrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();

  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Code'] => pre:fresh",
      ],
    },
  );
  return htmlToMarkdown(result.value);
}
