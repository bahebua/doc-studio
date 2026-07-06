/**
 * Prepare a hand-written LaTeX source for the `latex.js` engine.
 *
 * latex.js implements a fairly small subset of the LaTeX ecosystem —
 * roughly plain article/book classes plus a handful of common macros.
 * Real-world résumé / paper templates load packages it doesn't know
 * (`titlesec`, `enumitem`, `microtype`, full `hyperref` options, …)
 * and define layout commands (`\titleformat`, `\hypersetup`, …) whose
 * arguments its parser can't recognise. When that happens the parser
 * derails inside the preamble and reports a misleading
 * "expected \begin{document}".
 *
 * Rather than block the whole document on those unsupported commands
 * we surgically strip them out. The visible content survives; only
 * layout hints that latex.js can't honour anyway are discarded.
 *
 * Everything here is intentionally conservative:
 *   - We only touch a known allow-list of commands.
 *   - We only remove `\usepackage` lines for packages we know latex.js
 *     doesn't ship.
 *   - We NEVER modify anything inside `\begin{document}...\end{document}`.
 */

/**
 * Packages latex.js doesn't implement — safe to drop.
 *
 * `hyperref` is deliberately NOT here: latex.js ships hyperref support
 * out of the box (that's how `\href`, `\url`, `\autoref`, … are
 * defined). Stripping the `\usepackage{hyperref}` line leaves those
 * commands undefined and forces a parser failure on any document that
 * uses them.
 */
const UNSUPPORTED_PACKAGES = new Set([
  'titlesec',
  'enumitem',
  'microtype',
  'geometry',
  'xcolor',
  'setspace',
  'parskip',
  'fontspec',
  'fontenc',
  'inputenc',
  'lmodern',
  'helvet',
  'mathptmx',
  'palatino',
  'tgpagella',
  'tgtermes',
  'multicol',
  'fancyhdr',
  'ragged2e',
]);

/**
 * Commands that take N brace-groups (and optionally some square-bracket
 * option groups) and should be removed wholesale. Value = number of
 * mandatory `{...}` args to consume after the command.
 */
const COMMANDS_TO_STRIP: Record<string, number> = {
  hypersetup: 1,
  titleformat: 5, // \titleformat{sec}{format}{label}{sep}{before}[after]
  titlespacing: 4, // \titlespacing{sec}{left}{before}{after}
  titlespacingstar: 4,
  setlist: 1, // \setlist[itemize]{...} — the [..] is handled generically
  pagestyle: 1,
  thispagestyle: 1,
  pagenumbering: 1,
  fancyhead: 1,
  fancyfoot: 1,
  renewcommand: 2,
  newcommand: 2,
  providecommand: 2,
  DeclareRobustCommand: 2,
  RequirePackage: 1,
  PassOptionsToPackage: 2,
  definecolor: 3,
  arrayrulecolor: 1,
  rowcolors: 3,
};

/** Bare commands with no args to just delete. */
const BARE_COMMANDS_TO_STRIP = new Set([
  'titlerule',
  'nopagebreak',
  'pagebreak',
  'clearpage',
  'newpage',
  'cleardoublepage',
  'sloppy',
  'fussy',
  'raggedright',
  'raggedleft',
  'centering',
  // Note: `\hfill` is handled specially below (sentinel-replaced so
  // we can turn it into flexbox spacing after latex.js renders).
  'vfill',
  'hrulefill',
  'dotfill',
  'noindent',
  'linebreak',
]);

/**
 * Marker inserted in place of `\hfill` before handing source to
 * latex.js. Chosen from private-use Unicode so it can't collide with
 * anything a real document contains. `LatexPreview` walks the rendered
 * DOM after parsing and converts each marker into a flexbox layout
 * that pushes surrounding fragments to opposite margins — mimicking
 * TeX's horizontal-glue semantics.
 */
export const HFILL_SENTINEL = '\uE000HFILL\uE001';

/**
 * Skip past whitespace starting at `i` and return the new index.
 */
function skipWs(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

/**
 * Consume a balanced `{...}` group starting at index `i` (which must
 * point at the opening `{`). Returns the index immediately after the
 * matching `}`, or `-1` on failure.
 */
function skipBraceGroup(src: string, i: number): number {
  if (src[i] !== '{') return -1;
  let depth = 1;
  i++;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      // Skip escaped char (e.g. `\{`, `\}`).
      i += 2;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return depth === 0 ? i : -1;
}

/**
 * Consume a balanced `[...]` option group starting at `i` (must point
 * at `[`). Returns the index immediately after the matching `]`, or
 * `-1` on failure.
 */
function skipOptionGroup(src: string, i: number): number {
  if (src[i] !== '[') return -1;
  let depth = 1;
  i++;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      i += 2;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') depth--;
    i++;
  }
  return depth === 0 ? i : -1;
}

/**
 * Strip `\usepackage[opts]{pkgA,pkgB,…}` for any package in
 * `UNSUPPORTED_PACKAGES`. If ALL listed packages are unsupported we
 * remove the whole line; otherwise we rewrite the list to keep only
 * the supported ones.
 */
function stripUsepackage(src: string): string {
  return src.replace(
    /\\usepackage\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g,
    (_match, list: string) => {
      const kept = list
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !UNSUPPORTED_PACKAGES.has(s));
      if (kept.length === 0) return '';
      return `\\usepackage{${kept.join(',')}}`;
    },
  );
}

/**
 * Walk the source and remove every occurrence of the commands in
 * `COMMANDS_TO_STRIP` along with their brace-balanced arguments (and
 * any leading `[...]` option groups).
 */
