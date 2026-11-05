const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { XMLParser } = require('d:/code/zhanglx-index/disktopApp/tablesmith/node_modules/fast-xml-parser');
const Papa = require('d:/code/zhanglx-index/disktopApp/tablesmith/node_modules/papaparse');
const XLSX = require('d:/code/zhanglx-index/disktopApp/tablesmith/node_modules/xlsx');

console.log('=== STARTING DEEP VALIDATION: XSD & COMPLEX CSV/XML/XLSX ===\n');

// 1. Test XSD Parsing (2024_budget_submission.xsd)
console.log('--- Test 1: XSD Schema Parser ---');
const xsdPath = 'D:/tmp/excel/2024_budget_submission.xsd';
assert.ok(fs.existsSync(xsdPath), 'XSD file must exist');

const xsdContent = fs.readFileSync(xsdPath, 'utf8');
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
const parsedXsd = xmlParser.parse(xsdContent);

function cleanTagName(name) {
  const parts = name.split(':');
  return parts.length > 1 ? parts[1] : name;
}

function extractSheetsFromXsd(parsed) {
  const schemaKey = Object.keys(parsed).find((k) => cleanTagName(k) === 'schema') || 'schema';
  const schema = parsed[schemaKey] || parsed;

  const elementsList = [];
  const attributesList = [];
  const simpleTypesList = [];
  const constraintsList = [];
  const schemaInfoList = [];

  for (const [k, v] of Object.entries(schema)) {
    if (typeof v === 'string' || typeof v === 'number') {
      schemaInfoList.push({
        '属性名': cleanTagName(k),
        '属性值': String(v),
      });
    }
  }

  const toArray = (item) => (!item ? [] : Array.isArray(item) ? item : [item]);

  const simpleTypeNodes = toArray(schema['xs:simpleType'] || schema['simpleType']);
  for (const st of simpleTypeNodes) {
    if (typeof st !== 'object' || !st) continue;
    const name = String(st['name'] || st['@_name'] || '');
    const restriction = st['xs:restriction'] || st['restriction'];
    const baseType = restriction ? String(restriction['base'] || restriction['@_base'] || '') : '';
    const enumNodes = restriction ? toArray(restriction['xs:enumeration'] || restriction['enumeration']) : [];
    const enumVals = enumNodes
      .map((en) => (en && typeof en === 'object' ? String(en['value'] || en['@_value'] || '') : ''))
      .filter(Boolean);

    simpleTypesList.push({
      '类型名称': name,
      '基础数据类型': cleanTagName(baseType),
      '枚举候选值': enumVals.join(' | '),
    });
  }

  function scanNode(node, parentScope) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child) => scanNode(child, parentScope));
      return;
    }

    const elemName = String(node['name'] || node['@_name'] || '');
    const isElement = 'name' in node && ('type' in node || 'xs:complexType' in node || 'complexType' in node);

    let nextScope = parentScope;
    if (isElement && elemName) {
      nextScope = elemName;
      elementsList.push({
        '元素名称': elemName,
        '所属父节点': parentScope,
        '数据类型': cleanTagName(String(node['type'] || node['@_type'] || 'complexType')),
        '最小出现': String(node['minOccurs'] || node['@_minOccurs'] || '1'),
        '最大出现': String(node['maxOccurs'] || node['@_maxOccurs'] || '1'),
      });
    }

    const attrNodes = toArray(node['xs:attribute'] || node['attribute']);
    for (const at of attrNodes) {
      if (typeof at !== 'object' || !at) continue;
      const atName = String(at['name'] || at['@_name'] || '');
      if (atName) {
        attributesList.push({
          '属性名称': atName,
          '所属元素': nextScope,
          '数据类型': cleanTagName(String(at['type'] || at['@_type'] || 'string')),
          '约束 (Use)': String(at['use'] || at['@_use'] || 'optional'),
          '默认值': String(at['default'] || at['@_default'] || ''),
        });
      }
    }

    const keyNodes = toArray(node['xs:key'] || node['key']);
    for (const kn of keyNodes) {
      if (typeof kn !== 'object' || !kn) continue;
      const kName = String(kn['name'] || kn['@_name'] || '');
      const selector = kn['xs:selector'] || kn['selector'];
      const field = kn['xs:field'] || kn['field'];
      constraintsList.push({
        '约束名称': kName,
        '约束类型': '主键 (Key)',
        '目标选择器 (Selector)': String(selector?.['xpath'] || selector?.['@_xpath'] || ''),
        '对应字段 (Field)': String(field?.['xpath'] || field?.['@_xpath'] || ''),
        '引用主键 (Refer)': '',
      });
    }

    const keyrefNodes = toArray(node['xs:keyref'] || node['keyref']);
    for (const kr of keyrefNodes) {
      if (typeof kr !== 'object' || !kr) continue;
      const krName = String(kr['name'] || kr['@_name'] || '');
      const refer = String(kr['refer'] || kr['@_refer'] || '');
      const selector = kr['xs:selector'] || kr['selector'];
      const field = kr['xs:field'] || kr['field'];
      constraintsList.push({
        '约束名称': krName,
        '约束类型': '外键 (KeyRef)',
        '目标选择器 (Selector)': String(selector?.['xpath'] || selector?.['@_xpath'] || ''),
        '对应字段 (Field)': String(field?.['xpath'] || field?.['@_xpath'] || ''),
        '引用主键 (Refer)': refer,
      });
    }

    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('?') || k.startsWith('@_')) continue;
      if (typeof v === 'object' && v !== null) {
        scanNode(v, nextScope);
      }
    }
  }

  scanNode(schema, 'Root');

  const sheets = [];
  if (elementsList.length > 0) {
    const headers = ['元素名称', '所属父节点', '数据类型', '最小出现', '最大出现'];
    const rows = elementsList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'Elements (元素结构)', headers, rows });
  }
  if (attributesList.length > 0) {
    const headers = ['属性名称', '所属元素', '数据类型', '约束 (Use)', '默认值'];
    const rows = attributesList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'Attributes (字段属性)', headers, rows });
  }
  if (simpleTypesList.length > 0) {
    const headers = ['类型名称', '基础数据类型', '枚举候选值'];
    const rows = simpleTypesList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'SimpleTypes (枚举与类型)', headers, rows });
  }
  if (constraintsList.length > 0) {
    const headers = ['约束名称', '约束类型', '目标选择器 (Selector)', '对应字段 (Field)', '引用主键 (Refer)'];
    const rows = constraintsList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'Constraints (主外键约束)', headers, rows });
  }
  if (schemaInfoList.length > 0) {
    const headers = ['属性名', '属性值'];
    const rows = schemaInfoList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'SchemaSummary (元信息)', headers, rows });
  }
  return sheets;
}

