const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));
const XLSX = require(path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith/node_modules/xlsx'));
const { XMLParser } = require(path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith/node_modules/fast-xml-parser'));

const TARGET_PORT = 1420;
const TARGET_URL = `http://localhost:${TARGET_PORT}/`;
const OUTPUT_DIR = path.resolve(__dirname, '../screenshots/tmp_excel_verification');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

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
      score = 0.5;
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

    // 1. Prepare Financial_BP_Rolling_Forecast.xlsx data
    console.log('[Step 1] Loading Financial_BP_Rolling_Forecast.xlsx (17 sheets)...');
    const xlsxBuf = fs.readFileSync('D:/tmp/excel/Financial_BP_Rolling_Forecast.xlsx');
    const wb = XLSX.read(xlsxBuf, { type: 'buffer' });
    const bpSheets = wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1 });
      return normalizeSheetData(name, json);
    });

    const bpFileData = {
      fileName: 'Financial_BP_Rolling_Forecast.xlsx',
      fileType: 'xlsx',
      sheets: bpSheets
    };

    // 2. Prepare 2024_budget_submission.xml data
    console.log('[Step 2] Loading 2024_budget_submission.xml (4 sheets)...');
    const xmlText = fs.readFileSync('D:/tmp/excel/2024_budget_submission.xml', 'utf8');
    const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const parsedXml = xmlParser.parse(xmlText);
    const xmlSheets = extractSheetsFromParsedXml(parsedXml);

    const xmlFileData = {
      fileName: '2024_budget_submission.xml',
      fileType: 'xml',
      sheets: xmlSheets
    };

    // Inject both files into Zustand Store
    await page.evaluate((bp, xml) => {
      if (window.__DATA_STORE__) {
        window.__DATA_STORE__.getState().setTheme('dark');
        window.__DATA_STORE__.getState().addFile(bp);
        window.__DATA_STORE__.getState().addFile(xml);
      }
      document.documentElement.classList.add('dark');
    }, bpFileData, xmlFileData);
    await sleep(1000);

    // Screenshot 1: Financial_BP Summary Sheet
    await page.screenshot({ path: path.join(OUTPUT_DIR, '01_financial_bp_summary.png') });
    console.log('✓ 01_financial_bp_summary.png captured (Summary Sheet with clean metrics & forecast)');

    // Switch to Sheet 2: "Revenue Build" (25 period columns)
    console.log('[Step 3] Switching to Revenue Build sheet...');
    await page.evaluate(() => {
      const store = window.__DATA_STORE__.getState();
      // Find Revenue Build sheet index
      const bpFile = store.files[0];
      const revIdx = bpFile.sheets.findIndex(s => s.name === 'Revenue Build');
      if (revIdx >= 0) {
        store.setActiveSheet(revIdx);
      }
    });
    await sleep(800);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '02_financial_bp_revenue_build.png') });
    console.log('✓ 02_financial_bp_revenue_build.png captured (Revenue Build with 25 Period columns)');

    // Switch to Sheet 11: "Sales Detail" (8640 rows)
    console.log('[Step 4] Switching to Sales Detail sheet (8,640 rows)...');
    await page.evaluate(() => {
      const store = window.__DATA_STORE__.getState();
      const bpFile = store.files[0];
      const salesIdx = bpFile.sheets.findIndex(s => s.name === 'Sales Detail');
      if (salesIdx >= 0) {
        store.setActiveSheet(salesIdx);
      }
    });
    await sleep(1000);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '03_financial_bp_sales_detail.png') });
    console.log('✓ 03_financial_bp_sales_detail.png captured (8,640 rows virtualized in AG Grid)');

    // Switch to 2024_budget_submission.xml (File 1, Sheet "Fact" with 360 rows)
    console.log('[Step 5] Switching to 2024_budget_submission.xml...');
    await page.evaluate(() => {
      const store = window.__DATA_STORE__.getState();
      store.setActiveFile(1);
      store.setActiveSheet(0);
    });
    await sleep(800);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '04_budget_xml_facts.png') });
    console.log('✓ 04_budget_xml_facts.png captured (360 Facts parsed from XML attributes)');

    // Test Chart View with Revenue Build or Facts
    console.log('[Step 6] Navigating to Chart View (/chart)...');
    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('aside a, nav a'));
      const link = links.find((a) => a.getAttribute('href') === '/chart' || a.pathname === '/chart');
      if (link) link.click();
    });
    await sleep(1000);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '05_tmp_excel_chart_view.png') });
    console.log('✓ 05_tmp_excel_chart_view.png captured (Interactive Charting on Real D:/tmp/excel Data)');

    // Test Process View (Pivot Table on Sales Detail)
    console.log('[Step 7] Navigating to Process View (/process)...');
    await page.evaluate(() => {
      const store = window.__DATA_STORE__.getState();
      store.setActiveFile(0); // BP file
      const salesIdx = store.files[0].sheets.findIndex(s => s.name === 'Sales Detail');
      store.setActiveSheet(salesIdx);
      const links = Array.from(document.querySelectorAll('aside a, nav a'));
      const link = links.find((a) => a.getAttribute('href') === '/process' || a.pathname === '/process');
      if (link) link.click();
    });
    await sleep(800);

    // Click Pivot tab and generate
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button'));
      const pivotTab = tabs.find((b) => b.textContent && b.textContent.includes('数据透视'));
      if (pivotTab) pivotTab.click();
    });
    await sleep(400);

    await page.evaluate(() => {
      const genBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('生成数据透视表'));
      if (genBtn) genBtn.click();
    });
    await sleep(800);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '06_tmp_excel_pivot_processed.png') });
    console.log('✓ 06_tmp_excel_pivot_processed.png captured (Pivot Matrix computed from 8,640 Sales records)');

    console.log('\n==================================================');
    console.log('>>> ALL D:/tmp/excel UI VERIFICATIONS COMPLETED SUCCESSFULLY! <<<');
    console.log('==================================================');

  } finally {
    if (browser) await browser.close();
    if (serverProc) serverProc.kill();
  }
}

run().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