function stripArgCommands(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] !== '\\') {
      out += src[i];
      i++;
      continue;
    }
    // Match a command name: letters only, LaTeX rules.
    const m = /^\\([a-zA-Z@]+)\*?/.exec(src.slice(i));
    if (!m) {
      // `\` followed by a non-letter (e.g. `\\`, `\{`) — pass through.
      out += src[i];
      i++;
      continue;
    }
    const name = m[1];
    const cmdLen = m[0].length;

    if (BARE_COMMANDS_TO_STRIP.has(name)) {
      i += cmdLen;
      continue;
    }

    const argCount = COMMANDS_TO_STRIP[name];
    if (argCount === undefined) {
      out += m[0];
      i += cmdLen;
      continue;
    }

    // Consume the command and its arguments.
    let j = i + cmdLen;
    // Eat any number of leading option groups `[...]`.
    while (true) {
      const k = skipWs(src, j);
      if (src[k] === '[') {
        const end = skipOptionGroup(src, k);
        if (end === -1) break;
        j = end;
      } else break;
    }
    // Eat `argCount` mandatory `{...}` groups.
    let ok = true;
    for (let n = 0; n < argCount; n++) {
      const k = skipWs(src, j);
      if (src[k] !== '{') {
        ok = false;
        break;
      }
      const end = skipBraceGroup(src, k);
      if (end === -1) {
        ok = false;
        break;
      }
      j = end;
    }
    // Eat any *trailing* option groups (e.g. `\titleformat{…}…[after]`).
    while (true) {
      const k = skipWs(src, j);
      if (src[k] === '[') {
        const end = skipOptionGroup(src, k);
        if (end === -1) break;
        j = end;
      } else break;
    }
    if (!ok) {
      // Malformed command — leave it alone rather than corrupt output.
      out += m[0];
      i += cmdLen;
      continue;
    }
    i = j;
  }
  return out;
}

/**
 * Split source into (preamble, body) at `\begin{document}` so we only
 * sanitise the preamble. Returns `null` if the marker is missing.
 */
function splitPreamble(src: string): { preamble: string; rest: string } | null {
  const m = /\\begin\s*\{\s*document\s*\}/.exec(src);
  if (!m) return null;
  return { preamble: src.slice(0, m.index), rest: src.slice(m.index) };
}

/**
 * latex.js's `\href` URL parser is strict: it rejects spaces and a
 * handful of other characters that everyday résumé / template
 * documents throw at it (e.g. `\href{tel:+91 8552981278}{…}`). The
 * quick fix is to percent-encode the URL argument before handing the
 * source over. We use `encodeURI` (not `encodeURIComponent`) so
 * legitimate URL structural characters — `:` `/` `?` `#` `&` `=` — are
 * left intact; only truly invalid chars like spaces get escaped.
 *
 * We deliberately walk balanced braces instead of using a naive regex
 * so URLs containing `{` / `}` (rare but possible) don't slice the
 * command apart.
 */
function sanitizeHrefUrls(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const idx = src.indexOf('\\href', i);
    if (idx === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, idx);
    let j = idx + '\\href'.length;
    // Optional whitespace before the URL group.
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] !== '{') {
      // Not a well-formed \href — leave it alone.
      out += src.slice(idx, j);
      i = j;
      continue;
    }
    const urlEnd = skipBraceGroup(src, j);
    if (urlEnd === -1) {
      out += src.slice(idx);
      break;
    }
    const url = src.slice(j + 1, urlEnd - 1);
    let encoded: string;
    try {
      // `encodeURI` percent-encodes only characters that are illegal
      // in a URI (spaces, control chars, non-ASCII). It leaves `:`,
      // `/`, `?`, `#`, `&`, `=` and `%` alone, so already-encoded
      // URLs survive intact.
      encoded = encodeURI(url);
    } catch {
      encoded = url;
    }
    out += `\\href{${encoded}}`;
    i = urlEnd;
  }
  return out;
}

/**
 * Public entry: sanitise a raw LaTeX source string for latex.js.
 */
export function sanitizeLatexForEngine(src: string): string {
  const split = splitPreamble(src);
  if (!split) {
    // Snippet without a document environment — still URL-encode any
    // `\href` arguments so partial fragments render.
    return promoteSectionsToStarred(replaceHfill(sanitizeHrefUrls(src)));
  }
  let preamble = split.preamble;
  preamble = stripUsepackage(preamble);
  preamble = stripArgCommands(preamble);
  // Some commands (e.g. `\pagestyle{empty}`) also appear inside the
  // body. Strip those from the body too, but only the *safe* ones.
  let body = stripArgCommands(split.rest);
  body = sanitizeHrefUrls(body);
  body = replaceHfill(body);
  body = promoteSectionsToStarred(body);
  return preamble + body;
}

/**
 * Convert `\section{X}` → `\section*{X}` (and same for the other
 * sectioning commands) so latex.js doesn't prepend automatic numbers.
 * Real-world templates almost always suppress those numbers via
 * `\titleformat`, which we strip — so the starred form is the closest
 * behavioural match. Preserves existing `*` markers.
 */
function promoteSectionsToStarred(src: string): string {
  return src.replace(
    /\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)(?!\*)\s*\{/g,
    '\\$1*{',
  );
}

/**
 * Replace every `\hfill` occurrence with a private-use sentinel that
 * survives latex.js's parser as plain text. `LatexPreview` later walks
 * the DOM, splits at the sentinel, and wraps the fragments in a flex
 * container so the surrounding content pushes apart — restoring the
 * two-column "company left / location right" layout that résumés rely
 * on. We only match a bare `\hfill` followed by a word boundary so we
 * don't accidentally rewrite e.g. `\hfillrule`.
 */
function replaceHfill(src: string): string {
  return src.replace(/\\hfill(?![a-zA-Z])/g, HFILL_SENTINEL);
}