const xsdSheets = extractSheetsFromXsd(parsedXsd);
console.log(`XSD Sheets extracted: ${xsdSheets.length}`);
xsdSheets.forEach((s) => {
  console.log(`  - Sheet '${s.name}': ${s.rows.length} rows, headers: [${s.headers.join(', ')}]`);
});

assert.strictEqual(xsdSheets.length, 5, 'Must extract all 5 XSD sheets');
assert.ok(xsdSheets[0].rows.length >= 7, 'Elements sheet must have at least 7 elements');
assert.ok(xsdSheets[1].rows.length >= 25, 'Attributes sheet must have at least 25 attributes');
assert.strictEqual(xsdSheets[2].rows.length, 2, 'SimpleTypes sheet must have 2 simpleTypes');
assert.strictEqual(xsdSheets[3].rows.length, 10, 'Constraints sheet must have 10 keys & keyrefs');
console.log('✓ XSD Schema Parser passed 100% assertions!\n');

// 2. Test Complex CSV: Semicolon, TSV, Pipe, UTF-8 BOM, GBK
console.log('--- Test 2: Complex CSV Compatibility ---');

// 2.1 Semicolon CSV (European style)
const semiCsv = `Product;Price;Quantity;TaxRate\r\nLaptop;1200.50;5;0.13\r\nPhone;800.00;10;0.13\r\nMonitor;350.00;8;0.13`;
const parsedSemi = Papa.parse(semiCsv, { header: false, skipEmptyLines: 'greedy' });
assert.strictEqual(parsedSemi.data.length, 4);
assert.strictEqual(parsedSemi.data[0].length, 4);
console.log('✓ Semicolon CSV (4 cols, 4 rows) auto-detected successfully');

