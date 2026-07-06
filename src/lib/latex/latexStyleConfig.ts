import type { CSSProperties } from 'react';

/**
 * Tunable knobs for the LaTeX preview. Every field maps to a CSS
 * custom property on `.md-preview.latex-mode`; the stylesheet
 * (`src/index.css`) reads them via `var(--doc-*, fallback)` so the
 * fallback survives when the config module isn't loaded.
 *
 * Keep this list short and correspond one-to-one with visible visual
 * effects — over-exposing every latex.js internal makes the UI harder
 * to use without materially improving output.
 */
export interface LatexStyleConfig {
  /** Base body font size in CSS pixels. Scales the whole document. */
  fontSizePx: number;
  /** Unitless line-height for body text. */
  lineHeight: number;
  /** White-space around the printable area, in inches. */
  pagePaddingIn: number;
  /** Space above every `\section` header, in `ex` units. */
  h2MarginTopEx: number;
  /** Space below every `\section` header, in `ex` units. */
  h2MarginBottomEx: number;
  /** Font size multiplier for `\section` headers, unitless em. */
  h2FontSizeEm: number;
  /** Font size multiplier for the `\Huge` title, unitless em. */
  hugeFontSizeEm: number;
  /** Bullet / itemize indentation, in `em` units. */
  listIndentEm: number;
  /** Vertical space between adjacent list items, in `rem` units. */
  listItemSpacingRem: number;
  /** Bottom margin of every `<p>` inside the document, in `em` units. */
  paragraphSpacingEm: number;
}

/**
 * Default profile — matches the current baked-in stylesheet so behaviour
 * is unchanged if the user never touches the panel.
 */
export const DEFAULT_STYLE: LatexStyleConfig = {
  fontSizePx: 13.5,
  lineHeight: 1.22,
  pagePaddingIn: 0.4,
  h2MarginTopEx: 0.6,
  h2MarginBottomEx: 0.4,
  h2FontSizeEm: 1.12,
  hugeFontSizeEm: 1.9,
  listIndentEm: 1,
  listItemSpacingRem: 0.12,
  paragraphSpacingEm: 0.25,
};

/**
 * Curated presets. Ordered from densest (Overleaf-résumé target) to
 * most generous (long-form report). Users typically pick a preset and
 * fine-tune from there.
 */
export const PRESETS: Record<string, LatexStyleConfig> = {
  'Overleaf-Tight': {
    fontSizePx: 13.5,
    lineHeight: 1.18,
    pagePaddingIn: 0.4,
    h2MarginTopEx: 0.4,
    h2MarginBottomEx: 0.25,
    h2FontSizeEm: 1.1,
    hugeFontSizeEm: 1.85,
    listIndentEm: 0.9,
    listItemSpacingRem: 0.08,
    paragraphSpacingEm: 0.15,
  },
  Balanced: DEFAULT_STYLE,
  Roomy: {
    fontSizePx: 14.5,
    lineHeight: 1.32,
    pagePaddingIn: 0.55,
    h2MarginTopEx: 1.4,
    h2MarginBottomEx: 0.9,
    h2FontSizeEm: 1.2,
    hugeFontSizeEm: 2,
    listIndentEm: 1.4,
    listItemSpacingRem: 0.25,
    paragraphSpacingEm: 0.5,
  },
};

/**
 * Convert a config to the inline-style object consumed by React. Each
 * property matches a `var(--doc-*)` reference in the stylesheet.
 */
export function toCssVars(cfg: LatexStyleConfig): CSSProperties {
  // React accepts arbitrary custom-property strings when the object is
  // typed as CSSProperties — cast so TS doesn't complain about the
  // `--doc-*` keys, which aren't in its built-in property union.
  return {
    ['--doc-font-size' as string]: `${cfg.fontSizePx}px`,
    ['--doc-line-height' as string]: `${cfg.lineHeight}`,
    ['--doc-page-padding' as string]: `${cfg.pagePaddingIn}in`,
    ['--doc-h2-margin-top' as string]: `${cfg.h2MarginTopEx}ex`,
    ['--doc-h2-margin-bottom' as string]: `${cfg.h2MarginBottomEx}ex`,
    ['--doc-h2-font-size' as string]: `${cfg.h2FontSizeEm}em`,
    ['--doc-huge-font-size' as string]: `${cfg.hugeFontSizeEm}em`,
    ['--doc-list-indent' as string]: `${cfg.listIndentEm}em`,
    ['--doc-list-item-spacing' as string]: `${cfg.listItemSpacingRem}rem`,
    ['--doc-paragraph-spacing' as string]: `${cfg.paragraphSpacingEm}em`,
  } as CSSProperties;
}

