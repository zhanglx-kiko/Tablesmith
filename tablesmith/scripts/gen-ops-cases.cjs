// Generate sample-data/edge-cases/ops_variants.csv for checking computed columns and
// row filters against desktop Excel (scripts/excel-ops-reference.ps1): the operands a
// real export holds (formatted numbers, percentages, accounting negatives, blanks, text,
// spaces, dates, huge and tiny values). Column "id" is a unique row id.
const fs = require('fs');
const path = require('path');

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];

const values = [
  '0', '1', '-1', '2.5', '0.1', '0.2', '100', '1000', '1,000', '1,234.56', '$30', '-$30', '(5)', '10%', '12.5%',
  '', ' ', 'n/a', 'abc', ' 7 ', '1e3', '1E-3', '+4', '00123', '9007199254740993', '1e308', '0.000001',
  '-0', '3.14159265358979', '7/0', 'TRUE', '#N/A',
];
const dates = ['2024-01-31', '2024-06-30', '2024-07-01', '2024/12/31', '2023-12-31', '2024-02-29', '', 'n/a', '2024-06-30 13:45:00'];

const rows = [];
for (const a of values) for (const b of ['2', '0', '', 'x', '0.1', '(3)', '50%']) rows.push([a, b, pick(dates)]);
for (let i = 0; i < 300; i++) rows.push([pick(values), pick(values), pick(dates)]);

const q = (v) => (/[",\n]/.test(v) || v.startsWith(' ') || v.endsWith(' ') ? `"${v.replace(/"/g, '""')}"` : v);
const lines = ['id,a,b,d', ...rows.map((r, i) => [String(i), ...r].map(q).join(','))];
const out = path.join(__dirname, '../sample-data/edge-cases/ops_variants.csv');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${out} (${rows.length} rows)`);
