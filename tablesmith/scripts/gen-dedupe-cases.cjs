// Generate sample-data/edge-cases/dedupe_variants.csv: rows that look alike in the ways
// real exports differ (case, number spelling, spaces, blanks, dates, leading zeros), for
// checking dedupe against desktop Excel's Remove Duplicates (scripts/excel-dedupe-reference.ps1).
// Column "id" is a unique row id and is not compared.
const fs = require('fs');
const path = require('path');

// Seeded RNG so the file is reproducible.
let seed = 20261106;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];

const groups = [
  ['Alice', 'alice', 'ALICE', 'Alice ', ' Alice', 'Alicé'],
  ['1', '1.0', '1.00', '01', '+1', '1e0', '1,000', '1000'],
  ['0.1', '.1', '0.10', '10%', '0.100000000000000001'],
  ['2024-01-31', '2024/1/31', '2024-1-31', '31/01/2024'],
  ['', ' ', '""'],
  ['00123', '123', '0123'],
  ['TRUE', 'true', 'True', '1'],
  ['北京', '北京 ', '北京市'],
  ['$1,200', '1200', '1,200', '1200.00'],
  ['-5', '(5)', '-5.0', '- 5'],
];

const rows = [];
let id = 0;
for (const g of groups) {
  for (const a of g) for (const b of ['x', 'X', 'y']) rows.push([a, b]);
}
// Random mix on top, so order and repeats are not hand-picked.
for (let i = 0; i < 400; i++) rows.push([pick(pick(groups)), pick(['x', 'X', 'y', 'Y', ''])]);

const q = (v) => (/[",\n]/.test(v) || v.startsWith(' ') || v.endsWith(' ') ? `"${v.replace(/"/g, '""')}"` : v);
const lines = ['id,value,tag', ...rows.map((r) => [String(id++), ...r].map(q).join(','))];
const out = path.join(__dirname, '../sample-data/edge-cases/dedupe_variants.csv');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${out} (${rows.length} rows)`);
