const assert = require('assert');

// 1. Test Number Parsing
function parseNumericCell(val) {
  if (typeof val === 'number') {
    return isFinite(val) ? val : NaN;
  }
  if (val === null || val === undefined) return NaN;
  let str = String(val).trim();
  if (!str) return NaN;

  let isNegative = false;
  if (/^\(.*\)$/.test(str)) {
    isNegative = true;
    str = str.slice(1, -1).trim();
  } else if (str.startsWith('-')) {
    isNegative = true;
    str = str.slice(1).trim();
  } else if (str.startsWith('+')) {
    str = str.slice(1).trim();
  }

  str = str.replace(/[\$¥￥€£₩฿]/g, '').trim();
  str = str.replace(/,/g, '');

  if (str.endsWith('%')) {
    str = str.slice(0, -1).trim();
  }

  const num = parseFloat(str);
  if (isNaN(num)) return NaN;
  return isNegative ? -num : num;
}

console.log('--- Test Suite 1: parseNumericCell ---');
assert.strictEqual(parseNumericCell(42), 42);
assert.strictEqual(parseNumericCell('4,200'), 4200);
assert.strictEqual(parseNumericCell('$5,100.50'), 5100.5);
assert.strictEqual(parseNumericCell('¥12,800'), 12800);
assert.strictEqual(parseNumericCell('￥8,888.88'), 8888.88);
assert.strictEqual(parseNumericCell('€3,400'), 3400);
assert.strictEqual(parseNumericCell('£9,999'), 9999);
assert.strictEqual(parseNumericCell('(1,500)'), -1500);
assert.strictEqual(parseNumericCell('($2,340.50)'), -2340.5);
assert.strictEqual(parseNumericCell('-$250.75'), -250.75);
assert.strictEqual(parseNumericCell('+120'), 120);
assert.strictEqual(parseNumericCell('25.5%'), 25.5);
assert.ok(isNaN(parseNumericCell('invalid')));
assert.ok(isNaN(parseNumericCell('')));
assert.ok(isNaN(parseNumericCell(null)));
console.log('✓ All 15 parseNumericCell assertions passed!');

// 2. Test Filter Algorithm with Currency & Thousands
function filterRows(sheet, conditions, matchType = 'all') {
  if (conditions.length === 0) return { result: sheet, matchCount: sheet.rows.length };
  const newRows = sheet.rows.filter((row) => {
    const testCondition = (c) => {
      const colIdx = sheet.headers.indexOf(c.column);
      if (colIdx < 0) return true;
      const cellVal = String(row[colIdx] ?? '').trim();
      const targetVal = c.value.trim();

      switch (c.operator) {
        case 'equals': return cellVal.toLowerCase() === targetVal.toLowerCase();
        case 'notEquals': return cellVal.toLowerCase() !== targetVal.toLowerCase();
        case 'contains': return cellVal.toLowerCase().includes(targetVal.toLowerCase());
        case 'notContains': return !cellVal.toLowerCase().includes(targetVal.toLowerCase());
        case 'isEmpty': return cellVal === '';
        case 'isNotEmpty': return cellVal !== '';
        case 'greaterThan': {
          const num = parseNumericCell(cellVal);
          const target = parseNumericCell(targetVal);
          return !isNaN(num) && !isNaN(target) && num > target;
        }
        case 'lessThan': {
          const num = parseNumericCell(cellVal);
          const target = parseNumericCell(targetVal);
          return !isNaN(num) && !isNaN(target) && num < target;
        }
        case 'greaterThanOrEqual': {
          const num = parseNumericCell(cellVal);
          const target = parseNumericCell(targetVal);
          return !isNaN(num) && !isNaN(target) && num >= target;
        }
        case 'lessThanOrEqual': {
          const num = parseNumericCell(cellVal);
          const target = parseNumericCell(targetVal);
          return !isNaN(num) && !isNaN(target) && num <= target;
        }
        default: return true;
      }
    };
    return matchType === 'all' ? conditions.every(testCondition) : conditions.some(testCondition);
  });
  return { result: { ...sheet, rows: newRows }, matchCount: newRows.length };
}

console.log('\n--- Test Suite 2: filterRows with Formatted Currency ---');
const sampleSheet = {
  name: 'Sales',
  headers: ['Quarter', 'Revenue', 'Status'],
  rows: [
    ['2025-Q1', '$4,200', 'Done'],
    ['2025-Q2', '$5,100', 'Done'],
    ['2025-Q3', '$6,300', 'Pending'],
    ['2025-Q4', '$7,800', 'Done'],
    ['2026-Q1', '¥12,800', 'Done']
  ]
};

