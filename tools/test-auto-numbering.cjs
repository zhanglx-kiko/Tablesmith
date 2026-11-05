const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Test directory
const TEST_DIR = path.resolve(__dirname, '../temp_test_export');
if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Clean test dir
fs.readdirSync(TEST_DIR).forEach((f) => fs.unlinkSync(path.join(TEST_DIR, f)));

function getUniqueFilePath(fullPath) {
  if (!fs.existsSync(fullPath)) return fullPath;
  const parsed = path.parse(fullPath);
  const dir = parsed.dir;
  const fileStem = parsed.name;
  const ext = parsed.ext; // includes dot e.g. .xlsx

  // Check if stem already ends with (N)
  let baseStem = fileStem;
  let startCounter = 1;
  const openParen = fileStem.lastIndexOf(' (');
  if (openParen > 0 && fileStem.endsWith(')')) {
    const numStr = fileStem.slice(openParen + 2, -1);
    const n = parseInt(numStr, 10);
    if (!isNaN(n)) {
      baseStem = fileStem.slice(0, openParen);
      startCounter = n + 1;
    }
  }

  let counter = startCounter;
  while (true) {
    const candidateName = `${baseStem} (${counter})${ext}`;
    const candidatePath = path.join(dir, candidateName);
    if (!fs.existsSync(candidatePath)) {
      return candidatePath;
    }
    counter++;
    if (counter > 1000) throw new Error('Too many duplicates');
  }
}

console.log('--- Test Auto-Numbering Real File Workflow ---');
const baseFile = path.join(TEST_DIR, '季度财务分析.xlsx');

// 1st Export: file does not exist yet
const p1 = getUniqueFilePath(baseFile);
assert.strictEqual(path.basename(p1), '季度财务分析.xlsx');
fs.writeFileSync(p1, 'DATA 1');
console.log('1st export saved to:', path.basename(p1));

// 2nd Export: base file exists -> should become (1)
const p2 = getUniqueFilePath(baseFile);
assert.strictEqual(path.basename(p2), '季度财务分析 (1).xlsx');
fs.writeFileSync(p2, 'DATA 2');
console.log('2nd export saved to:', path.basename(p2));

// 3rd Export: (1) also exists -> should become (2)
const p3 = getUniqueFilePath(baseFile);
assert.strictEqual(path.basename(p3), '季度财务分析 (2).xlsx');
fs.writeFileSync(p3, 'DATA 3');
console.log('3rd export saved to:', path.basename(p3));

// 4th Export with already numbered name '季度财务分析 (1).xlsx' -> should become (3), NOT '季度财务分析 (1) (1).xlsx'!
const p4 = getUniqueFilePath(path.join(TEST_DIR, '季度财务分析 (1).xlsx'));
assert.strictEqual(path.basename(p4), '季度财务分析 (3).xlsx');
fs.writeFileSync(p4, 'DATA 4');
console.log('4th export of (1) saved cleanly to:', path.basename(p4));

// Verify all files on disk
const createdFiles = fs.readdirSync(TEST_DIR).sort();
console.log('Files on disk:', createdFiles);
assert.deepStrictEqual(createdFiles, [
  '季度财务分析 (1).xlsx',
  '季度财务分析 (2).xlsx',
  '季度财务分析 (3).xlsx',
  '季度财务分析.xlsx'
]);

// Cleanup
fs.readdirSync(TEST_DIR).forEach((f) => fs.unlinkSync(path.join(TEST_DIR, f)));
fs.rmdirSync(TEST_DIR);

console.log('\n✓ AUTO-NUMBERING ON EXISTING FILE NAMES VERIFIED 100%!');
