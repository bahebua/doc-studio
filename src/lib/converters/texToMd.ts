/*
 * LaTeX (.tex) → Markdown preview.
 *
 * A pragmatic, regex-based converter aimed at the LaTeX documents users
 * actually write in this app: reports, résumés, letters. It does NOT
 * attempt to be a real LaTeX engine — that would need TeX Live in a Web
 * Worker. Instead it strips the preamble, maps sectioning + common inline
 * commands + list environments to their Markdown equivalents, and leaves
 * math ($…$ / \[…\]) untouched so KaTeX-aware Markdown renderers can pick
 * it up (or the source stays readable as-is).
 *
 * The point is not fidelity but "give the user a preview of what they
 * wrote without needing a LaTeX toolchain".
 */

/**
 * Strip full-line LaTeX comments (a `%` not preceded by a backslash to
 * the end of line). Preserves `\%` literal percent signs, and preserves
 * `%` inside verbatim-like blocks (rough — verbatim isn't tracked
 * precisely, but for previews this is fine).
 */
function stripComments(src: string): string {
  return src.replace(/(^|[^\\])%[^\n]*/g, '$1');
}

/** Extract the `\title{...}` and `\author{...}` values if present. */
function extractMeta(src: string): { title?: string; author?: string; date?: string } {
  const grab = (cmd: string): string | undefined => {
    const m = src.match(new RegExp(`\\\\${cmd}\\{([^}]*)\\}`));
    return m?.[1]?.trim() || undefined;
  };
  return { title: grab('title'), author: grab('author'), date: grab('date') };
}

/** Return only the body (between `\begin{document}` and `\end{document}`).
 *  Documents without those delimiters (fragments, includes) pass through. */
function extractBody(src: string): string {
  const start = src.indexOf('\\begin{document}');
  const end = src.indexOf('\\end{document}');
  if (start === -1) return src;
  const from = start + '\\begin{document}'.length;
  const to = end === -1 ? src.length : end;
  return src.slice(from, to);
}

/**
 * Map LaTeX list environments (`itemize`, `enumerate`, `description`) to
 * Markdown list syntax. Handles nested lists by rerunning until stable.
 */
function transformLists(src: string): string {
  let out = src;
  const iterate = (env: string, bullet: (i: number) => string) => {
    const re = new RegExp(
      `\\\\begin\\{${env}\\}([\\s\\S]*?)\\\\end\\{${env}\\}`,
      'g',
    );
    for (let guard = 0; guard < 10; guard++) {
      const before = out;
      out = out.replace(re, (_full, inner: string) => {
        const items = inner
          .split(/\\item\b/)
          .slice(1)
          .map((it: string, i: number) => `${bullet(i)} ${it.trim().replace(/\n+/g, ' ')}`);
        return `\n\n${items.join('\n')}\n\n`;
      });
      if (out === before) break;
    }
  };
  iterate('itemize', () => '-');
  iterate('enumerate', (i) => `${i + 1}.`);
  iterate('description', () => '-');
  return out;
}

/**
 * Turn the `$|$` idiom (a math-mode pipe used purely as a visual
 * separator in résumé header contact lines) into a literal pipe so it
 * renders as a plain `|` glyph instead of the italic KaTeX math-pipe.
 * Kept narrow on purpose — anything else that looks like math is left
 * alone so KaTeX still gets a chance at real formulas.
 */
function normalisePipeSeparator(src: string): string {
  return src.replace(/\$\s*\|\s*\$/g, '|');
}

/**
 * Remove the common leading indentation from every line of a LaTeX
 * environment body. CommonMark treats any line indented ≥4 spaces as a
 * code block — and LaTeX source is almost always indented for
 * readability — so without this the entire environment renders as a
 * dark `<pre>` code block. Also trims trailing blank lines that the
 * outer regex leaves behind.
 *
 * Earlier `transformCommands` passes (e.g. `\\[0.45em]` →
 * `<div class="tex-vspacer">…</div>`) inject zero-indent HTML block
 * lines *inside* the environment body. Those would poison the
 * min-indent calculation and make this function a no-op, so we
 * deliberately skip pure-HTML-block lines when computing the common
 * indent — they carry no LaTeX-source indentation to respect anyway.
 */
