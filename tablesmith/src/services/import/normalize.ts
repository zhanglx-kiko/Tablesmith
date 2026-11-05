import type { SheetData } from '../../types';
import { cellKind, cellToText } from './cellText';
import { isDateCell, type GridCell, type MergeRange, type RawSheet, type RawWorkbook } from './types';

/** Header search looks at this many non-empty rows from the top of a table block. */
const HEADER_SCAN_ROWS = 12;
const MAX_HEADER_ROWS = 3;
/** A header row must be at least this full compared to the widest nearby row. */
const HEADER_MIN_FILL = 0.6;
const BLOCK_TITLE_MAX = 24;

interface RowProfile {
  filled: number;
  labels: number;
  dates: number;
  yearLike: number;
  numbers: number;
}

interface Block {
  title: string;
  headerStart: number;
  headerCount: number;
  dataStart: number;
  /** First row of trailing notes ("数据来源：…") that belong to the block but not to its data. */
  footerStart: number;
  end: number;
}

export interface NormalizedWorkbook {
  sheets: SheetData[];
  notices: string[];
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Make header names unique and non-empty: duplicates become `name_2`, `name_3`. */
export function uniqueHeaders(raw: string[]): string[] {
  const used = new Set<string>();
  return raw.map((name) => {
    let candidate = name;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${name}_${n}`;
      n += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

function isYearLike(cell: GridCell): boolean {
  if (typeof cell === 'number') return Number.isInteger(cell) && cell >= 1900 && cell <= 2100;
  if (typeof cell === 'string') return /^\s*(19|20)\d{2}\s*$/.test(cell);
  return false;
}

function profileRow(row: GridCell[]): RowProfile {
  const p: RowProfile = { filled: 0, labels: 0, dates: 0, yearLike: 0, numbers: 0 };
  for (const cell of row) {
    const kind = cellKind(cell);
    if (kind === 'empty') continue;
    p.filled += 1;
    if (kind === 'label') p.labels += 1;
    else if (kind === 'date') p.dates += 1;
    else if (isYearLike(cell)) p.yearLike += 1;
    else p.numbers += 1;
  }
  return p;
}

/** Labels, dates and plain years only, with at least one label: "Month | Jan-24 | Feb-24". */
function isHeaderLike(p: RowProfile, width: number): boolean {
  if (p.numbers > 0 || p.labels === 0) return false;
  return p.filled >= 2 || width === 1;
}

/** A single text cell on its own row, e.g. a report title such as "Revenue Build". */
function isBanner(p: RowProfile): boolean {
  return p.filled === 1 && p.labels === 1;
}

/** Copy the anchor value of vertically merged ranges into the cells below it. */
function fillVerticalMerges(rows: GridCell[][], merges: MergeRange[]): void {
  for (const [r1, c1, r2] of merges) {
    if (r2 <= r1) continue;
    const anchor = rows[r1]?.[c1] ?? null;
    if (anchor === null) continue;
    for (let r = r1 + 1; r <= r2 && r < rows.length; r += 1) {
      const row = rows[r];
      if (row && (row[c1] === null || row[c1] === undefined || row[c1] === '')) row[c1] = anchor;
    }
  }
}

function nextNonEmpty(profiles: RowProfile[], from: number, end: number): number {
  for (let i = from; i < end; i += 1) {
    if (profiles[i].filled > 0) return i;
  }
  return -1;
}

function findHeader(profiles: RowProfile[], width: number, start: number, end: number): number {
  const window: number[] = [];
  for (let i = start; i < end && window.length < HEADER_SCAN_ROWS; i += 1) {
    if (profiles[i].filled > 0) window.push(i);
  }
  const maxFilled = window.reduce((m, i) => Math.max(m, profiles[i].filled), 0);
  const minFill = Math.ceil(maxFilled * HEADER_MIN_FILL);
  for (const i of window) {
    const p = profiles[i];
    if (p.filled < minFill) continue;
    if (isHeaderLike(p, width)) return i;
    // A full row with real numbers before any header means the table has no header.
    if (p.numbers > 0) return -1;
  }
  return -1;
}

function hasMergeEvidence(merges: MergeRange[], row: number, nextRow: number, width: number): boolean {
  return merges.some(([r1, c1, r2, c2]) => {
    const horizontal = r1 === row && c2 > c1 && !(c1 === 0 && c2 >= width - 1);
    const vertical = r1 <= row && r2 >= nextRow;
    return horizontal || vertical;
  });
}

function countHeaderRows(
  profiles: RowProfile[],
  merges: MergeRange[],
  width: number,
  header: number,
  end: number,
): number {
  let count = 1;
  while (count < MAX_HEADER_ROWS) {
    const next = header + count;
    if (next >= end || profiles[next].filled === 0 || !isHeaderLike(profiles[next], width)) break;
    if (!hasMergeEvidence(merges, next - 1, next, width)) break;
    count += 1;
  }
  return count;
}

function findBlockEnd(profiles: RowProfile[], width: number, from: number, end: number): number {
  for (let j = from; j < end; j += 1) {
    if (profiles[j].filled > 0) continue;
    const k = nextNonEmpty(profiles, j, end);
    if (k === -1) return end;
    if (isBanner(profiles[k])) {
      const m = nextNonEmpty(profiles, k + 1, end);
      if (m !== -1 && isHeaderLike(profiles[m], width) && profiles[m].filled >= 2) return j;
    } else if (k - j >= 2 && isHeaderLike(profiles[k], width)) {
      const m = nextNonEmpty(profiles, k + 1, end);
      if (m !== -1 && profiles[m].numbers > 0) return j;
    }
  }
  return end;
}

/** A lone text cell merged across most of the width, e.g. a source or footnote line. */
function isNoteRow(profiles: RowProfile[], merges: MergeRange[], width: number, r: number): boolean {
  if (!isBanner(profiles[r])) return false;
  return merges.some(([r1, c1, r2, c2]) => r1 <= r && r2 >= r && c2 - c1 + 1 >= Math.max(2, width / 2));
}

function findFooterStart(
  profiles: RowProfile[],
  merges: MergeRange[],
  width: number,
  dataStart: number,
  end: number,
): number {
  let footer = end;
  for (let r = end - 1; r >= dataStart; r -= 1) {
    if (profiles[r].filled === 0) continue;
    if (!isNoteRow(profiles, merges, width, r)) break;
    footer = r;
  }
  return footer;
}

function segment(profiles: RowProfile[], merges: MergeRange[], width: number): Block[] {
  const blocks: Block[] = [];
  const n = profiles.length;
  let i = nextNonEmpty(profiles, 0, n);
  while (i !== -1) {
    const header = findHeader(profiles, width, i, n);
    const headerStart = header === -1 ? i : header;
    const headerCount = header === -1 ? 0 : countHeaderRows(profiles, merges, width, header, n);
    const dataStart = headerStart + headerCount;
    const end = findBlockEnd(profiles, width, dataStart, n);
    const footerStart = findFooterStart(profiles, merges, width, dataStart, end);
    blocks.push({ title: '', headerStart, headerCount, dataStart, footerStart, end });
    i = nextNonEmpty(profiles, end, n);
  }
  return blocks;
}

function blockTitle(rows: GridCell[][], profiles: RowProfile[], from: number, to: number): string {
  for (let r = to - 1; r >= from; r -= 1) {
    if (isBanner(profiles[r])) {
      const cell = rows[r].find((c) => cellKind(c) !== 'empty') ?? null;
      return cellToText(cell).trim();
    }
  }
  return '';
}

/** Month columns ("2024-01-01", "2024-02-01", ...) read better as "2024-01". */
function headerDateStyle(row: GridCell[]): 'month' | 'full' {
  const dates = row.filter(isDateCell);
  if (dates.length < 2) return 'full';
  return dates.every((d) => /^\d{4}-\d{2}-01$/.test(d.date)) ? 'month' : 'full';
}

function headerCellText(cell: GridCell, style: 'month' | 'full'): string {
  if (isDateCell(cell) && style === 'month') return cell.date.slice(0, 7);
  return cellToText(cell).replace(/\s+/g, ' ').trim();
}

function buildHeaderParts(
  rows: GridCell[][],
  merges: MergeRange[],
  block: Block,
  width: number,
): string[][] {
  const parts: string[][] = Array.from({ length: width }, () => []);
  for (let r = block.headerStart; r < block.headerStart + block.headerCount; r += 1) {
    const row = rows[r];
    const style = headerDateStyle(row);
    const texts = row.map((cell) => headerCellText(cell, style));
    for (const [r1, c1, r2, c2] of merges) {
      if (r < r1 || r > r2 || c2 <= c1) continue;
      for (let c = c1 + 1; c <= c2 && c < width; c += 1) {
        if (!texts[c]) texts[c] = texts[c1] || headerCellText(rows[r1]?.[c1] ?? null, style);
      }
    }
    texts.forEach((t, c) => {
      const list = parts[c];
      if (t && list[list.length - 1] !== t) list.push(t);
    });
  }
  return parts;
}

function blockToSheet(
  rows: GridCell[][],
  merges: MergeRange[],
  block: Block,
  width: number,
  name: string,
): SheetData {
  const headerParts = buildHeaderParts(rows, merges, block, width);
  const dataRows: GridCell[][] = [];
  for (let r = block.dataStart; r < block.footerStart; r += 1) {
    if (rows[r].some((c) => cellKind(c) !== 'empty')) dataRows.push(rows[r]);
  }

  const keep: number[] = [];
  for (let c = 0; c < width; c += 1) {
    if (headerParts[c].length > 0 || dataRows.some((row) => cellKind(row[c] ?? null) !== 'empty')) {
      keep.push(c);
    }
  }

  const headers = uniqueHeaders(
    keep.map((c) => (headerParts[c].length > 0 ? headerParts[c].join(' / ') : `列${columnLetter(c)}`)),
  );
  return {
    name,
    headers,
    rows: dataRows.map((row) => keep.map((c) => cellToText(row[c] ?? null))),
  };
}

export function normalizeSheet(sheet: RawSheet, notes: string[] = []): SheetData[] {
  const width = sheet.cells.reduce((m, row) => Math.max(m, row.length), 0);
  if (width === 0) return [];
  const rows = sheet.cells.map((row) => {
    const copy = row.slice();
    while (copy.length < width) copy.push(null);
    return copy;
  });
  fillVerticalMerges(rows, sheet.merges);
  const profiles = rows.map(profileRow);
  const blocks = segment(profiles, sheet.merges, width);

  const tables: SheetData[] = [];
  let previousEnd = 0;
  blocks.forEach((block, idx) => {
    const title = blockTitle(rows, profiles, previousEnd, block.headerStart);
    const skipped: string[] = [];
    for (let r = previousEnd; r < block.headerStart; r += 1) {
      if (profiles[r].filled >= 2) {
        skipped.push(rows[r].filter((c) => cellKind(c) !== 'empty').map(cellToText).join(' '));
      }
    }
    if (skipped.length > 0) {
      notes.push(`${sheet.name}：表头上方的说明行未作为数据导入（${skipped.join('；')}）`);
    }
    previousEnd = block.end;
    let name = sheet.name;
    if (idx > 0) {
      const label = title.length > BLOCK_TITLE_MAX ? `${title.slice(0, BLOCK_TITLE_MAX)}…` : title;
      name = `${sheet.name} · ${label || `表${idx + 1}`}`;
    }
    const table = blockToSheet(rows, sheet.merges, block, width, name);
    if (table.headers.length > 0) tables.push(table);
    for (let r = block.footerStart; r < block.end; r += 1) {
      const note = rows[r].find((c) => cellKind(c) !== 'empty') ?? null;
      if (note !== null) notes.push(`${sheet.name}：表尾说明“${cellToText(note).trim()}”未作为数据行导入`);
    }
  });
  return tables;
}

export function normalizeWorkbook(workbook: RawWorkbook): NormalizedWorkbook {
  const notices = [...workbook.notices];
  const sheets: SheetData[] = [];
  const skipped: string[] = [];
  const hidden: string[] = [];
  let uncached = 0;

  for (const raw of workbook.sheets) {
    const tables = normalizeSheet(raw, notices);
    if (tables.length === 0) {
      skipped.push(raw.name);
      continue;
    }
    if (raw.hidden) hidden.push(raw.name);
    uncached += raw.uncachedFormulas;
    sheets.push(...tables);
  }

  const names = uniqueHeaders(sheets.map((s) => s.name));
  sheets.forEach((s, i) => {
    s.name = names[i];
  });

  if (hidden.length > 0) notices.push(`包含隐藏工作表：${hidden.join('、')}`);
  if (skipped.length > 0) notices.push(`已跳过空白工作表：${skipped.join('、')}`);
  if (uncached > 0) {
    notices.push(
      `${uncached} 个公式单元格没有保存计算结果，显示为空。在 Excel 中打开并保存一次后重新导入即可显示数值。`,
    );
  }
  return { sheets, notices };
}
