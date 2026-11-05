const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));
const { XMLParser } = require(path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith/node_modules/fast-xml-parser'));

const TARGET_PORT = 1421;
const TARGET_URL = `http://localhost:${TARGET_PORT}/`;
const OUTPUT_DIR = path.resolve(__dirname, '../screenshots/xsd_verification');
const ARTIFACT_DIR = 'C:/Users/16147/.gemini/antigravity/brain/6b1e106f-60e5-4833-870d-26ff781fef32';

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function cleanTagName(name) {
  const parts = name.split(':');
  return parts.length > 1 ? parts[parts.length - 1] : name;
}

function extractSheetsFromXsd(xsdText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    preserveOrder: false,
    trimValues: true,
  });

  const parsed = parser.parse(xsdText);
  let schema = null;
  for (const k of Object.keys(parsed)) {
    if (cleanTagName(k) === 'schema') {
      schema = parsed[k];
      break;
    }
  }

  if (!schema) {
    return [{
      name: 'SchemaRaw',
      headers: ['Content'],
      rows: xsdText.split(/\r?\n/).map(line => [line])
    }];
  }

  const elementsRows = [];
  const attributesRows = [];
  const simpleTypesRows = [];
  const constraintsRows = [];
  const summaryRows = [];

  for (const [k, v] of Object.entries(schema)) {
    if (k.startsWith('@_')) {
      summaryRows.push([k.slice(2), String(v)]);
    }
  }

  function traverseNode(node, parentName) {
    if (!node || typeof node !== 'object') return;

    for (const [k, v] of Object.entries(node)) {
      const clean = cleanTagName(k);
      const items = Array.isArray(v) ? v : [v];

      if (clean === 'element') {
        for (const item of items) {
          if (item && typeof item === 'object') {
            const name = item['@_name'] || item['@_ref'] || '(anonymous)';
            const type = item['@_type'] || '(complexType)';
            const minOccurs = item['@_minOccurs'] || '1';
            const maxOccurs = item['@_maxOccurs'] || '1';
            elementsRows.push([name, parentName || '(root)', type, minOccurs, maxOccurs]);
            traverseNode(item, name);
          }
        }
      } else if (clean === 'attribute') {
        for (const item of items) {
          if (item && typeof item === 'object') {
            const name = item['@_name'] || item['@_ref'] || '(anonymous)';
            const type = item['@_type'] || 'string';
            const use = item['@_use'] || 'optional';
            const defVal = item['@_default'] || item['@_fixed'] || '';
            attributesRows.push([name, parentName || '(global)', type, use, defVal]);
          }
        }
      } else if (clean === 'simpleType') {
        for (const item of items) {
          if (item && typeof item === 'object') {
            const name = item['@_name'] || '(anonymous)';
            let baseType = '';
            const enums = [];
            const restriction = item.restriction || item['xs:restriction'];
            if (restriction) {
              baseType = restriction['@_base'] || '';
              const enumItems = restriction.enumeration || restriction['xs:enumeration'];
              if (enumItems) {
                const arr = Array.isArray(enumItems) ? enumItems : [enumItems];
                for (const e of arr) {
                  if (e && e['@_value']) enums.push(e['@_value']);
                }
              }
            }
            simpleTypesRows.push([name, baseType, enums.join(', ')]);
          }
        }
      } else if (clean === 'key' || clean === 'unique' || clean === 'keyref') {
        for (const item of items) {
          if (item && typeof item === 'object') {
            const name = item['@_name'] || '';
            const selectorNode = item.selector || item['xs:selector'];
            const fieldNode = item.field || item['xs:field'];
            const selector = selectorNode ? (selectorNode['@_xpath'] || '') : '';
            const field = fieldNode ? (fieldNode['@_xpath'] || '') : '';
            const refer = item['@_refer'] || '';
            constraintsRows.push([name, clean, selector, field, refer]);
          }
        }
      } else {
        for (const item of items) {
          if (item && typeof item === 'object') {
            traverseNode(item, parentName);
          }
        }
      }
    }
  }

  traverseNode(schema, '');

  const sheets = [];
  if (elementsRows.length > 0) {
    sheets.push({
      name: 'Elements (元素结构)',
      headers: ['元素名称', '所属父节点', '数据类型', '最小出现', '最大出现'],
      rows: elementsRows
    });
  }
  if (attributesRows.length > 0) {
    sheets.push({
      name: 'Attributes (字段属性)',
      headers: ['属性名称', '所属元素', '数据类型', '约束 (Use)', '默认值'],
      rows: attributesRows
    });
  }
  if (simpleTypesRows.length > 0) {
    sheets.push({
      name: 'SimpleTypes (枚举与类型)',
      headers: ['类型名称', '基础数据类型', '枚举候选值'],
      rows: simpleTypesRows
    });
  }
  if (constraintsRows.length > 0) {
    sheets.push({
      name: 'Constraints (主外键约束)',
      headers: ['约束名称', '约束类型', '目标选择器 (Selector)', '对应字段 (Field)', '引用主键 (Refer)'],
      rows: constraintsRows
    });
  }
  if (summaryRows.length > 0) {
    sheets.push({
      name: 'SchemaSummary (元信息)',
      headers: ['属性名', '属性值'],
      rows: summaryRows
    });
  }

  return sheets;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startPreviewServer() {
  console.log('[Server] Starting vite preview server on port ' + TARGET_PORT + '...');
  const appDir = path.resolve(__dirname, '../tablesmith');
  const server = spawn('cmd.exe', ['/c', 'npm', 'run', 'preview', '--', '--port', String(TARGET_PORT), '--strictPort'], {
    cwd: appDir,
    stdio: 'pipe'
  });

  const http = require('http');
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const ok = await new Promise((res) => {
        const req = http.get(TARGET_URL, (r) => res(r.statusCode === 200));
        req.on('error', () => res(false));
      });
      if (ok) {
        console.log('[Server] Preview server is up and responsive!');
        return server;
      }
    } catch {
      // retry
    }
  }
  throw new Error('Preview server timed out starting');
}