// Filter > 5000: should match $5,100, $6,300, $7,800, ¥12,800 (4 rows)
const f1 = filterRows(sampleSheet, [{ id: '1', column: 'Revenue', operator: 'greaterThan', value: '5000' }]);
assert.strictEqual(f1.matchCount, 4);
assert.strictEqual(f1.result.rows[0][0], '2025-Q2');

// Filter <= 5100: should match $4,200, $5,100 (2 rows)
const f2 = filterRows(sampleSheet, [{ id: '2', column: 'Revenue', operator: 'lessThanOrEqual', value: '5,100' }]);
assert.strictEqual(f2.matchCount, 2);
assert.strictEqual(f2.result.rows[0][1], '$4,200');
assert.strictEqual(f2.result.rows[1][1], '$5,100');

console.log('✓ All filterRows currency & thousand assertions passed!');

// 3. Test Computed Column (+, -, *, /, DIV/0)
function addComputedColumn(sheet, config) {
  if (!config.name || sheet.headers.includes(config.name)) return sheet;
  const idxA = sheet.headers.indexOf(config.colA);
  const idxB = config.colB ? sheet.headers.indexOf(config.colB) : -1;
  const newHeaders = [...sheet.headers, config.name];
  const newRows = sheet.rows.map((row) => {
    const valA = row[idxA] ?? '';
    const valB = idxB >= 0 ? row[idxB] ?? '' : '';
    let computedVal = '';

    if (config.type === 'calc') {
      const numA = parseNumericCell(valA);
      const numB = parseNumericCell(valB);
      if (!isNaN(numA) && !isNaN(numB)) {
        switch (config.operator) {
          case '+': computedVal = String(Number((numA + numB).toFixed(4))); break;
          case '-': computedVal = String(Number((numA - numB).toFixed(4))); break;
          case '*': computedVal = String(Number((numA * numB).toFixed(4))); break;
          case '/': computedVal = numB !== 0 ? String(Number((numA / numB).toFixed(4))) : '#DIV/0!'; break;
          default: computedVal = '';
        }
      }
    } else if (config.type === 'combine') {
      computedVal = `${valA}${config.separator ?? ' '}${valB}`;
    } else if (config.type === 'prefixSuffix') {
      computedVal = `${config.prefix ?? ''}${valA}${config.suffix ?? ''}`;
    }
    return [...row, computedVal];
  });
  return { ...sheet, headers: newHeaders, rows: newRows };
}

console.log('\n--- Test Suite 3: addComputedColumn ---');
const calcSheet = {
  name: 'Calc',
  headers: ['Item', 'Price', 'Qty'],
  rows: [
    ['A', '$4,200', '2'],
    ['B', '1,500', '0']
  ]
};

// Multiply Price * Qty
const resMult = addComputedColumn(calcSheet, {
  name: 'Total',
  type: 'calc',
  colA: 'Price',
  colB: 'Qty',
  operator: '*'
});
assert.strictEqual(resMult.rows[0][3], '8400'); // 4200 * 2 = 8400
assert.strictEqual(resMult.rows[1][3], '0');    // 1500 * 0 = 0

// Divide Price / Qty (with Division by Zero)
const resDiv = addComputedColumn(calcSheet, {
  name: 'UnitPrice',
  type: 'calc',
  colA: 'Price',
  colB: 'Qty',
  operator: '/'
});
assert.strictEqual(resDiv.rows[0][3], '2100');
assert.strictEqual(resDiv.rows[1][3], '#DIV/0!'); // division by 0 handled safely!

console.log('✓ All addComputedColumn arithmetic and DIV/0 assertions passed!');

