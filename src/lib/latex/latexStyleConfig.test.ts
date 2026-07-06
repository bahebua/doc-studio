import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STYLE,
  PRESETS,
  toCssBlock,
  parseCssBlock,
  toCssVars,
} from './latexStyleConfig';

describe('latexStyleConfig', () => {
  describe('toCssBlock', () => {
    it('emits a .md-preview.latex-mode block with every --doc-* var', () => {
      const css = toCssBlock(DEFAULT_STYLE);
      expect(css).toContain('.md-preview.latex-mode {');
      expect(css).toContain('--doc-font-size: 13.5px;');
      expect(css).toContain('--doc-line-height: 1.22;');
      expect(css).toContain('--doc-page-padding: 0.4in;');
      expect(css).toContain('--doc-h2-margin-top: 0.6ex;');
      expect(css).toContain('--doc-h2-margin-bottom: 0.4ex;');
      expect(css).toContain('--doc-h2-font-size: 1.12em;');
      expect(css).toContain('--doc-huge-font-size: 1.9em;');
      expect(css).toContain('--doc-list-indent: 1em;');
      expect(css).toContain('--doc-list-item-spacing: 0.12rem;');
      expect(css).toContain('--doc-paragraph-spacing: 0.25em;');
    });
  });

  describe('parseCssBlock', () => {
    it('roundtrips toCssBlock output back into the original config', () => {
      for (const [name, preset] of Object.entries(PRESETS)) {
        const css = toCssBlock(preset);
        const { patch, matched, unknown } = parseCssBlock(css);
        expect(matched, `preset ${name} matched count`).toBe(10);
        expect(unknown, `preset ${name} unknown vars`).toEqual([]);
        expect(patch).toEqual(preset);
      }
    });

    it('ignores unrelated CSS declarations and reports doc-* unknowns', () => {
      const css = `
        body { color: red; margin: 10px; }
        .md-preview.latex-mode {
          --doc-font-size: 15px;
          --doc-unknown-thing: 42px;
          --unrelated-var: 99px;
          color: blue;
        }
      `;
      const { patch, matched, unknown } = parseCssBlock(css);
      expect(matched).toBe(1);
      expect(patch.fontSizePx).toBe(15);
      expect(unknown).toEqual(['doc-unknown-thing']);
    });

    it('strips the expected unit case-insensitively', () => {
      const { patch, matched } = parseCssBlock(
        '--doc-font-size: 14PX; --doc-page-padding: 0.5IN; --doc-line-height: 1.5;',
      );
      expect(matched).toBe(3);
      expect(patch.fontSizePx).toBe(14);
      expect(patch.pagePaddingIn).toBe(0.5);
      expect(patch.lineHeight).toBe(1.5);
    });

    it('skips declarations whose value is not a finite number', () => {
      const { patch, matched } = parseCssBlock(
        '--doc-font-size: auto; --doc-line-height: 1.4;',
      );
      expect(matched).toBe(1);
      expect(patch.fontSizePx).toBeUndefined();
      expect(patch.lineHeight).toBe(1.4);
    });

    it('returns an empty patch for text with no doc vars', () => {
      const { patch, matched, unknown } = parseCssBlock('body { color: red; }');
      expect(matched).toBe(0);
      expect(unknown).toEqual([]);
      expect(patch).toEqual({});
    });
  });

  describe('toCssVars', () => {
    it('produces a CSSProperties object keyed by the doc custom properties', () => {
      const vars = toCssVars(DEFAULT_STYLE) as Record<string, string>;
      expect(vars['--doc-font-size']).toBe('13.5px');
      expect(vars['--doc-line-height']).toBe('1.22');
      expect(vars['--doc-page-padding']).toBe('0.4in');
      expect(vars['--doc-paragraph-spacing']).toBe('0.25em');
    });
  });
});
