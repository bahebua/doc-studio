import type { DocStats, TocItem } from '@/types';

const WORDS_PER_MINUTE = 220;

export function computeStats(text: string): DocStats {
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s+/g, '').length;
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  const sentences = (text.match(/[.!?]+(?:\s|$)/g) ?? []).length;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
  const readingTimeMinutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));

  return {
    characters,
    charactersNoSpaces,
    words,
    sentences,
    paragraphs,
    readingTimeMinutes,
  };
}

/**
 * Slug generator mirroring what `rehype-slug` produces so we can link the TOC
 * to the rendered headings without an extra render pass.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[\u2018\u2019\u201c\u201d]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;

/**
 * LaTeX sectioning commands, ordered by depth. Used to build an outline
 * when the source is a `.tex` file / pasted LaTeX rather than Markdown.
 * `\chapter` sits at depth 1 to mirror `#`, `\section` at 2, etc. so the
 * indent visual stays consistent with the Markdown outline.
 */
const LATEX_SECTION_DEPTHS: Record<string, number> = {
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};
const LATEX_SECTION_RE =
  /\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

export function extractToc(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  const seen = new Map<string, number>();

  // Blank out fenced code blocks with same-length spaces (not deletion) so
  // `# fake heading` inside them is ignored *and* subsequent match indices
  // still line up with the original document for line-number computation.
  const noFences = markdown.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '));

  // Precompute a line-offset table so we can convert `match.index` → line
  // number in O(log n) via binary search.
  const lineOffsets: number[] = [0];
  for (let i = 0; i < noFences.length; i++) {
    if (noFences.charCodeAt(i) === 10) lineOffsets.push(i + 1);
  }
  const lineFor = (pos: number): number => {
    let lo = 0;
    let hi = lineOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (lineOffsets[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-based
  };

  HEADING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEADING_RE.exec(noFences)) !== null) {
    const depth = match[1].length;
    const text = match[2].replace(/`([^`]+)`/g, '$1');
    let id = slugify(text);
    if (!id) continue;
    const count = seen.get(id) ?? 0;
    if (count > 0) id = `${id}-${count}`;
    seen.set(slugify(text), count + 1);
    items.push({ id, text, depth, line: lineFor(match.index), col: 0 });
  }

  // If the document looks like LaTeX (either no Markdown headings were
  // found, or the source contains sectioning commands), also mine
  // `\section{…}` / `\subsection{…}` etc. so pasted `.tex` gets an
  // outline without the user having to convert to Markdown first.
  if (LATEX_SECTION_RE.test(noFences)) {
    LATEX_SECTION_RE.lastIndex = 0;
    let sec: RegExpExecArray | null;
    while ((sec = LATEX_SECTION_RE.exec(noFences)) !== null) {
      const cmd = sec[1];
      const rawText = sec[2] ?? '';
      const depth = LATEX_SECTION_DEPTHS[cmd] ?? 2;
      // Strip nested LaTeX formatting commands to get a readable label.
      const text = rawText
        .replace(/\\[a-zA-Z]+\*?\s*\{([^{}]*)\}/g, '$1')
        .replace(/\\[a-zA-Z]+\*?/g, '')
        .replace(/[{}]/g, '')
        .trim();
      if (!text) continue;
      let id = slugify(text);
      if (!id) continue;
      const count = seen.get(id) ?? 0;
      if (count > 0) id = `${id}-${count}`;
      seen.set(slugify(text), count + 1);
      items.push({ id, text, depth, line: lineFor(sec.index), col: 0 });
    }
    // Keep source order — sort by line so LaTeX and Markdown headings
    // interleave correctly if the document mixes both (rare, but valid).
    items.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }

  return items;
}

// ---------------------------------------------------------------------------
// JSON outline
// ---------------------------------------------------------------------------
// A tiny recursive-descent JSON parser that records the (line, col) position
// of each object key and array index. We don't build a value tree — we just
// walk the source, emit outline items as we go, and skip past values. This is
// fast enough to run on every keystroke for typical documents and never
// throws on invalid JSON (returns what it managed to parse).

interface JsonScanner {
  src: string;
  pos: number;
  line: number; // 1-based
  col: number;  // 0-based
  items: TocItem[];
}

function advance(s: JsonScanner, n: number): void {
  for (let i = 0; i < n && s.pos < s.src.length; i++) {
    const ch = s.src.charCodeAt(s.pos);
    if (ch === 10) {
      s.line++;
      s.col = 0;
    } else {
      s.col++;
    }
    s.pos++;
  }
}

function skipWs(s: JsonScanner): void {
  while (s.pos < s.src.length) {
    const c = s.src[s.pos];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') advance(s, 1);
    else break;
  }
}

/** Consume a JSON string starting at the current `"`. Returns the raw text
 *  (unescaped enough for outline display). Advances past the closing quote. */
function readString(s: JsonScanner): string {
  advance(s, 1); // opening "
  let out = '';
  while (s.pos < s.src.length) {
    const c = s.src[s.pos];
    if (c === '"') {
      advance(s, 1);
      return out;
    }
    if (c === '\\' && s.pos + 1 < s.src.length) {
      out += s.src[s.pos + 1];
      advance(s, 2);
      continue;
    }
    out += c;
    advance(s, 1);
  }
  return out;
}

/** Skip a JSON value (any type) without producing outline items. Used when we
 *  don't care about the sub-structure (e.g., inside a primitive array). */
function skipValue(s: JsonScanner): void {
  skipWs(s);
  const c = s.src[s.pos];
  if (!c) return;
  if (c === '"') { readString(s); return; }
  if (c === '{' || c === '[') {
    const open = c;
    const close = c === '{' ? '}' : ']';
    let depth = 1;
    advance(s, 1);
    while (s.pos < s.src.length && depth > 0) {
      const cur = s.src[s.pos];
      if (cur === '"') { readString(s); continue; }
      if (cur === open) depth++;
      else if (cur === close) depth--;
      advance(s, 1);
    }
    return;
  }
  // primitive (number / true / false / null)
  while (s.pos < s.src.length && !',}] \t\r\n'.includes(s.src[s.pos])) advance(s, 1);
}

function walkValue(s: JsonScanner, path: string, depth: number): void {
  skipWs(s);
  const c = s.src[s.pos];
  if (c === '{') { walkObject(s, path, depth); return; }
  if (c === '[') { walkArray(s, path, depth); return; }
  skipValue(s);
}

function walkObject(s: JsonScanner, path: string, depth: number): void {
  advance(s, 1); // {
  skipWs(s);
  if (s.src[s.pos] === '}') { advance(s, 1); return; }
  while (s.pos < s.src.length) {
    skipWs(s);
    if (s.src[s.pos] !== '"') break; // malformed; bail
    const keyLine = s.line;
    const keyCol = s.col;
    const keyStart = s.pos;
    const key = readString(s);
    skipWs(s);
    if (s.src[s.pos] !== ':') break;
    advance(s, 1);
    skipWs(s);
    const childPath = path ? `${path}.${key}` : key;
    const valStart = s.src[s.pos];
    const hint =
      valStart === '{' ? 'object' :
      valStart === '[' ? 'array' :
      valStart === '"' ? 'string' :
      valStart === 't' || valStart === 'f' ? 'boolean' :
      valStart === 'n' ? 'null' :
      'number';
    const valueStart = s.pos;
    const item: TocItem = {
      id: `json:${childPath}`,
      text: key,
      depth: depth + 1,
      line: keyLine,
      col: keyCol,
      hint,
      needle: `"${key}"`,
      path: childPath,
      startOffset: keyStart,
      valueStart,
    };
    s.items.push(item);
    walkValue(s, childPath, depth + 1);
    item.valueEnd = s.pos;
    item.endOffset = s.pos;
    skipWs(s);
    if (s.src[s.pos] === ',') { advance(s, 1); continue; }
    if (s.src[s.pos] === '}') { advance(s, 1); return; }
    break;
  }
}

function walkArray(s: JsonScanner, path: string, depth: number): void {
  advance(s, 1); // [
  skipWs(s);
  if (s.src[s.pos] === ']') { advance(s, 1); return; }
  let idx = 0;
  while (s.pos < s.src.length) {
    skipWs(s);
    const elStart = s.src[s.pos];
    if (elStart === '{') {
      const childPath = `${path}[${idx}]`;
      const startLine = s.line;
      const startCol = s.col;
      const startOffset = s.pos;
      const item: TocItem = {
        id: `json:${childPath}`,
        text: `[${idx}]`,
        depth: depth + 1,
        line: startLine,
        col: startCol,
        hint: 'object',
        needle: '{',
        path: childPath,
        startOffset,
        valueStart: startOffset,
      };
      s.items.push(item);
      walkObject(s, childPath, depth + 1);
      item.valueEnd = s.pos;
      item.endOffset = s.pos;
    } else {
      skipValue(s);
    }
    idx++;
    skipWs(s);
    if (s.src[s.pos] === ',') { advance(s, 1); continue; }
    if (s.src[s.pos] === ']') { advance(s, 1); return; }
    break;
  }
}

export function extractJsonOutline(source: string): TocItem[] {
  const s: JsonScanner = { src: source, pos: 0, line: 1, col: 0, items: [] };
  try {
    walkValue(s, '', 0);
  } catch {
    /* Best-effort — return whatever we collected. */
  }
  return annotateOccurrence(s.items);
}

/**
 * Compute a per-item `occurrence` count based on how many prior items share
 * the same `needle`. Lets the preview walk N-many matches to reach this one
 * even when the same key/tag repeats.
 */
function annotateOccurrence(items: TocItem[]): TocItem[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.needle) continue;
    const n = counts.get(item.needle) ?? 0;
    item.occurrence = n;
    counts.set(item.needle, n + 1);
  }
  return items;
}