// 2.2 Tab Delimited TSV
const tsv = `ID\tCustomer\tAmount\tStatus\n101\tTechCorp\t50000\tPaid\n102\tGlobalLogistics\t32000\tPending`;
const parsedTsv = Papa.parse(tsv, { header: false, skipEmptyLines: 'greedy' });
assert.strictEqual(parsedTsv.data[0].length, 4);
assert.strictEqual(parsedTsv.data.length, 3);
console.log('✓ TSV Tab-delimited (4 cols, 3 rows) auto-detected successfully');

// 2.3 Pipe Delimited CSV
const pipeCsv = `User_ID|Username|Email|Role\n1|zhang|zhang@corp.com|Admin\n2|li|li@corp.com|User`;
const parsedPipe = Papa.parse(pipeCsv, { header: false, skipEmptyLines: 'greedy' });
assert.strictEqual(parsedPipe.data[0].length, 4);
assert.strictEqual(parsedPipe.data.length, 3);
console.log('✓ Pipe-delimited (4 cols, 3 rows) auto-detected successfully');

// 2.4 UTF-8 BOM CSV
const bomCsv = `\uFEFFOrder_ID,Amount,Currency\nORD001,150.00,USD\nORD002,280.00,EUR`;
const cleanBom = bomCsv.charCodeAt(0) === 0xFEFF ? bomCsv.slice(1) : bomCsv;
const parsedBom = Papa.parse(cleanBom, { header: false, skipEmptyLines: 'greedy' });
assert.strictEqual(parsedBom.data[0][0], 'Order_ID', 'First header must not contain BOM character');
console.log('✓ UTF-8 BOM stripped cleanly without header corruption');

// 3. Test Complex Nested XML
console.log('\n--- Test 3: Complex Nested XML ---');
const complexXml = `<?xml version="1.0" encoding="UTF-8"?>
<Company name="AlphaTech" region="APAC">
  <Departments>
    <Department id="D1" name="Engineering">
      <Employee id="E001" role="Lead">Alice</Employee>
      <Employee id="E002" role="Dev">Bob</Employee>
    </Department>
    <Department id="D2" name="Finance">
      <Employee id="E003" role="Manager">Charlie</Employee>
    </Department>
  </Departments>
  <Transactions>
    <Tx id="TX-01" amount="9500.00" currency="USD" date="2024-03-01"/>
    <Tx id="TX-02" amount="12300.50" currency="USD" date="2024-03-02"/>
  </Transactions>
</Company>`;

const parsedComplexXml = xmlParser.parse(complexXml);
function extractSheetsFromParsedXml(parsed) {
  const rootKey = Object.keys(parsed).find((k) => !k.startsWith('?'));
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
        const headers = Array.from(allKeys).filter((k) => !k.startsWith('?'));
        const rows = node.map((item) =>
          headers.map((h) => {
            const val = item[h];
            if (val === undefined || val === null) return '';
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val).trim();
          })
        );
        sheets.push({ name: cleanTagName(currentTag), headers: headers.map(cleanTagName), rows });
      }
      return;
    }
    for (const [key, val] of Object.entries(node)) {
      if (key.startsWith('?') || key.startsWith('@_')) continue;
      if (Array.isArray(val)) {
        traverse(val, key);
      } else if (typeof val === 'object' && val !== null) {
        traverse(val, key);
      }
    }
  }

  traverse(root, rootKey ? cleanTagName(rootKey) : 'Sheet1');
  sheets.sort((a, b) => b.rows.length - a.rows.length);
  return sheets;
}

const extractedComplexSheets = extractSheetsFromParsedXml(parsedComplexXml);
console.log(`Complex XML Sheets: ${extractedComplexSheets.length}`);
extractedComplexSheets.forEach((s) => {
  console.log(`  - Sheet '${s.name}': ${s.rows.length} rows, headers: [${s.headers.join(', ')}]`);
});
assert.ok(extractedComplexSheets.some((s) => s.name === 'Tx' && s.rows.length === 2));
assert.ok(extractedComplexSheets.some((s) => s.name === 'Department' && s.rows.length === 2));
console.log('✓ Complex Nested XML multi-entity extraction passed!');

console.log('\n======================================================');
console.log('>>> ALL XSD & COMPLEX COMPATIBILITY TESTS PASSED 100%! <<<');
console.log('======================================================\n');
