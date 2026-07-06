import { describe, it, expect } from 'vitest';
import { detectLanguage, guessFileExtension } from './languageDetect';

describe('detectLanguage', () => {
  it('returns null for very short input', () => {
    expect(detectLanguage('hi')).toBeNull();
    expect(detectLanguage('')).toBeNull();
  });

  it('detects an XML declaration', () => {
    expect(detectLanguage('<?xml version="1.0"?><root><a/></root>')).toBe('xml');
  });

  it('detects a non-html DOCTYPE as xml', () => {
    expect(detectLanguage('<!DOCTYPE greeting SYSTEM "hello.dtd"><greeting>Hi</greeting>')).toBe(
      'xml',
    );
  });

  it('detects an html DOCTYPE', () => {
    expect(detectLanguage('<!DOCTYPE html><html><body>Hello world</body></html>')).toBe('html');
  });

  it('detects a bare <html> root', () => {
    expect(detectLanguage('<html><body>Hello world content</body></html>')).toBe('html');
  });

  it('detects an object JSON payload', () => {
    expect(detectLanguage('{"name": "example", "count": 42}')).toBe('json');
  });

  it('detects an array JSON payload', () => {
    expect(detectLanguage('[{"id": 1}, {"id": 2}]')).toBe('json');
  });

  it('does not fire on JSON-shaped but invalid content', () => {
    expect(detectLanguage('{ not really json but long enough }')).toBeNull();
  });

  it('does not fire on primitive JSON literals', () => {
    // Bare number is technically JSON but almost never intent.
    expect(detectLanguage('42        (a very lonely primitive)')).toBeNull();
  });

  it('leaves prose alone (no detection)', () => {
    expect(
      detectLanguage('This is a regular paragraph of prose that should stay markdown.'),
    ).toBeNull();
  });
});

describe('guessFileExtension', () => {
  it('returns the direct extension for concrete languages', () => {
    expect(guessFileExtension('<html></html>', 'html')).toBe('html');
    expect(guessFileExtension('{}', 'json')).toBe('json');
    expect(guessFileExtension('<root/>', 'xml')).toBe('xml');
  });

  it('returns md for plain markdown content', () => {
    expect(guessFileExtension('# Hello\n\nWorld.', 'markdown')).toBe('md');
  });

  it('returns tex when the markdown buffer actually holds LaTeX', () => {
    const latex = String.raw`\documentclass{article}
\begin{document}
Hello \LaTeX.
\end{document}`;
    expect(guessFileExtension(latex, 'markdown')).toBe('tex');
  });

  it('returns tex for LaTeX-heavy content without \\documentclass', () => {
    const latex = String.raw`\section{Intro}
\subsection{Background}
Some \textbf{bold} text with \emph{emphasis} and \item lists.
\begin{itemize}
  \item one
  \item two
\end{itemize}`;
    expect(guessFileExtension(latex, 'markdown')).toBe('tex');
  });
});