function dedentEnvBody(body: string): string {
  const lines = body.replace(/^\n+/, '').replace(/\s+$/, '').split('\n');
  let minIndent = Infinity;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip injected HTML block openers/closers so they don't drag the
    // common indent down to zero.
    if (/^<\/?[a-zA-Z][^>]*>/.test(trimmed)) continue;
    const m = line.match(/^[ \t]*/);
    const indent = m ? m[0].length : 0;
    if (indent < minIndent) minIndent = indent;
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) return lines.join('\n');
  return lines
    .map((l) => (l.length >= minIndent && l.slice(0, minIndent).trim() === '' ? l.slice(minIndent) : l))
    .join('\n');
}

/** Sectioning + common inline commands. */
function transformCommands(src: string): string {
  return (
    src
      // Headings — depth-mapped so structure survives the round trip.
      .replace(/\\chapter\*?\{([^}]*)\}/g, '\n\n# $1\n\n')
      .replace(/\\section\*?\{([^}]*)\}/g, '\n\n## $1\n\n')
      .replace(/\\subsection\*?\{([^}]*)\}/g, '\n\n### $1\n\n')
      .replace(/\\subsubsection\*?\{([^}]*)\}/g, '\n\n#### $1\n\n')
      .replace(/\\paragraph\*?\{([^}]*)\}/g, '\n\n**$1** ')
      // Inline text formatting.
      .replace(/\\textbf\{([^}]*)\}/g, '**$1**')
      .replace(/\\textit\{([^}]*)\}/g, '*$1*')
      .replace(/\\emph\{([^}]*)\}/g, '*$1*')
      .replace(/\\underline\{([^}]*)\}/g, '<u>$1</u>')
      .replace(/\\texttt\{([^}]*)\}/g, '`$1`')
      // Links & references. URL-encode the target so CommonMark's
      // `[text](url)` parser doesn't choke on spaces (e.g. `\href{tel:+91
      // 8552981278}{…}` → `[…](tel:+91%208552981278)`). Without this
      // the entire link renders as raw markdown source in the preview.
      .replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, (_m, url, text) => {
        let encoded: string;
        try {
          encoded = encodeURI(url);
        } catch {
          encoded = url;
        }
        return `[${text}](${encoded})`;
      })
      .replace(/\\url\{([^}]*)\}/g, (_m, url) => {
        let encoded: string;
        try {
          encoded = encodeURI(url);
        } catch {
          encoded = url;
        }
        return `<${encoded}>`;
      })
      // Environments we can render inline.
      .replace(
        /\\begin\{quote\}([\s\S]*?)\\end\{quote\}/g,
        (_m, inner) =>
          '\n\n' +
          inner
            .trim()
            .split(/\n+/)
            .map((l: string) => `> ${l}`)
            .join('\n') +
          '\n\n',
      )
      .replace(
        /\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/g,
        (_m, inner) => `\n\n\`\`\`\n${inner.trim()}\n\`\`\`\n\n`,
      )
      // Font-size + weight declarations. LaTeX uses these as scoped
      // "switches" (e.g. `{\Huge \textbf{Title}}`) — Markdown has no
      // equivalent, so we simply drop the command and let the enclosing
      // group become plain text. Doing this before the brace-cleanup pass
      // below turns `{\Huge \textbf{X}}` into `{ **X**}` → then `**X**`.
      .replace(
        /\\(Huge|huge|LARGE|Large|large|normalsize|small|footnotesize|scriptsize|tiny|bfseries|itshape|slshape|scshape|sffamily|ttfamily|rmfamily|upshape|mdseries)\b\s*/g,
        '',
      )
      // Colour declarations — drop the command, keep the text.
      .replace(/\\color\{[^}]*\}\s*/g, '')
      .replace(/\\textcolor\{[^}]*\}\{([^}]*)\}/g, '$1')
      // Escaped specials → literal characters.
      .replace(/\\&/g, '&')
      .replace(/\\%/g, '%')
      .replace(/\\\$/g, '$')
      .replace(/\\#/g, '#')
      .replace(/\\_/g, '_')
      .replace(/\\\{/g, '{')
      .replace(/\\\}/g, '}')
      // Line-break controls. `\\[0.45em]` (used heavily in résumés
      // and title blocks) becomes a hard break followed by a small
      // block-level spacer. Using a `<div>` rather than a `<span>`
      // avoids the "visible <span> tag" bug we hit when rehype-raw
      // didn't get to parse inline HTML — divs survive Markdown block
      // parsing more reliably.
      .replace(
        /\\\\\s*\[\s*(-?[0-9.]+)\s*(pt|em|ex|mm|cm|in|px)?\s*\]/g,
        (_m, num, unit) => {
          const u = unit || 'em';
          return `\n\n<div class="tex-vspacer" style="height:${num}${u}" aria-hidden="true"></div>\n\n`;
        },
      )
      .replace(/\\\\/g, '  \n')
      .replace(/\\newline\b/g, '  \n')
      .replace(/\\par\b/g, '\n\n')
      .replace(/\\bigskip\b/g, '\n\n<div class="tex-vspacer" style="height:12pt" aria-hidden="true"></div>\n\n')
      .replace(/\\medskip\b/g, '\n\n<div class="tex-vspacer" style="height:6pt" aria-hidden="true"></div>\n\n')
      .replace(/\\smallskip\b/g, '\n\n<div class="tex-vspacer" style="height:3pt" aria-hidden="true"></div>\n\n')
      // `\vspace{Xem}` — preserve the amount, including negative values
      // (`\vspace{-0.5em}` is a common trick to tighten sections).
      .replace(
        /\\vspace\*?\{\s*(-?[0-9.]+)\s*(pt|em|ex|mm|cm|in|px)?\s*\}/g,
        (_m, num, unit) => {
          const u = unit || 'em';
          return `\n\n<div class="tex-vspacer" style="margin-top:${num}${u}" aria-hidden="true"></div>\n\n`;
        },
      )
      .replace(/\\vspace\*?\{[^}]*\}/g, '\n\n')
      .replace(/\\hspace\*?\{[^}]*\}/g, ' ')
      // Common structural / no-op commands.
      .replace(/\\maketitle\b/g, '')
      .replace(/\\tableofcontents\b/g, '')
      .replace(/\\newpage\b/g, '\n\n---\n\n')
      .replace(/\\clearpage\b/g, '\n\n---\n\n')
      .replace(/\\noindent\b/g, '')
      .replace(/\\centering\b/g, '')
      // Drop preamble-y commands that sometimes leak into the body of
      // hand-written LaTeX documents (résumés especially). Everything
      // here takes one or two braced arguments plus optional brackets.
      .replace(/\\pagestyle\{[^}]*\}/g, '')
      .replace(/\\thispagestyle\{[^}]*\}/g, '')
      .replace(/\\hypersetup\{[^}]*\}/g, '')
      .replace(/\\setlist\[[^\]]*\]\{[^}]*\}/g, '')
      .replace(/\\setlist\{[^}]*\}/g, '')
      .replace(/\\titleformat\{[^}]*\}(\{[^}]*\}){0,4}\s*(\[[^\]]*\])?/g, '')
      .replace(/\\titlespacing\*?\{[^}]*\}\{[^}]*\}\{[^}]*\}\{[^}]*\}/g, '')
      .replace(/\\titlerule\b/g, '')
      // Alignment environments — wrap in HTML so text actually aligns
      // in the preview. rehype-raw keeps the div; the blank lines let
      // react-markdown parse the inner content as Markdown.
      //
      // IMPORTANT: LaTeX source is almost always indented 2–4 spaces
      // inside `\begin{...}` blocks for readability. In CommonMark,
      // any line indented ≥4 spaces is a **code block** — which meant
      // the entire résumé header was rendering as a dark `<pre>` with
      // visible `[LinkedIn](https://…)` link source, quote-styled by
      // Tailwind Typography's `prose-pre` rules. `dedentEnvBody` strips
      // the common leading indent so the body renders as prose.
      .replace(
        /\\begin\{center\}([\s\S]*?)\\end\{center\}/g,
        (_m, inner) =>
          `\n\n<div class="tex-center">\n\n${dedentEnvBody(inner)}\n\n</div>\n\n`,
      )
      .replace(
        /\\begin\{flushleft\}([\s\S]*?)\\end\{flushleft\}/g,
        (_m, inner) =>
          `\n\n<div class="tex-flushleft">\n\n${dedentEnvBody(inner)}\n\n</div>\n\n`,
      )
      .replace(
        /\\begin\{flushright\}([\s\S]*?)\\end\{flushright\}/g,
        (_m, inner) =>
          `\n\n<div class="tex-flushright">\n\n${dedentEnvBody(inner)}\n\n</div>\n\n`,
      )
      .replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g, '\n\n> **Abstract**\n>\n> $1\n\n')
  );
}

