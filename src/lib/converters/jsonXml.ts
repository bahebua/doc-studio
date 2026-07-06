/*
 * Lightweight bidirectional JSON ↔ XML converters.
 *
 * Convention (matches fast-xml-parser / xml-js — the de-facto browser default):
 *   • Element attributes → keys prefixed with `@` (e.g. `@id: "42"`).
 *   • Element text nodes → `#text` key.
 *   • Repeated sibling elements → JSON array.
 *   • A pure-text element collapses to its string value: `<name>Alice</name>`
 *     ↔ `{ "name": "Alice" }`.
 *   • JSON `null` round-trips as an empty self-closing tag `<key/>`.
 *
 * These are intentionally best-effort convenience converters — they are NOT
 * suitable for round-tripping XML with mixed content (text + elements
 * interleaved), XML namespaces beyond preservation, DOCTYPEs, or CDATA. The
 * dialog surfaces this with a "convert" label rather than "export".
 */

// ---------------------------------------------------------------------------
// JSON → XML
// ---------------------------------------------------------------------------

interface JsonToXmlOptions {
  /** Root element name when the input JSON is an array or primitive. */
  rootName?: string;
  /** Indent unit (default two spaces). Use '' for a single-line output. */
  indent?: string;
  /** Include the `<?xml version="1.0" encoding="UTF-8"?>` prolog. */
  declaration?: boolean;
}

/**
 * Convert a JSON string to pretty-printed XML. Throws on invalid JSON so the
 * dialog can surface a clean error.
 */
export function jsonToXml(source: string, options: JsonToXmlOptions = {}): string {
  const { rootName = 'root', indent = '  ', declaration = true } = options;
  const parsed = JSON.parse(source);
  const body = buildXml(parsed, rootName, indent, 0);
  return declaration ? `<?xml version="1.0" encoding="UTF-8"?>\n${body}` : body;
}

function buildXml(value: unknown, name: string, indent: string, depth: number): string {
  const pad = indent.repeat(depth);
  const tag = sanitizeName(name);

  if (value === null || value === undefined) {
    return `${pad}<${tag}/>`;
  }

  if (Array.isArray(value)) {
    // Represent arrays as a wrapper with `<item>` children so we don't lose
    // the array-ness on round-trip. Alternative would be repeated <tag>
    // siblings but that requires the caller to know the container name.
    if (value.length === 0) return `${pad}<${tag}/>`;
    const children = value
      .map((v) => buildXml(v, 'item', indent, depth + 1))
      .join('\n');
    return `${pad}<${tag}>\n${children}\n${pad}</${tag}>`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (entries.length === 0) return `${pad}<${tag}/>`;

    const attrParts: string[] = [];
    const childParts: string[] = [];
    let textContent: string | null = null;

    for (const [k, v] of entries) {
      if (k.startsWith('@')) {
        attrParts.push(`${sanitizeName(k.slice(1))}="${escapeAttr(String(v))}"`);
      } else if (k === '#text') {
        textContent = v == null ? '' : String(v);
      } else if (Array.isArray(v)) {
        // Emit repeated sibling elements (idiomatic XML), not a wrapper.
        if (v.length === 0) {
          childParts.push(`${indent.repeat(depth + 1)}<${sanitizeName(k)}/>`);
        } else {
          for (const item of v) {
            childParts.push(buildXml(item, k, indent, depth + 1));
          }
        }
      } else {
        childParts.push(buildXml(v, k, indent, depth + 1));
      }
    }

    const attrs = attrParts.length ? ' ' + attrParts.join(' ') : '';

    if (childParts.length === 0 && textContent != null) {
      return `${pad}<${tag}${attrs}>${escapeText(textContent)}</${tag}>`;
    }
    if (childParts.length === 0 && textContent == null) {
      return `${pad}<${tag}${attrs}/>`;
    }
    const inner = childParts.join('\n');
    const textLine = textContent != null && textContent.length
      ? `\n${indent.repeat(depth + 1)}${escapeText(textContent)}`
      : '';
    return `${pad}<${tag}${attrs}>${textLine}\n${inner}\n${pad}</${tag}>`;
  }

  // Primitive.
  return `${pad}<${tag}>${escapeText(String(value))}</${tag}>`;
}

function sanitizeName(raw: string): string {
  // XML names must start with letter/underscore/colon, then [name char]. We
  // replace invalid chars with `_` and prefix a `_` if the first char is a
  // digit — enough to keep the output well-formed for arbitrary JSON keys.
  const cleaned = raw.replace(/[^\w:.\-]/g, '_');
  return /^[A-Za-z_:]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// XML → JSON
// ---------------------------------------------------------------------------

/**
 * Convert an XML string to a pretty-printed JSON string. Uses the browser's
 * DOMParser for parsing (available in every modern browser).
 */
export function xmlToJson(source: string, indent = 2): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(source.trim(), 'application/xml');

  // DOMParser signals errors by embedding a `<parsererror>` element in the
  // returned document rather than throwing. Surface those cleanly.
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) {
    throw new Error(err.textContent?.split('\n')[0] || 'Invalid XML');
  }

  const root = doc.documentElement;
  if (!root) throw new Error('XML has no root element');

  const obj = { [root.nodeName]: elementToJson(root) };
  return JSON.stringify(obj, null, indent);
}

/**
 * Convert an element to a plain-JSON value. Returns a bare string for
 * text-only elements with no attributes, else an object with `@attr` /
 * `#text` / nested child keys.
 */
function elementToJson(el: Element): unknown {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    attrs[`@${attr.name}`] = attr.value;
  }

  const childElements = Array.from(el.children);
  const textPieces: string[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      const t = node.nodeValue ?? '';
      if (t.trim().length) textPieces.push(t);
    }
  }
  const text = textPieces.join(' ').trim();

  // Text-only, no attributes → collapse to bare string. Preserves the
  // intuitive `{ "name": "Alice" }` shape.
  if (childElements.length === 0 && Object.keys(attrs).length === 0) {
    return text;
  }

  const result: Record<string, unknown> = { ...attrs };
  if (text) result['#text'] = text;

  // Group children by tag name; repeated tags become arrays.
  const grouped = new Map<string, Element[]>();
  for (const c of childElements) {
    const list = grouped.get(c.nodeName) ?? [];
    list.push(c);
    grouped.set(c.nodeName, list);
  }
  for (const [name, list] of grouped) {
    if (list.length === 1) {
      result[name] = elementToJson(list[0]);
    } else {
      result[name] = list.map((e) => elementToJson(e));
    }
  }
  return result;
}
