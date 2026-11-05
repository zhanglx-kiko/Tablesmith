import Papa from 'papaparse';
import type { RawWorkbook } from './types';

/** Parse CSV / TSV / delimited text into a raw grid; header detection happens in the normalizer. */
export function readDelimited(text: string, sheetName: string, delimiter?: string): RawWorkbook {
  const parsed = Papa.parse<string[]>(text, {
    delimiter: delimiter ?? '',
    delimitersToGuess: [',', '\t', ';', '|'],
    skipEmptyLines: false,
  });
  const notices: string[] = [];
  const quoteError = parsed.errors.find((e) => e.type === 'Quotes');
  if (quoteError) {
    const line = typeof quoteError.row === 'number' ? `第 ${quoteError.row + 1} 行` : '某行';
    notices.push(`${line}的引号没有闭合，该行之后的内容可能被合并到一个单元格中`);
  }
  return {
    sheets: [{ name: sheetName, hidden: false, cells: parsed.data, merges: [], uncachedFormulas: 0 }],
    notices,
  };
}