/**
 * Convert a small subset of inline Markdown (bold / italic / inline code /
 * links) to HTML. Used by the `\hfill` pass, which wraps its two sides
 * in `<span>` elements — Markdown inline formatting is *not* re-parsed
 * inside inline HTML by react-markdown, so we have to promote it to
 * HTML ourselves before the wrap. Non-greedy patterns keep multiple
 * spans on the same line intact.
 */
function mdInlineToHtml(s: string): string {
  return s
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '<a href="$2">$1</a>');
}

/**
 * Post-command pass: for any line containing `\hfill`, split at each
 * occurrence and wrap the resulting fragments in a flex container so
 * the fragments push apart to opposite margins — matching LaTeX's
 * `\hfill` semantics (horizontal glue). Runs *after* transformCommands
 * so the fragments already contain converted Markdown (`**X**`, links,
 * etc.), then promotes those to HTML because they end up inside inline
 * `<span>` wrappers where Markdown is not re-parsed.
 */
function transformHfillLines(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      if (!line.includes('\\hfill')) return line;
      const parts = line.split(/\\hfill/).map((p) => mdInlineToHtml(p.trim()));
      const spans = parts.map((p) => `<span>${p}</span>`).join('');
      return `<div class="tex-hfill">${spans}</div>`;
    })
    .join('\n');
}

