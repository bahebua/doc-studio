import { describe, it, expect } from 'vitest';
import { slugify, extractToc } from './stats';

describe('slugify', () => {
  it('lowercases and hyphenates plain text', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips punctuation and smart quotes', () => {
    expect(slugify('It\u2019s a test!')).toBe('its-a-test');
    expect(slugify('\u201cQuoted\u201d Title')).toBe('quoted-title');
  });

  it('collapses runs of whitespace and hyphens', () => {
    expect(slugify('  multiple   spaces  ')).toBe('multiple-spaces');
    expect(slugify('a --- b')).toBe('a-b');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('---edge---')).toBe('edge');
  });

  it('returns empty string when nothing survives', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('extractToc — markdown', () => {
  it('parses ATX headings with correct depths', () => {
    const items = extractToc('# One\n## Two\n### Three\n');
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ id: 'one', text: 'One', depth: 1 });
    expect(items[1]).toMatchObject({ id: 'two', text: 'Two', depth: 2 });
    expect(items[2]).toMatchObject({ id: 'three', text: 'Three', depth: 3 });
  });

  it('ignores headings inside fenced code blocks', () => {
    const md = '# Real\n\n```\n# Fake\n```\n\n## Also real';
    const items = extractToc(md);
    expect(items.map((i) => i.text)).toEqual(['Real', 'Also real']);
  });

  it('dedupes duplicate slugs with numeric suffixes', () => {
    const items = extractToc('# Alpha\n# Alpha\n# Alpha');
    expect(items.map((i) => i.id)).toEqual(['alpha', 'alpha-1', 'alpha-2']);
  });
});

describe('extractToc — LaTeX', () => {
  it('extracts \\section-style headings from a .tex source', () => {
    const src = String.raw`\documentclass{article}
\begin{document}
\section{First}
\subsection{First-A}
\subsubsection{Deep}
\section{Second}
\end{document}`;
    const items = extractToc(src);
    expect(items.map((i) => ({ text: i.text, depth: i.depth }))).toEqual([
      { text: 'First', depth: 2 },
      { text: 'First-A', depth: 3 },
      { text: 'Deep', depth: 4 },
      { text: 'Second', depth: 2 },
    ]);
  });

  it('treats \\chapter as depth 1', () => {
    const items = extractToc(String.raw`\chapter{Intro}` + '\n' + String.raw`\section{Basics}`);
    expect(items[0]).toMatchObject({ text: 'Intro', depth: 1 });
    expect(items[1]).toMatchObject({ text: 'Basics', depth: 2 });
  });

  it('handles starred sectioning commands and optional short titles', () => {
    const items = extractToc(
      String.raw`\section*{No Number}` + '\n' + String.raw`\section[Short]{Long Title}`,
    );
    expect(items.map((i) => i.text)).toEqual(['No Number', 'Long Title']);
  });

  it('strips nested formatting commands from the label', () => {
    const items = extractToc(String.raw`\section{Hello \textbf{Bold} World}`);
    expect(items[0].text).toBe('Hello Bold World');
  });

  it('dedupes LaTeX slugs the same way markdown does', () => {
    const src =
      String.raw`\section{Overview}` + '\n' + String.raw`\section{Overview}` + '\n' +
      String.raw`\section{Overview}`;
    const items = extractToc(src);
    expect(items.map((i) => i.id)).toEqual(['overview', 'overview-1', 'overview-2']);
  });

  it('interleaves LaTeX and markdown headings by source line', () => {
    const src = [
      '# Prelude',
      '',
      String.raw`\section{Body}`,
      '',
      '## Postlude',
    ].join('\n');
    const items = extractToc(src);
    expect(items.map((i) => i.text)).toEqual(['Prelude', 'Body', 'Postlude']);
  });
});