/**
 * Serialise the config as a standalone CSS block. Consumed by the
 * "Copy CSS" button on the style panel so users can paste the current
 * tuning into a static stylesheet elsewhere.
 */
export function toCssBlock(cfg: LatexStyleConfig): string {
  const lines = [
    `  --doc-font-size: ${cfg.fontSizePx}px;`,
    `  --doc-line-height: ${cfg.lineHeight};`,
    `  --doc-page-padding: ${cfg.pagePaddingIn}in;`,
    `  --doc-h2-margin-top: ${cfg.h2MarginTopEx}ex;`,
    `  --doc-h2-margin-bottom: ${cfg.h2MarginBottomEx}ex;`,
    `  --doc-h2-font-size: ${cfg.h2FontSizeEm}em;`,
    `  --doc-huge-font-size: ${cfg.hugeFontSizeEm}em;`,
    `  --doc-list-indent: ${cfg.listIndentEm}em;`,
    `  --doc-list-item-spacing: ${cfg.listItemSpacingRem}rem;`,
    `  --doc-paragraph-spacing: ${cfg.paragraphSpacingEm}em;`,
  ];
  return `.md-preview.latex-mode {\n${lines.join('\n')}\n}\n`;
}

/**
 * Inverse of `toCssBlock`. Scan any CSS text for `--doc-*` custom-
 * property declarations and turn them back into a partial config.
 * Missing fields fall through to whatever the caller merges in — the
 * panel merges with the current config so the user can supply just a
 * couple of overrides in the pasted snippet.
 *
 * Unrecognised custom properties, malformed values, and other CSS
 * around the declarations are all ignored silently — the parser is
 * meant to be forgiving so a user can paste an entire stylesheet.
 */
const CSS_VAR_TO_KEY: Record<string, { key: keyof LatexStyleConfig; unit: string | null }> = {
  'doc-font-size': { key: 'fontSizePx', unit: 'px' },
  'doc-line-height': { key: 'lineHeight', unit: null },
  'doc-page-padding': { key: 'pagePaddingIn', unit: 'in' },
  'doc-h2-margin-top': { key: 'h2MarginTopEx', unit: 'ex' },
  'doc-h2-margin-bottom': { key: 'h2MarginBottomEx', unit: 'ex' },
  'doc-h2-font-size': { key: 'h2FontSizeEm', unit: 'em' },
  'doc-huge-font-size': { key: 'hugeFontSizeEm', unit: 'em' },
  'doc-list-indent': { key: 'listIndentEm', unit: 'em' },
  'doc-list-item-spacing': { key: 'listItemSpacingRem', unit: 'rem' },
  'doc-paragraph-spacing': { key: 'paragraphSpacingEm', unit: 'em' },
};

export interface ParseCssResult {
  patch: Partial<LatexStyleConfig>;
  matched: number;
  unknown: string[];
}

export function parseCssBlock(cssText: string): ParseCssResult {
  const patch: Partial<LatexStyleConfig> = {};
  const unknown: string[] = [];
  let matched = 0;
  // Match `--foo: value;` — value grabs everything up to `;`, `}`, or
  // end-of-line so multi-line blocks and comments outside declarations
  // don't confuse us.
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;}\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssText)) !== null) {
    const name = m[1];
    const rawValue = m[2].trim();
    const spec = CSS_VAR_TO_KEY[name];
    if (!spec) {
      if (name.startsWith('doc-')) unknown.push(name);
      continue;
    }
    // Strip the expected unit (case-insensitive) plus any trailing
    // whitespace; the surviving text should be a bare number.
    const numeric = spec.unit
      ? rawValue.replace(new RegExp(`${spec.unit}$`, 'i'), '').trim()
      : rawValue;
    const parsed = Number(numeric);
    if (!Number.isFinite(parsed)) continue;
    patch[spec.key] = parsed;
    matched++;
  }
  return { patch, matched, unknown };
}

const STORAGE_KEY = 'docstudio.latexStyle.v1';

/**
 * Read a saved config from localStorage. Falls back to `DEFAULT_STYLE`
 * on any error (missing key, corrupted JSON, missing field). Missing
 * fields are backfilled from `DEFAULT_STYLE` so future additions to
 * `LatexStyleConfig` don't break old saves.
 */
export function loadFromStorage(): LatexStyleConfig {
  if (typeof window === 'undefined') return DEFAULT_STYLE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STYLE;
    const parsed = JSON.parse(raw) as Partial<LatexStyleConfig>;
    return { ...DEFAULT_STYLE, ...parsed };
  } catch {
    return DEFAULT_STYLE;
  }
}

export function saveToStorage(cfg: LatexStyleConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Storage quota / private mode — silently ignore; the live values
    // still apply for the current session.
  }
}
