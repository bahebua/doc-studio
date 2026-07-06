/**
 * Pure-function pretty-printers used by the "Import" and "Format" paths.
 * No dependencies — all in-browser (JSON native, XML via DOMParser).
 */

const INDENT = '  ';

/* -------------------------------------------------------------------------- */
/*  JSON                                                                       */
/* -------------------------------------------------------------------------- */

/** Pretty-print a JSON source string with 2-space indent. Throws on invalid. */
export function formatJson(text: string): string {
  return JSON.stringify(JSON.parse(text), null, 2);
}

/* -------------------------------------------------------------------------- */
/*  XML                                                                        */
/* -------------------------------------------------------------------------- */

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXmlAttr(s: string): string {
  return escapeXmlText(s).replace(/"/g, '&quot;');
}

function serializeElement(el: Element, depth: number): string {
  const pad = INDENT.repeat(depth);
  const attrs = Array.from(el.attributes)
    .map((a) => ` ${a.name}="${escapeXmlAttr(a.value)}"`)
    .join('');
  const name = el.tagName;
  const children = Array.from(el.childNodes);

  if (children.length === 0) {
    return `${pad}<${name}${attrs}/>`;
  }

  // Only whitespace + a single text node → keep on one line.
  const nonWs = children.filter(
    (c) => c.nodeType !== 3 || (c.textContent ?? '').trim() !== '',
  );
  if (
    nonWs.length === 1 &&
    nonWs[0].nodeType === 3 /* Node.TEXT_NODE */
  ) {
    return `${pad}<${name}${attrs}>${escapeXmlText((nonWs[0].textContent ?? '').trim())}</${name}>`;
  }

  const parts = [`${pad}<${name}${attrs}>`];
  for (const child of children) {
    switch (child.nodeType) {
      case 1: // ELEMENT
        parts.push(serializeElement(child as Element, depth + 1));
        break;
      case 3: {
        // TEXT
        const t = (child.textContent ?? '').trim();
        if (t) parts.push(`${INDENT.repeat(depth + 1)}${escapeXmlText(t)}`);
        break;
      }
      case 4: {
        // CDATA
        const t = child.textContent ?? '';
        parts.push(`${INDENT.repeat(depth + 1)}<![CDATA[${t}]]>`);
        break;
      }
      case 7: // PROCESSING_INSTRUCTION
        parts.push(
          `${INDENT.repeat(depth + 1)}<?${(child as ProcessingInstruction).target} ${(child as ProcessingInstruction).data}?>`,
        );
        break;
      case 8: // COMMENT
        parts.push(
          `${INDENT.repeat(depth + 1)}<!--${(child.textContent ?? '').trim()}-->`,
        );
        break;
      // ignore other node types
    }
  }
  parts.push(`${pad}</${name}>`);
  return parts.join('\n');
}

/**
 * Pretty-print an XML source string. Uses the browser's own DOMParser so
 * parsing is spec-correct; the serializer is a small recursive walk that
 * indents elements and collapses simple text-only nodes onto one line.
 * Throws with a readable message on invalid XML.
 */
export function formatXml(xml: string): string {
  const src = xml.trim();
  if (!src) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(src, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) {
    // Firefox nests the message, Chrome puts it in textContent — either works.
    throw new Error(`Invalid XML: ${err.textContent?.trim() ?? 'parse error'}`);
  }

  // Preserve the leading <?xml ...?> declaration if the source had one.
  const declMatch = src.match(/^\s*(<\?xml[^?]*\?>)/i);
  const decl = declMatch ? `${declMatch[1]}\n` : '';

  const root = doc.documentElement;
  return decl + serializeElement(root, 0);
}

/* -------------------------------------------------------------------------- */
/*  Fenced-code-block scoped formatting for a whole Markdown document          */
/* -------------------------------------------------------------------------- */

export interface FormatDocResult {
  content: string;
  formatted: number;
  skipped: Array<{ lang: string; error: string }>;
}

/**
 * Walk every fenced code block in `markdown` and pretty-print the ones whose
 * language tag is `json` or `xml`. Other blocks are left untouched.
 * Returns the rewritten content plus counters for a UX toast.
 */
export function formatCodeBlocks(markdown: string): FormatDocResult {
  const fence = /^([ \t]{0,3})(```+|~~~+)[ \t]*([^\s`~]*)[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm;
  let formatted = 0;
  const skipped: FormatDocResult['skipped'] = [];

  const content = markdown.replace(
    fence,
    (match, indent: string, ticks: string, langRaw: string, body: string) => {
      const lang = (langRaw || '').trim().toLowerCase();
      if (lang !== 'json' && lang !== 'xml') return match;
      try {
        const pretty = lang === 'json' ? formatJson(body) : formatXml(body);
        formatted++;
        // Re-indent the pretty output to match the fence indent so we don't
        // accidentally break a list-nested code block.
        const reIndented = indent
          ? pretty
              .split('\n')
              .map((l) => (l ? indent + l : l))
              .join('\n')
          : pretty;
        return `${indent}${ticks}${lang}\n${reIndented}\n${indent}${ticks}`;
      } catch (e) {
        skipped.push({
          lang,
          error: e instanceof Error ? e.message : String(e),
        });
        return match;
      }
    },
  );

  return { content, formatted, skipped };
}
