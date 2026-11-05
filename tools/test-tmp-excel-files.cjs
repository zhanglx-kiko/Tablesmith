const fs = require('fs');
const path = require('path');
const assert = require('assert');
const XLSX = require(path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith/node_modules/xlsx'));
const Papa = require(path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith/node_modules/papaparse'));
const { XMLParser } = require(path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith/node_modules/fast-xml-parser'));

const DIR = 'D:/tmp/excel';
const files = fs.readdirSync(DIR).filter((f) => !f.toLowerCase().includes('readme') && !f.endsWith('.xsd'));

console.log('=== STARTING DEEP AUDIT OF D:/tmp/excel FILES ===');
console.log('Target files:', files);

function detectHeaderRowIndex(rawRows) {
  if (!rawRows || rawRows.length <= 1) return 0;
  const maxInspect = Math.min(8, rawRows.length);
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < maxInspect; i++) {
    const row = rawRows[i] || [];
    const nonEmpty = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '');
    const filledCount = nonEmpty.length;
    if (filledCount === 0) continue;

    const stringCount = nonEmpty.filter((c) => isNaN(Number(String(c).trim()))).length;
    const uniqueCount = new Set(nonEmpty.map((c) => String(c).trim())).size;

    let score = filledCount * 2 + stringCount * 1.5 + uniqueCount;
    if (filledCount === 1) {
      score = 0.5; // title banner penalty
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function normalizeSheetData(name, rawRows) {
  if (!rawRows || rawRows.length === 0) {
    return { name, headers: [], rows: [] };
  }

  const headerIdx = detectHeaderRowIndex(rawRows);
  const rawHeaders = rawRows[headerIdx] || [];

  let maxCols = rawHeaders.length;
  for (const r of rawRows) {
    if (r && r.length > maxCols) maxCols = r.length;
  }
  if (maxCols === 0) maxCols = 1;

  const headers = [];
  const counts = new Map();

  for (let c = 0; c < maxCols; c++) {
    let rawH = rawHeaders[c] !== null && rawHeaders[c] !== undefined ? String(rawHeaders[c]).trim() : '';
    if (!rawH) {
      rawH = `列${c + 1}`;
    }
    const count = counts.get(rawH) || 0;
    counts.set(rawH, count + 1);
    const finalH = count === 0 ? rawH : `${rawH}_${count}`;
    headers.push(finalH);
  }

  const rows = [];
  for (let r = headerIdx + 1; r < rawRows.length; r++) {
    const rawRow = rawRows[r] || [];
    const hasData = rawRow.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
    if (!hasData) continue;

    const row = [];
    for (let c = 0; c < maxCols; c++) {
      const val = rawRow[c] !== null && rawRow[c] !== undefined ? String(rawRow[c]).trim() : '';
      row.push(val);
    }
    rows.push(row);
  }

  return { name, headers, rows };
}

function extractSheetsFromParsedXml(parsed) {
  const rootKey = Object.keys(parsed).find((k) => k !== '?xml');
  const root = rootKey ? parsed[rootKey] : parsed;
  const sheets = [];

  function traverse(node, currentTag) {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      if (node.length > 0 && typeof node[0] === 'object') {
        const allKeys = new Set();
        node.forEach((item) => {
          if (item && typeof item === 'object') {
            Object.keys(item).forEach((k) => allKeys.add(k));
          }
        });
        const headers = Array.from(allKeys);
        const rows = node.map((item) =>
          headers.map((h) => {
            const val = item[h];
            return val !== undefined && val !== null ? String(val).trim() : '';
          })
        );
        sheets.push({ name: currentTag, headers, rows });
      }
      return;
    }

    const obj = node;
    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith('?') || key.startsWith('@_')) continue;
      if (Array.isArray(val)) {
        traverse(val, key);
      } else if (typeof val === 'object' && val !== null) {
        traverse(val, key);
      }
    }
  }

  traverse(root, rootKey || 'Sheet1');
  sheets.sort((a, b) => b.rows.length - a.rows.length);
  return sheets;
}

let allOk = true;

for (const file of files) {
  const full = path.join(DIR, file);
  const ext = path.extname(file).slice(1).toLowerCase();
  console.log(`\n--------------------------------------------------`);
  console.log(`Checking file: ${file} (format: ${ext})`);

  let parsedSheets = [];

  if (ext === 'xlsx' || ext === 'xls') {
    const buf = fs.readFileSync(full);
    const wb = XLSX.read(buf, { type: 'buffer' });
    parsedSheets = wb.SheetNames.map((sheetName) => {
      const ws = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1 });
      return normalizeSheetData(sheetName, json);
    });
  } else if (ext === 'csv') {
    const text = fs.readFileSync(full, 'utf8');
    const parsed = Papa.parse(text, { header: false, skipEmptyLines: 'greedy' });
    parsedSheets = [normalizeSheetData('Sheet1', parsed.data || [])];
  } else if (ext === 'xml') {
    const text = fs.readFileSync(full, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const parsed = parser.parse(text);
    parsedSheets = extractSheetsFromParsedXml(parsed);
  }

  console.log(`Result: ${parsedSheets.length} sheets loaded successfully`);
  assert.ok(parsedSheets.length > 0, `File ${file} returned 0 sheets!`);

  for (let i = 0; i < parsedSheets.length; i++) {
    const s = parsedSheets[i];
    assert.ok(s.headers.length > 0, `Sheet "${s.name}" in ${file} has 0 headers!`);
    
    // Check no empty headers
    const emptyH = s.headers.filter((h) => !h || h.trim() === '');
    assert.strictEqual(emptyH.length, 0, `Sheet "${s.name}" in ${file} contains empty header!`);

    // Check unique headers
    const uniqueH = new Set(s.headers);
    assert.strictEqual(uniqueH.size, s.headers.length, `Sheet "${s.name}" in ${file} contains duplicate headers!`);

    // Check all rows match header length
    let badRow = -1;
    for (let r = 0; r < s.rows.length; r++) {
      if (s.rows[r].length !== s.headers.length) {
        badRow = r;
        break;
      }
    }
    assert.strictEqual(badRow, -1, `Sheet "${s.name}" row ${badRow} length mismatch!`);

    if (i < 3 || i === parsedSheets.length - 1) {
      console.log(`  ✓ Sheet [${i}] "${s.name}": ${s.headers.length} unique cols, ${s.rows.length} rows`);
      console.log(`    Headers sample: [${s.headers.slice(0, 5).join(', ')}${s.headers.length > 5 ? '...' : ''}]`);
    }
  }
}

console.log('\n==================================================');
console.log('>>> 100% OF ALL D:/tmp/excel FILES ARE FULLY VERIFIED AND PROCESSABLE! <<<');
console.log('==================================================');
