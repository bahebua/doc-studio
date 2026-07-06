/**
 * Auto-wrap raw Mermaid source in fenced code blocks so the preview
 * renders diagrams even when the user didn't type ```` ```mermaid ```` ```` ``` ````
 * fences. This matches how Doc Studio's editor already auto-detects
 * JSON/XML/HTML by content — the user shouldn't need to know about the
 * fence syntax to see a diagram.
 *
 * Rules:
 *   1. If the trimmed doc starts with a known Mermaid directive
 *      (`sequenceDiagram`, `flowchart`, `graph`, `classDiagram`,
 *      `stateDiagram`, `erDiagram`, `journey`, `gantt`, `pie`,
 *      `gitGraph`, `mindmap`, `quadrantChart`, `xychart-beta`, `sankey`,
 *      `requirementDiagram`, `C4Context`/`Container`/`Component`/etc.,
 *      `timeline`, `block-beta`, `architecture-beta`, `packet-beta`),
 *      the whole document is treated as a single Mermaid diagram.
 *
 *   2. A common paste-pattern is a stray `title Foo` line ABOVE the
 *      directive — that's not valid Mermaid, but the intent is obvious.
 *      We detect it and move it inside the diagram right after the
 *      directive keyword so Mermaid renders it as the diagram title.
 *
 *   3. YAML frontmatter (`--- ... ---`) at the top is left alone;
 *      Mermaid v11 parses it natively.
 *
 * Anything that doesn't match falls through to the standard Markdown
 * pipeline, so a doc with just a paragraph starting with the word
 * "flowchart" won't get accidentally converted (we require the line to
 * BE the directive, not just contain the word).
 */
const MERMAID_DIRECTIVE = new RegExp(
  '^(?:' +
    [
      'sequenceDiagram',
      'flowchart(?:\\s+(?:TB|TD|BT|LR|RL))?',
      'graph(?:\\s+(?:TB|TD|BT|LR|RL))?',
      'classDiagram(?:-v2)?',
      'stateDiagram(?:-v2)?',
      'erDiagram',
      'journey',
      'gantt',
      'pie(?:\\s+title\\b.*)?',
      'gitGraph',
      'mindmap',
      'quadrantChart',
      'xychart-beta',
      'sankey(?:-beta)?',
      'requirementDiagram',
      'C4Context',
      'C4Container',
      'C4Component',
      'C4Dynamic',
      'C4Deployment',
      'timeline',
      'block-beta',
      'architecture-beta',
      'packet-beta',
      'zenuml',
    ].join('|') +
    ')\\b',
);

/**
 * True when the whole document is a single Mermaid diagram in disguise.
 * Consumers use this to skip Markdown rendering entirely.
 */
export function looksLikeMermaid(source: string): boolean {
  if (!source) return false;
  const trimmed = source.trim();
  if (!trimmed) return false;
  // Skip YAML frontmatter block if present so we can peek at the real body.
  const withoutFrontmatter = stripFrontmatter(trimmed);
  const [first, second] = withoutFrontmatter.split('\n', 2).map((l) => l.trim());
  if (first && MERMAID_DIRECTIVE.test(first)) return true;
  // Case: stray `title X` line, then the actual directive.
  if (first && /^title\s+\S/.test(first) && second && MERMAID_DIRECTIVE.test(second)) {
    return true;
  }
  return false;
}

/**
 * Normalise raw Mermaid source: relocate a leading `title X` line into
 * the diagram body if the user put it above the directive.
 */
export function normalizeMermaid(source: string): string {
  const trimmed = source.trim();
  const body = stripFrontmatter(trimmed);
  const lines = body.split(/\r?\n/);
  if (lines.length < 2) return body;
  const first = lines[0].trim();
  const second = lines[1].trim();
  if (/^title\s+\S/.test(first) && MERMAID_DIRECTIVE.test(second)) {
    const title = first;
    const rest = lines.slice(1);
    // Insert the title as the second line so it sits right after the
    // directive — Mermaid renders it as the diagram title.
    rest.splice(1, 0, '    ' + title);
    return rest.join('\n');
  }
  return body;
}

/**
 * Wrap raw Mermaid source in a fenced code block so the standard
 * Markdown renderer hands it off to our MermaidBlock component.
 */
export function wrapAsMermaidFence(source: string): string {
  return '```mermaid\n' + normalizeMermaid(source) + '\n```\n';
}

/**
 * Strip a leading YAML frontmatter block (`--- ... ---`) if present.
 * Returns the source unchanged when no frontmatter is found.
 */
function stripFrontmatter(source: string): string {
  if (!source.startsWith('---')) return source;
  const end = source.indexOf('\n---', 3);
  if (end === -1) return source;
  const after = source.slice(end + 4);
  return after.replace(/^\r?\n/, '');
}
