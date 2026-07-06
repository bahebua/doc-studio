/**
 * Wraps a piece of rendered HTML into a full standalone HTML document,
 * optionally embedding a print-friendly stylesheet.
 */

const EMBEDDED_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif;
    line-height: 1.65;
    color: #0f172a;
    background: #ffffff;
    max-width: 860px;
    margin: 40px auto;
    padding: 0 24px;
  }
  h1,h2,h3,h4,h5,h6 { font-weight: 600; line-height: 1.25; margin-top: 2em; }
  h1 { font-size: 2.1rem; margin-top: 0; }
  h2 { font-size: 1.6rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
  h3 { font-size: 1.3rem; }
  p, ul, ol, blockquote, table { margin: 1em 0; }
  a { color: #2a48d6; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    background: #f1f5f9; padding: 0.15em 0.4em; border-radius: 4px;
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
  }
  pre {
    background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 10px;
    overflow: auto; font-size: 0.9em;
  }
  pre code { background: transparent; color: inherit; padding: 0; }
  blockquote {
    margin: 1.2em 0; padding: 0.4em 1em;
    border-left: 4px solid #3b60f5; background: #f8fafc; color: #334155;
    border-radius: 6px;
  }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
  th { background: #f1f5f9; }
  img { max-width: 100%; border-radius: 8px; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 2em 0; }
  ul.contains-task-list { list-style: none; padding-left: 0; }
  ul.contains-task-list li { display: flex; align-items: flex-start; gap: 8px; }
  /* Mermaid diagrams: keep the rendered SVG centred and scale-safe when the
     exported HTML is viewed in a narrow window / printed page. */
  figure.mermaid-block { margin: 1.5em 0; text-align: center; }
  figure.mermaid-block .mermaid-svg {
    display: inline-block; padding: 12px; border: 1px solid #e2e8f0;
    border-radius: 8px; background: #ffffff; max-width: 100%; overflow: auto;
  }
  figure.mermaid-block .mermaid-svg svg { max-width: 100%; height: auto; }
`;

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function buildStandaloneHtml(
  bodyHtml: string,
  title: string,
  options: { embedCss?: boolean } = {},
): string {
  const embedCss = options.embedCss ?? true;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="generator" content="Doc Studio" />
<title>${escape(title)}</title>
${embedCss ? `<style>${EMBEDDED_CSS}</style>` : ''}
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * Grabs the rendered preview DOM and returns just its innerHTML — this is what
 * "clean HTML" export uses (no wrapper, no CSS).
 */
export function extractPreviewHtml(previewEl: HTMLElement | null): string {
  if (!previewEl) return '';
  const clone = previewEl.cloneNode(true) as HTMLElement;
  // strip any UI-only helpers
  clone.querySelectorAll('[data-ui-only]').forEach((n) => n.remove());
  return clone.innerHTML.trim();
}
