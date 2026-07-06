import type { Language } from '@/types';
import { looksLikeLatexDocument } from '@/lib/converters/texToMd';

/**
 * Sniff the plausible editor language of a raw text buffer. Returns a
 * concrete `Language` when the content is *unambiguously* structured
 * (parses as JSON, opens with an XML/HTML preamble, …). Returns `null`
 * when we're not confident enough to switch — the caller then leaves
 * whatever language was already set alone.
 *
 * Deliberately conservative: false positives are much worse than false
 * negatives here. A user pasting `{ "note": ... }` into a Markdown
 * buffer as an example should NOT have their tab silently rewritten as
 * JSON. The rules below require enough structure that plausible prose
 * won't trip them.
 */
export function detectLanguage(content: string): Language | null {
  const trimmed = content.trim();
  if (trimmed.length < 20) return null; // too short to guess reliably

  // XML — declaration wins outright. Some files carry a leading BOM
  // (already stripped by `trim()` in modern JS) or a comment before the
  // declaration, so we allow either shape.
  if (/^(?:<\?xml\b|<!DOCTYPE\s+(?!html\b))/i.test(trimmed)) return 'xml';

  // HTML — DOCTYPE html, `<html>`, or a familiar structural tag at the
  // top of the file. We require an obvious root element to avoid firing
  // on inline HTML fragments inside Markdown.
  if (/^(?:<!DOCTYPE\s+html\b|<html\b|<!--[\s\S]*?-->\s*<html\b)/i.test(trimmed)) return 'html';

  // JSON — must parse cleanly AND look like an object/array. Bare
  // primitives (`"foo"`, `42`, `true`) are technically valid JSON but
  // almost always represent plain text the user typed by hand.
  if (/^[[{]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') return 'json';
    } catch {
      // Fall through — malformed JSON stays as whatever it was.
    }
  }

  return null;
}

/**
 * Pick a filesystem extension for a save/download of this document.
 * Complements `detectLanguage` — the store keeps LaTeX under the
 * `markdown` language (no dedicated CodeMirror mode ships in the app),
 * so the extension picker sniffs the *content* one more time to hand
 * back `.tex` when the buffer clearly holds a LaTeX document.
 */
export function guessFileExtension(content: string, language: Language): string {
  if (language === 'html') return 'html';
  if (language === 'json') return 'json';
  if (language === 'xml') return 'xml';
  // Markdown: peek for LaTeX so the "download as Markdown" button in
  // the export dialog doesn't hand a `.md` file to someone who spent
  // the last hour typing `\section{…}`.
  if (looksLikeLatexDocument(content)) return 'tex';
  return 'md';
}