/**
 * After command substitution some scoped groups collapse to empty or
 * plain-text braces like `{ **PARTH PATIL**}`. Strip surviving brace
 * pairs that don't wrap a LaTeX command so they don't leak into the
 * rendered Markdown. Runs iteratively because groups can nest.
 */
function unwrapBraceGroups(src: string): string {
  let out = src;
  for (let i = 0; i < 5; i++) {
    const next = out.replace(/\{([^{}\\]*)\}/g, '$1');
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Collapse runs of >2 blank lines that the transforms tend to leave behind. */
function tidyWhitespace(src: string): string {
  return src.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Full pipeline. Returns a Markdown string ready to hand to the standard
 * preview renderer.
 */
export function texToMarkdown(source: string): string {
  const stripped = stripComments(source);
  const meta = extractMeta(stripped);
  const body = extractBody(stripped);

  let md = body;
  md = normalisePipeSeparator(md);
  md = transformLists(md);
  md = transformCommands(md);
  md = transformHfillLines(md);
  md = unwrapBraceGroups(md);
  md = tidyWhitespace(md);

  const header: string[] = [];
  if (meta.title) header.push(`# ${meta.title}`);
  if (meta.author || meta.date) {
    const parts = [meta.author, meta.date].filter(Boolean).join(' · ');
    header.push(`_${parts}_`);
  }
  return header.length > 0 ? `${header.join('\n\n')}\n\n${md}` : md;
}

/**
 * Heuristic: does this text look like a LaTeX document rather than
 * Markdown? True when either:
 *   1. The source declares itself with `\documentclass{...}` or opens
 *      a `\begin{document}` block (canonical full document), OR
 *   2. It contains enough structural TeX commands (`\section{}`,
 *      `\begin{env}`, `\usepackage{}`, `\chapter{}`, `\Huge{}`, …)
 *      that Markdown rendering would obviously mangle it.
 *
 * The looser branch lets pasted snippets and `.tex` files with just a
 * document body (no preamble) still opt into the LaTeX engine instead
 * of being rendered as plain Markdown or — worse — showing the browser's
 * XML parser error.
 */
export function looksLikeLatexDocument(source: string): boolean {
  if (/\\documentclass\b|\\begin\{document\}/.test(source)) return true;
  // Fallback sniff: any two distinct LaTeX-flavoured commands suggest
  // this isn't just a paragraph that happens to mention a backslash.
  const patterns = [
    /\\(?:chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{/,
    /\\begin\{[a-zA-Z*]+\}/,
    /\\end\{[a-zA-Z*]+\}/,
    /\\usepackage\b/,
    /\\(?:huge|Huge|LARGE|Large|large|small|footnotesize|scriptsize|tiny|normalsize)\b/,
    /\\(?:textbf|textit|texttt|emph|underline)\s*\{/,
    /\\(?:hspace|vspace|hfill|vfill|noindent|newline|newpage|clearpage)\b/,
    /\\item\b/,
  ];
  let hits = 0;
  for (const re of patterns) {
    if (re.test(source)) {
      hits++;
      if (hits >= 2) return true;
    }
  }
  return false;
}
