// Turn a full scripts/excel-reference.ps1 dump into the compact reference committed under
// sample-data/excel-reference/: one [row, col, value, format, text, type] tuple per cell.
// Usage: node scripts/compact-excel-reference.cjs <full.json> <out.json>
const fs = require('fs');

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: node scripts/compact-excel-reference.cjs <full.json> <out.json>');
  process.exit(2);
}
const full = JSON.parse(fs.readFileSync(src, 'utf8').replace(/^﻿/, ''));
const compact = {
  file: full.file,
  sheets: full.sheets.map((s) => ({
    name: s.name,
    cells: (Array.isArray(s.cells) ? s.cells : [s.cells]).map((c) => [c.r, c.c, c.value, c.format, c.text, c.type]),
  })),
};
fs.writeFileSync(out, JSON.stringify(compact));
console.log(`wrote ${out} (${compact.sheets.reduce((n, s) => n + s.cells.length, 0)} cells)`);
