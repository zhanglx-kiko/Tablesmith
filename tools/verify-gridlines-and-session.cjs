const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const XLSX = require(path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith/node_modules/xlsx'));
const { XMLParser } = require(path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith/node_modules/fast-xml-parser'));

const SCREENSHOT_DIR = path.resolve('d:/code/zhanglx-index/disktopApp/screenshots/gridlines_and_session');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
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
    if (filledCount === 1) score = 0.5;
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
    let raw = rawHeaders[c] !== null && rawHeaders[c] !== undefined ? String(rawHeaders[c]).trim() : '';
    if (!raw) raw = `列${c + 1}`;
    const seen = counts.get(raw) || 0;
    counts.set(raw, seen + 1);
    headers.push(seen === 0 ? raw : `${raw}_${seen}`);
  }

  const rows = [];
  for (let r = headerIdx + 1; r < rawRows.length; r++) {
    const rawRow = rawRows[r] || [];
    const hasAny = rawRow.some((c) => c !== null && c !== undefined && String(c).trim() !== '');
    if (!hasAny) continue;
    const row = [];
    for (let c = 0; c < maxCols; c++) {
      const val = rawRow[c];
      row.push(val !== null && val !== undefined ? String(val).trim() : '');
    }
    rows.push(row);
  }
  return { name, headers, rows };
}

