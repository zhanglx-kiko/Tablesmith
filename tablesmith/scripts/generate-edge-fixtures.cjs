// Converts sample-data/edge-cases/report_layouts.xlsx into legacy / alternative
// spreadsheet containers (xls, xlsb, ods) so both import paths are exercised.
// Run from the tablesmith directory after generate-edge-fixtures.py:
//   node scripts/generate-edge-fixtures.cjs
const path = require('path');
const XLSX = require('xlsx');

const dir = path.resolve(process.argv[2] || 'sample-data/edge-cases');
const wb = XLSX.readFile(path.join(dir, 'report_layouts.xlsx'), { cellDates: false, cellNF: true });

// Legacy containers only need a representative subset of sheets.
const keep = ['区域销售', '类型样例', '重复表头'];
const subset = XLSX.utils.book_new();
for (const name of keep) {
  XLSX.utils.book_append_sheet(subset, wb.Sheets[name], name);
}

for (const bookType of ['xls', 'xlsb', 'ods']) {
  const out = path.join(dir, `report_layouts.${bookType}`);
  XLSX.writeFile(subset, out, { bookType, cellStyles: true });
  console.log('wrote', out);
}