async function run() {
  let serverProc = null;
  let browser = null;

  try {
    serverProc = await startPreviewServer();

    browser = await puppeteer.launch({
      channel: 'chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: { width: 1440, height: 920 }
    });

    const page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });

    // Step 1: Read and parse 2024_budget_submission.xsd
    console.log('[Step 1] Loading 2024_budget_submission.xsd...');
    const xsdPath = 'D:/tmp/excel/2024_budget_submission.xsd';
    const xsdContent = fs.readFileSync(xsdPath, 'utf8');
    const xsdSheets = extractSheetsFromXsd(xsdContent);

    const xsdFileData = {
      fileName: '2024_budget_submission.xsd',
      fileType: 'xsd',
      sheets: xsdSheets,
      rawContent: xsdContent
    };

    // Step 2: Prepare a complex CSV (multi-delimiter / semicolon)
    const complexCsvData = {
      fileName: 'europe_sales_semicolon.csv',
      fileType: 'csv',
      sheets: [{
        name: 'europe_sales_semicolon',
        headers: ['Country', 'Product_ID', 'Unit_Price', 'Quantity', 'Revenue_EUR'],
        rows: [
          ['Germany', 'PRD-001', '120.50', '45', '5422.50'],
          ['France', 'PRD-002', '350.00', '12', '4200.00'],
          ['Italy', 'PRD-003', '89.90', '100', '8990.00'],
          ['Spain', 'PRD-004', '210.00', '30', '6300.00']
        ]
      }]
    };

    // Inject into Zustand Store
    await page.evaluate((xsd, csv) => {
      if (window.__DATA_STORE__) {
        window.__DATA_STORE__.getState().setTheme('light');
        window.__DATA_STORE__.getState().addFile(xsd);
        window.__DATA_STORE__.getState().addFile(csv);
        window.__DATA_STORE__.getState().setActiveFile(0);
        window.__DATA_STORE__.getState().setActiveSheet(0);
      }
      document.documentElement.classList.remove('dark');
    }, xsdFileData, complexCsvData);
    await sleep(1000);

    // Screenshot 1: Elements sheet
    const p1 = path.join(OUTPUT_DIR, '01_xsd_elements_sheet.png');
    await page.screenshot({ path: p1 });
    console.log('✓ 01_xsd_elements_sheet.png captured (Elements Structure)');

    // Screenshot 2: Switch to Attributes sheet
    await page.evaluate(() => {
      window.__DATA_STORE__.getState().setActiveSheet(1);
    });
    await sleep(800);
    const p2 = path.join(OUTPUT_DIR, '02_xsd_attributes_sheet.png');
    await page.screenshot({ path: p2 });
    console.log('✓ 02_xsd_attributes_sheet.png captured (Attributes & Constraints)');

    // Screenshot 3: Switch to SimpleTypes sheet
    await page.evaluate(() => {
      window.__DATA_STORE__.getState().setActiveSheet(2);
    });
    await sleep(800);
    const p3 = path.join(OUTPUT_DIR, '03_xsd_simpletypes_sheet.png');
    await page.screenshot({ path: p3 });
    console.log('✓ 03_xsd_simpletypes_sheet.png captured (SimpleTypes & Enumerations)');

    // Screenshot 4: Switch to Constraints sheet
    await page.evaluate(() => {
      window.__DATA_STORE__.getState().setActiveSheet(3);
    });
    await sleep(800);
    const p4 = path.join(OUTPUT_DIR, '04_xsd_constraints_sheet.png');
    await page.screenshot({ path: p4 });
    console.log('✓ 04_xsd_constraints_sheet.png captured (Key & Foreign Key Constraints)');

    // Screenshot 5: Switch to Dark Mode & SchemaSummary sheet
    await page.evaluate(() => {
      window.__DATA_STORE__.getState().setTheme('dark');
      window.__DATA_STORE__.getState().setActiveSheet(4);
      document.documentElement.classList.add('dark');
    });
    await sleep(800);
    const p5 = path.join(OUTPUT_DIR, '05_xsd_dark_summary_sheet.png');
    await page.screenshot({ path: p5 });
    console.log('✓ 05_xsd_dark_summary_sheet.png captured (Dark Mode & Schema Summary)');

    // Screenshot 6: Switch to Europe Semicolon CSV in Data View
    await page.evaluate(() => {
      window.__DATA_STORE__.getState().setActiveFile(1);
      window.__DATA_STORE__.getState().setActiveSheet(0);
    });
    await sleep(800);
    const p6 = path.join(OUTPUT_DIR, '06_complex_semicolon_csv.png');
    await page.screenshot({ path: p6 });
    console.log('✓ 06_complex_semicolon_csv.png captured (Complex Semicolon CSV)');

    // Screenshot 7: Format Conversion View with XSD/CSV selected
    const convertBtn = await page.$('a[href="/convert"], button[data-view="convert"]');
    if (convertBtn) {
      await convertBtn.click();
    } else {
      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button'));
        const l = links.find(el => el.textContent && el.textContent.includes('格式转换'));
        if (l) l.click();
      });
    }
    await sleep(1000);
    const p7 = path.join(OUTPUT_DIR, '07_format_conversion_view.png');
    await page.screenshot({ path: p7 });
    console.log('✓ 07_format_conversion_view.png captured (Format Conversion View)');

    // Copy screenshots to artifact directory
    if (fs.existsSync(ARTIFACT_DIR)) {
      const files = fs.readdirSync(OUTPUT_DIR);
      for (const file of files) {
        if (file.endsWith('.png')) {
          fs.copyFileSync(path.join(OUTPUT_DIR, file), path.join(ARTIFACT_DIR, file));
        }
      }
      console.log('✓ All verification screenshots copied to artifacts directory!');
    }

    console.log('\n>>> ALL PUPPETEER UI SCREENSHOTS CAPTURED SUCCESSFULLY! <<<');
  } catch (err) {
    console.error('Test run failed:', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (serverProc) {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(serverProc.pid), '/f', '/t']);
      } else {
        serverProc.kill();
      }
    }
  }
}

run();