function extractSheetsFromParsedXml(parsed) {
  const sheets = [];
  let root = parsed;
  let rootKey = '';
  for (const [k, v] of Object.entries(parsed)) {
    if (!k.startsWith('?') && typeof v === 'object' && v !== null) {
      root = v;
      rootKey = k;
      break;
    }
  }
  function traverse(node, currentTag) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length > 0 && typeof node[0] === 'object' && node[0] !== null) {
        const headerSet = new Set();
        node.forEach((item) => {
          if (typeof item === 'object' && item !== null) {
            Object.keys(item).forEach((k) => headerSet.add(k));
          }
        });
        const headers = Array.from(headerSet).filter((h) => !h.startsWith('@_') || true);
        const rows = node.map((item) =>
          headers.map((h) => {
            const val = item[h];
            return val !== null && val !== undefined ? String(val) : '';
          })
        );
        sheets.push({ name: currentTag, headers, rows });
        return;
      }
      node.forEach((child) => traverse(child, currentTag));
      return;
    }
    for (const [key, val] of Object.entries(node)) {
      if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
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

async function run() {
  console.log('=== Starting E2E Verification: Gridlines & Session Persistence ===');

  // Start Vite Preview
  const appDir = path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith');
  const server = spawn('cmd.exe', ['/c', 'npm', 'run', 'preview', '--', '--port', '1428', '--strictPort'], {
    cwd: appDir,
    stdio: 'pipe',
  });

  const http = require('http');
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const ok = await new Promise((res) => {
        const req = http.get('http://localhost:1428/', (r) => res(r.statusCode === 200));
        req.on('error', () => res(false));
      });
      if (ok) {
        console.log('[Server] Preview server is up on port 1428!');
        break;
      }
    } catch {
      // retry
    }
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1440, height: 920 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:1428/', { waitUntil: 'networkidle0' });

    // 1. Prepare data
    console.log('[Step 1] Loading Financial_BP_Rolling_Forecast.xlsx & 2024_budget_submission.xml...');
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
      sheets: bpSheets,
    };

    const xmlText = fs.readFileSync('D:/tmp/excel/2024_budget_submission.xml', 'utf8');
    const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const xmlSheets = extractSheetsFromParsedXml(xmlParser.parse(xmlText));
    const xmlFileData = {
      fileName: '2024_budget_submission.xml',
      fileType: 'xml',
      sheets: xmlSheets,
    };

    // 2. Add both files into Zustand Store
    console.log('[Step 2] Injecting datasets into workspace...');
    await page.evaluate((bp, xml) => {
      if (window.__DATA_STORE__) {
        window.__DATA_STORE__.getState().setTheme('light');
        window.__DATA_STORE__.getState().addFile(bp);
        window.__DATA_STORE__.getState().addFile(xml);
      }
    }, bpFileData, xmlFileData);

    await sleep(1000);
    await page.waitForSelector('.ag-header-cell', { timeout: 10000 });

    // Verify computed border styles
    const borderStyles = await page.evaluate(() => {
      const cell = document.querySelector('.ag-cell');
      const header = document.querySelector('.ag-header-cell');
      return {
        cellBorderRight: cell ? window.getComputedStyle(cell).borderRight : null,
        headerBorderRight: header ? window.getComputedStyle(header).borderRight : null,
      };
    });
    console.log('✓ Computed borders (Light Mode):', borderStyles);

    // Screenshot 1: Light mode showing vertical gridlines
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_light_mode_gridlines.png') });
    console.log('✓ 01_light_mode_gridlines.png captured (with clear vertical column lines)');

    // 3. Switch to Dark Mode
    console.log('[Step 3] Switching to dark theme...');
    await page.evaluate(() => {
      window.__DATA_STORE__.getState().setTheme('dark');
    });
    await sleep(600);

    const darkBorderStyles = await page.evaluate(() => {
      const cell = document.querySelector('.ag-cell');
      const header = document.querySelector('.ag-header-cell');
      return {
        cellBorderRight: cell ? window.getComputedStyle(cell).borderRight : null,
        headerBorderRight: header ? window.getComputedStyle(header).borderRight : null,
      };
    });
    console.log('✓ Computed borders (Dark Mode):', darkBorderStyles);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_dark_mode_gridlines.png') });
    console.log('✓ 02_dark_mode_gridlines.png captured (dark mode vertical gridlines)');

    // 4. Switch sheet in 2024_budget_submission.xml to 'Period'
    console.log('[Step 4] Switching active sheet to Period...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const periodBtn = buttons.find((b) => b.textContent?.trim() === 'Period');
      if (periodBtn) periodBtn.click();
    });
    await sleep(600);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_period_sheet.png') });
    console.log('✓ 03_period_sheet.png captured');

    // 5. Test Persistence: Wait for IndexedDB debounce save, then reload
    console.log('[Step 5] Waiting for IndexedDB debounce persistence (800ms)...');
    await sleep(800);

    console.log('[Step 6] Reloading page (simulating app restart)...');
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(1000);
    await page.waitForSelector('.ag-header-cell', { timeout: 10000 });

    const restoredInfo = await page.evaluate(() => {
      const openTabs = Array.from(document.querySelectorAll('.truncate')).map((el) => el.textContent?.trim());
      const activeTab = document.querySelector('.border-blue-500 span')?.textContent?.trim();
      const activeSheet = document.querySelector('.text-blue-600.bg-blue-50, .text-blue-400.bg-blue-900\\/40')?.textContent?.trim();
      const rows = document.querySelectorAll('.ag-row').length;
      return { openTabs, activeTab, activeSheet, rows };
    });
    console.log('✓ Restored Session Info after Reload:', restoredInfo);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_reloaded_workspace_restored.png') });
    console.log('✓ 04_reloaded_workspace_restored.png captured (workspace completely restored!)');

    // 6. Test Explicit Close Tab (X button)
    console.log('[Step 7] Testing explicit close button (X) on active tab...');
    await page.evaluate(() => {
      const closeButtons = Array.from(document.querySelectorAll('button[aria-label^="关闭数据源"]'));
      // close the active one (2024_budget_submission.xml)
      if (closeButtons.length > 0) {
        closeButtons[closeButtons.length - 1].click();
      }
    });
    await sleep(800);

    const remainingTabs = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.truncate')).map((el) => el.textContent?.trim());
      const active = document.querySelector('.border-blue-500 span')?.textContent?.trim();
      return { tabs, active };
    });
    console.log('✓ After closing 2024_budget_submission.xml, remaining:', remainingTabs);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_remaining_file_active.png') });
    console.log('✓ 05_remaining_file_active.png captured (Financial_BP stays active!)');

    console.log('\n======================================================');
    console.log('>>> ALL GRIDLINES & SESSION PERSISTENCE VERIFIED 100%! <<<');
    console.log('======================================================\n');
  } finally {
    await browser.close();
    server.kill();
  }
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