// 4. Test Data Masking
function maskColumnData(sheet, targetColumn, maskType) {
  const colIdx = sheet.headers.indexOf(targetColumn);
  if (colIdx < 0) return { result: sheet, maskedCount: 0 };
  let maskedCount = 0;
  const newRows = sheet.rows.map((row) => {
    const rawVal = row[colIdx];
    if (!rawVal || rawVal.trim() === '') return row;
    const val = rawVal.trim();
    let masked = val;
    switch (maskType) {
      case 'phone':
        if (/^\d{11}$/.test(val)) {
          masked = val.slice(0, 3) + '****' + val.slice(7);
          maskedCount++;
        } else if (val.length >= 7) {
          const mid = Math.floor(val.length / 2);
          masked = val.slice(0, mid - 2) + '****' + val.slice(mid + 2);
          maskedCount++;
        }
        break;
      case 'idcard':
        if (val.length === 18) {
          masked = val.slice(0, 6) + '********' + val.slice(14);
          maskedCount++;
        } else if (val.length >= 8) {
          masked = val.slice(0, 3) + '****' + val.slice(-4);
          maskedCount++;
        }
        break;
      case 'name':
        if (val.length === 2) {
          masked = val[0] + '*';
          maskedCount++;
        } else if (val.length === 3) {
          masked = val[0] + '*' + val[2];
          maskedCount++;
        } else if (val.length > 3) {
          masked = val[0] + '*'.repeat(val.length - 2) + val.slice(-1);
          maskedCount++;
        }
        break;
      case 'email':
        const atIdx = val.indexOf('@');
        if (atIdx > 1) {
          const namePart = val.slice(0, atIdx);
          const domainPart = val.slice(atIdx);
          const maskedName = namePart.length <= 2 ? namePart[0] + '*' : namePart[0] + '***' + namePart.slice(-1);
          masked = maskedName + domainPart;
          maskedCount++;
        }
        break;
    }
    const updated = [...row];
    updated[colIdx] = masked;
    return updated;
  });
  return { result: { ...sheet, rows: newRows }, maskedCount };
}

console.log('\n--- Test Suite 4: maskColumnData ---');
const maskSheet = {
  name: 'Users',
  headers: ['Name', 'Phone', 'ID', 'Email'],
  rows: [
    ['张三', '13812345678', '110101199003072345', 'zhang@example.com'],
    ['李小龙', '13987654321', '310101198501011234', 'alex.dev@domain.cn'],
    ['诸葛孔明', '18600001111', '440101200001015678', 'zhuge@shu.gov']
  ]
};

const resPhone = maskColumnData(maskSheet, 'Phone', 'phone');
assert.strictEqual(resPhone.result.rows[0][1], '138****5678');
assert.strictEqual(resPhone.maskedCount, 3);

const resName = maskColumnData(maskSheet, 'Name', 'name');
assert.strictEqual(resName.result.rows[0][0], '张*');
assert.strictEqual(resName.result.rows[1][0], '李*龙');
assert.strictEqual(resName.result.rows[2][0], '诸**明');

const resID = maskColumnData(maskSheet, 'ID', 'idcard');
assert.strictEqual(resID.result.rows[0][2], '110101********2345');

const resEmail = maskColumnData(maskSheet, 'Email', 'email');
assert.strictEqual(resEmail.result.rows[0][3], 'z***g@example.com');
console.log('✓ All maskColumnData assertions passed!');

// 5. Test Auto-Numbering on Existing File Names
function resolveAutoNumberedFilename(fileStem, extension, existingFiles) {
  const [baseStem, startCounter] = (() => {
    const openParen = fileStem.lastIndexOf(' (');
    if (openParen > 0 && fileStem.endsWith(')')) {
      const numStr = fileStem.slice(openParen + 2, -1);
      const n = parseInt(numStr, 10);
      if (!isNaN(n)) return [fileStem.slice(0, openParen), n + 1];
    }
    return [fileStem, 1];
  })();

  const makeName = (c) => (extension ? `${baseStem} (${c}).${extension}` : `${baseStem} (${c})`);
  const initialName = extension ? `${fileStem}.${extension}` : fileStem;
  if (!existingFiles.has(initialName)) return initialName;

  let counter = startCounter;
  while (true) {
    const candidate = makeName(counter);
    if (!existingFiles.has(candidate)) return candidate;
    counter++;
    if (counter > 1000) throw new Error('Too many duplicates');
  }
}

console.log('\n--- Test Suite 5: resolveAutoNumberedFilename ---');
const existingFiles = new Set(['report.xlsx', 'report (1).xlsx', 'chart.png']);
assert.strictEqual(resolveAutoNumberedFilename('new_doc', 'xlsx', existingFiles), 'new_doc.xlsx');
assert.strictEqual(resolveAutoNumberedFilename('report', 'xlsx', existingFiles), 'report (2).xlsx');
assert.strictEqual(resolveAutoNumberedFilename('report (1)', 'xlsx', existingFiles), 'report (2).xlsx');
assert.strictEqual(resolveAutoNumberedFilename('chart', 'png', existingFiles), 'chart (1).png');
console.log('✓ All resolveAutoNumberedFilename assertions passed!');

console.log('\n=============================================');
console.log('>>> 100% OF ALL DATA PROCESSING ALGORITHMS VERIFIED SUCCESSFULLY! <<<');
console.log('=============================================');