// ---------------------------------------------------------------------------
// XML outline
// ---------------------------------------------------------------------------
// Regex-based scan that tracks depth via a tag stack. Doesn't validate the
// document (comments, CDATA, self-closing tags are handled just enough to
// give a useful outline). Never throws.

const XML_TAG_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([a-zA-Z_][\w:.\-]*)([^>]*)>/g;

export function extractXmlOutline(source: string): TocItem[] {
  const items: TocItem[] = [];
  // Stack holds enough info to backfill an element's value range and produce
  // a dotted path (`root.body.div[2]`) when the close tag is encountered.
  interface StackFrame {
    tag: string;
    item: TocItem;
    /** Sibling index of this tag under its parent (0-based). */
    siblingIdx: number;
    /** Map of tag → count so we can index repeated siblings. */
    childCounts: Map<string, number>;
  }
  const stack: StackFrame[] = [];
  // Root child counts (for top-level elements).
  const rootCounts = new Map<string, number>();
  XML_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = XML_TAG_RE.exec(source))) {
    if (!m[2]) continue; // comments, CDATA, PIs
    const isClose = m[1] === '/';
    const tag = m[2];
    const rest = m[3] ?? '';
    const selfClose = /\/\s*$/.test(rest);

    if (isClose) {
      // Pop matching frame; use the position just before `</tag>` as valueEnd,
      // and the position just past `>` of the close tag as endOffset.
      const idx = lastIndexOfFrame(stack, tag);
      if (idx >= 0) {
        stack[idx].item.valueEnd = m.index;
        stack[idx].item.endOffset = m.index + m[0].length;
        stack.length = idx;
      }
      continue;
    }

    const start = m.index;
    // Convert absolute index → (line, col).
    let line = 1;
    let col = 0;
    for (let i = 0; i < start; i++) {
      if (source.charCodeAt(i) === 10) { line++; col = 0; } else col++;
    }

    // Parent's child counter determines this element's sibling index.
    const parent = stack[stack.length - 1];
    const counts = parent ? parent.childCounts : rootCounts;
    const siblingIdx = counts.get(tag) ?? 0;
    counts.set(tag, siblingIdx + 1);

    const parentPath = parent ? parent.item.path : '';
    const localSegment = siblingIdx === 0 ? tag : `${tag}[${siblingIdx}]`;
    const path = parentPath ? `${parentPath}.${localSegment}` : localSegment;

    const attrMatch = /\b(id|name|ref)\s*=\s*"([^"]+)"/i.exec(rest);
    const label = attrMatch ? `${tag} · ${attrMatch[2]}` : tag;

    const item: TocItem = {
      id: `xml:${items.length}`,
      text: label,
      depth: stack.length + 1,
      line,
      col,
      hint: selfClose ? 'empty' : undefined,
      needle: `<${tag}`,
      path,
      startOffset: m.index,
      valueStart: m.index + m[0].length, // just past the `>` of the open tag
      selfClosing: selfClose || undefined,
    };
    items.push(item);

    if (!selfClose) {
      stack.push({
        tag,
        item,
        siblingIdx,
        childCounts: new Map<string, number>(),
      });
    } else {
      item.valueEnd = m.index + m[0].length;
      item.endOffset = m.index + m[0].length;
    }
  }
  return annotateOccurrence(items);
}

// Polyfill for Array.prototype.findLastIndex on older JS targets.
function lastIndexOfFrame<T extends { tag: string }>(arr: T[], tag: string): number {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].tag === tag) return i;
  return -1;
}

