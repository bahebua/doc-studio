/*
 * XLSX (Excel Open XML) → Markdown preview.
 *
 * Pure DOM-based parser using the browser's built-in DOMParser — no SheetJS
 * dependency. Handles the common cell types (shared string, number, inline
 * string, formula-string, boolean) which cover ~everything you'd want to
 * preview. Produces one `## Sheet name` heading per worksheet followed by a
 * GitHub-flavored Markdown table.
 */

import type JSZip from 'jszip';

/** Convert a cell reference like `AB12` to a zero-based column index. */
function colFromRef(ref: string): number {
  const m = ref.match(/^([A-Z]+)/i);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file('xl/sharedStrings.xml');
  if (!file) return [];
  const xml = await file.async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return [];
  const sis = Array.from(doc.getElementsByTagNameNS('*', 'si'));
  return sis.map((si) => {
    // A shared string can contain multiple <t> runs (from rich-text
    // formatting). Concatenate their text content in document order.
    const ts = Array.from(si.getElementsByTagNameNS('*', 't'));
    return ts.map((t) => t.textContent ?? '').join('');
  });
}

interface SheetRef {
  path: string;
  name: string;
}

async function readSheetList(zip: JSZip): Promise<SheetRef[]> {
  const wb = zip.file('xl/workbook.xml');
  if (!wb) return fallbackSheetList(zip);

  const wbXml = await wb.async('string');
  const wbDoc = new DOMParser().parseFromString(wbXml, 'application/xml');
  if (wbDoc.getElementsByTagName('parsererror').length) return fallbackSheetList(zip);

  const rels = zip.file('xl/_rels/workbook.xml.rels');
  const relsMap = new Map<string, string>(); // rId → target path
  if (rels) {
    const relsXml = await rels.async('string');
    const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
    Array.from(relsDoc.getElementsByTagNameNS('*', 'Relationship')).forEach((r) => {
      const id = r.getAttribute('Id');
      const target = r.getAttribute('Target');
      if (id && target) relsMap.set(id, target);
    });
  }

  const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const sheets: SheetRef[] = [];
  Array.from(wbDoc.getElementsByTagNameNS('*', 'sheet')).forEach((s, i) => {
    const name = s.getAttribute('name') || `Sheet ${i + 1}`;
    const rid =
      s.getAttributeNS(RELS_NS, 'id') ||
      s.getAttribute('r:id') ||
      s.getAttribute('id') ||
      '';
    const target = relsMap.get(rid);
    if (!target) return;
    // Targets are relative to xl/ — normalize to a full zip path.
    const normalized = target.startsWith('/')
      ? target.slice(1)
      : target.startsWith('xl/')
        ? target
        : `xl/${target}`;
    sheets.push({ path: normalized, name });
  });

  return sheets.length > 0 ? sheets : fallbackSheetList(zip);
}

function fallbackSheetList(zip: JSZip): SheetRef[] {
  return Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const na = parseInt(a.match(/sheet(\d+)/i)?.[1] ?? '0', 10);
      const nb = parseInt(b.match(/sheet(\d+)/i)?.[1] ?? '0', 10);
      return na - nb;
    })
    .map((path, i) => ({ path, name: `Sheet ${i + 1}` }));
}

function parseSheetToMarkdown(xml: string, strings: string[]): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return '_(sheet parse error)_';

  const rows = Array.from(doc.getElementsByTagNameNS('*', 'row'));
  if (rows.length === 0) return '_(empty sheet)_';

  const grid: string[][] = [];
  let maxCol = 0;

  for (const row of rows) {
    const cells = Array.from(row.getElementsByTagNameNS('*', 'c'));
    const rowData: string[] = [];
    for (const c of cells) {
      const ref = c.getAttribute('r') || '';
      const col = ref ? colFromRef(ref) : rowData.length;
      const type = c.getAttribute('t') || 'n';
      let value = '';
      if (type === 's') {
        const v = c.getElementsByTagNameNS('*', 'v')[0];
        const idx = parseInt(v?.textContent ?? '0', 10);
        value = strings[idx] ?? '';
      } else if (type === 'inlineStr') {
        const t = c.getElementsByTagNameNS('*', 't')[0];
        value = t?.textContent ?? '';
      } else if (type === 'b') {
        const v = c.getElementsByTagNameNS('*', 'v')[0];
        value = v?.textContent === '1' ? 'TRUE' : 'FALSE';
      } else {
        // n, str, e (error) — take the literal <v> value.
        const v = c.getElementsByTagNameNS('*', 'v')[0];
        value = v?.textContent ?? '';
      }
      // Pad missing intermediate columns so cells align with their refs.
      while (rowData.length < col) rowData.push('');
      rowData.push(value);
    }
    if (rowData.length > maxCol) maxCol = rowData.length;
    grid.push(rowData);
  }

  if (maxCol === 0) return '_(empty sheet)_';

  // Right-pad rows to the widest row so the markdown table stays rectangular.
  for (const r of grid) while (r.length < maxCol) r.push('');

  // Detect a data-only sheet (no obvious header row) — if the first row is
  // all-numeric we still promote it to the header slot but keep the values,
  // so the reader gets both the numbers and the alignment separator.
  const header = grid[0].map(escapeCell);
  const rest = grid.slice(1);
  const sep = header.map(() => '---');
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rest.map((r) => `| ${r.map(escapeCell).join(' | ')} |`),
  ];
  return lines.join('\n');
}

/**
 * Build a full Markdown preview of an .xlsx workbook. One heading per
 * worksheet, followed by a table of its cells. Empty sheets and errors are
 * rendered in-place so the user can still see the structure of the file.
 */
export async function xlsxToMarkdown(zip: JSZip): Promise<string> {
  const [strings, sheets] = await Promise.all([
    readSharedStrings(zip),
    readSheetList(zip),
  ]);

  if (sheets.length === 0) return '_(no worksheets found)_';

  const out: string[] = [];
  for (const sheet of sheets) {
    const file = zip.file(sheet.path);
    out.push(`## ${sheet.name}`);
    if (!file) {
      out.push('_(sheet file missing)_');
      continue;
    }
    const xml = await file.async('string');
    out.push(parseSheetToMarkdown(xml, strings));
  }
  return out.join('\n\n');
}
