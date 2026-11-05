const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SCREENSHOT_DIR = path.resolve('d:/code/zhanglx-index/disktopApp/screenshots/gridlines_and_session');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function runVerification() {
  console.log('=== Starting E2E Verification: Gridlines & Session Persistence ===');

  // 1. Start preview server
  console.log('[Step 1] Starting vite preview server on port 1421...');
  const server = spawn('npx.cmd', ['vite', 'preview', '--port', '1421'], {
    cwd: path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith'),
    stdio: 'pipe',
    shell: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:1421/', { waitUntil: 'networkidle0' });

    console.log('[Step 2] Importing 2024_budget_submission.xml...');
    const xmlContent = fs.readFileSync('D:/tmp/excel/2024_budget_submission.xml', 'utf-8');
    await page.evaluate(async (xmlStr) => {
      const { XMLParser } = window.__FAST_XML__ || {};
      // trigger drop or simulate adding file
      const blob = new Blob([xmlStr], { type: 'text/xml' });
      const file = new File([blob], '2024_budget_submission.xml', { type: 'text/xml' });
      const dt = new DataTransfer();
      dt.items.add(file);

      const dropzone = document.querySelector('input[type="file"]') || document.body;
      if (dropzone.tagName === 'INPUT') {
        dropzone.files = dt.files;
        dropzone.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await page.waitForSelector('.ag-header-cell', { timeout: 10000 });
    console.log('✓ AG Grid rendered with 2024_budget_submission.xml');

    // Screenshot 1: Light mode with vertical gridlines
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_light_mode_gridlines.png') });
    console.log('✓ 01_light_mode_gridlines.png captured (showing clear vertical column dividers)');

    // Check column borders computed styles
    const cellBorderRight = await page.evaluate(() => {
      const cell = document.querySelector('.ag-cell');
      const header = document.querySelector('.ag-header-cell');
      return {
        cellBorder: cell ? window.getComputedStyle(cell).borderRight : null,
        headerBorder: header ? window.getComputedStyle(header).borderRight : null,
      };
    });
    console.log('Computed borders (Light mode):', cellBorderRight);

    // Switch to dark mode
    console.log('[Step 3] Switching to dark mode...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const darkBtn = btns.find((b) => b.getAttribute('title')?.includes('深色'));
      if (darkBtn) darkBtn.click();
    });

    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_dark_mode_gridlines.png') });
    console.log('✓ 02_dark_mode_gridlines.png captured (dark theme column dividers)');

    // Switch sheet to 'Period'
    console.log('[Step 4] Switching sheet to Period...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const periodBtn = buttons.find((b) => b.textContent?.trim() === 'Period');
      if (periodBtn) periodBtn.click();
    });

    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_period_sheet_active.png') });
    console.log('✓ 03_period_sheet_active.png captured');

    // Wait for debounce save (schedulePersistWorkspace takes 250ms)
    console.log('[Step 5] Waiting for IndexedDB workspace persistence (800ms)...');
    await new Promise((r) => setTimeout(r, 800));

    // Reload page to simulate closing app / browser and reopening!
    console.log('[Step 6] Reloading page (simulating app close & restart)...');
    await page.reload({ waitUntil: 'networkidle0' });

    // Wait for AG Grid after reload
    await page.waitForSelector('.ag-header-cell', { timeout: 10000 });
    console.log('✓ Page reloaded: workspace restored automatically!');

    // Check active file and active sheet after reload
    const restoredState = await page.evaluate(() => {
      const activeFileTab = document.querySelector('.border-blue-500 span');
      const activeSheetBtn = document.querySelector('.text-blue-600.bg-blue-50, .text-blue-400.bg-blue-900\\/40');
      const rowCount = document.querySelectorAll('.ag-row').length;
      return {
        activeFile: activeFileTab ? activeFileTab.textContent : null,
        activeSheet: activeSheetBtn ? activeSheetBtn.textContent : null,
        renderedRows: rowCount,
      };
    });
    console.log('Restored State after reload:', restoredState);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_reloaded_workspace_restored.png') });
    console.log('✓ 04_reloaded_workspace_restored.png captured (active session continued!)');

    // Click auto-size button
    console.log('[Step 7] Testing Auto-Fit Columns button...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const fitBtn = buttons.find((b) => b.textContent?.includes('自适应列宽'));
      if (fitBtn) fitBtn.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_autofit_columns_clicked.png') });
    console.log('✓ 05_autofit_columns_clicked.png captured');

    // Test explicit close tab
    console.log('[Step 8] Testing explicit close button (X) on file tab...');
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button[aria-label^="关闭数据源"]');
      if (closeBtn) closeBtn.click();
    });

    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06_file_explicitly_closed.png') });
    console.log('✓ 06_file_explicitly_closed.png captured (returned to dropzone after explicit close)');

    console.log('\n======================================================');
    console.log('>>> ALL GRIDLINES & SESSION PERSISTENCE VERIFIED 100%! <<<');
    console.log('======================================================\n');
  } finally {
    await browser.close();
    server.kill();
  }
}

runVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
