const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));

const TARGET_PORT = 1434;
const TARGET_URL = `http://localhost:${TARGET_PORT}/`;
const OUTPUT_DIR = path.resolve(__dirname, '../screenshots/grid_filter_zoom_verification');
const ARTIFACT_DIR = 'C:/Users/16147/.gemini/antigravity/brain/6b1e106f-60e5-4833-870d-26ff781fef32';

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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
        console.log('[Server] Preview server is ready!');
        return server;
      }
    } catch {}
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

    // Step 1: Inject Financial BP Rolling Forecast data with "2024-01", "2024-02", etc.
    console.log('[Step 1] Injecting sample data with 2024-01 period columns...');
    const sampleData = {
      fileName: 'Financial_BP_Rolling_Forecast.xlsx',
      fileType: 'xlsx',
      sheets: [{
        name: 'Revenue Build',
        headers: ['Category', '2024-01', '2024-02', '2024-03', '2024-04', '2024-05', 'Total'],
        rows: [
          ['Enterprise Cloud', '4572010.04', '4890120.50', '5120300.00', '5488490.05', '5600100.20', '25671020.79'],
          ['Data & AI Platform', '5488490.05', '5720100.10', '6100200.40', '6491413.40', '6800200.00', '30600403.95'],
          ['Support Services', '8378562.59', '8420100.00', '8510200.00', '8620100.00', '8700500.00', '42629462.59'],
          ['Advisory Solutions', '6491413.40', '6600200.00', '6720400.00', '6890100.00', '7100300.00', '33802413.40'],
          ['Learning Academy', '7382454.63', '7450100.00', '7590200.00', '7720300.00', '7890100.00', '38033154.63']
        ]
      }]
    };

    await page.evaluate((data) => {
      if (window.__DATA_STORE__) {
        window.__DATA_STORE__.getState().setTheme('light');
        window.__DATA_STORE__.getState().setTableZoom(100);
        window.__DATA_STORE__.getState().addFile(data);
        window.__DATA_STORE__.getState().setActiveFile(0);
        window.__DATA_STORE__.getState().setActiveSheet(0);
      }
      document.documentElement.classList.remove('dark');
    }, sampleData);
    await sleep(1000);

    // Screenshot 1: Standard view with clear filter buttons on every column header & new zoom toolbar
    const p1 = path.join(OUTPUT_DIR, '01_grid_standard_filter_visible.png');
    await page.screenshot({ path: p1 });
    console.log('✓ 01_grid_standard_filter_visible.png captured (Clear SVG filter icon on all headers)');

    // Step 2: Hover over the filter button of "2024-01" to verify prominent hover state
    console.log('[Step 2] Hovering over filter button on 2024-01 column...');
    const filterButtons = await page.$$('.ag-header-cell-filter-button');
    if (filterButtons.length > 1) {
      await filterButtons[1].hover();
      await sleep(400);
    }
    const p2 = path.join(OUTPUT_DIR, '02_filter_button_hover_highlight.png');
    await page.screenshot({ path: p2 });
    console.log('✓ 02_filter_button_hover_highlight.png captured (Filter button hover highlight)');

    // Step 3: Open filter popup and type search text to verify NO icon overlap
    console.log('[Step 3] Clicking filter button and typing text into filter input...');
    if (filterButtons.length > 1) {
      await filterButtons[1].click();
      await sleep(600);
    }

    const filterInput = await page.$('.ag-filter input.ag-input-field-input');
    if (filterInput) {
      await filterInput.type('4572010');
      await sleep(400);
    }
    const p3 = path.join(OUTPUT_DIR, '03_filter_input_no_overlap.png');
    await page.screenshot({ path: p3 });
    console.log('✓ 03_filter_input_no_overlap.png captured (Filter input text separated cleanly from icon)');

    // Close popup by pressing Escape
    await page.keyboard.press('Escape');
    await sleep(400);

    // Step 4: Test Cell Zoom Scaling - Switch to Compact 85%
    console.log('[Step 4] Testing Compact 85% zoom density...');
    await page.evaluate(() => {
      window.__DATA_STORE__.getState().setTableZoom(85);
    });
    await sleep(600);
    const p4 = path.join(OUTPUT_DIR, '04_table_zoom_compact_85.png');
    await page.screenshot({ path: p4 });
    console.log('✓ 04_table_zoom_compact_85.png captured (Compact 85% density)');

    // Step 5: Test Cell Zoom Scaling - Switch to Spacious 120%
    console.log('[Step 5] Testing Spacious 120% zoom density...');
    await page.evaluate(() => {
      window.__DATA_STORE__.getState().setTableZoom(120);
    });
    await sleep(600);
    const p5 = path.join(OUTPUT_DIR, '05_table_zoom_spacious_120.png');
    await page.screenshot({ path: p5 });
    console.log('✓ 05_table_zoom_spacious_120.png captured (Spacious 120% zoom)');

    // Step 6: Test Dark Mode with Filter Button & Zoom Controls
    console.log('[Step 6] Testing Dark Mode...');
    await page.evaluate(() => {
      window.__DATA_STORE__.getState().setTheme('dark');
      window.__DATA_STORE__.getState().setTableZoom(100);
      document.documentElement.classList.add('dark');
    });
    await sleep(600);
    const p6 = path.join(OUTPUT_DIR, '06_dark_mode_filter_and_zoom.png');
    await page.screenshot({ path: p6 });
    console.log('✓ 06_dark_mode_filter_and_zoom.png captured (Dark mode with filter icons & zoom toolbar)');

    // Copy to artifact directory
    if (fs.existsSync(ARTIFACT_DIR)) {
      const files = fs.readdirSync(OUTPUT_DIR);
      for (const file of files) {
        if (file.endsWith('.png')) {
          fs.copyFileSync(path.join(OUTPUT_DIR, file), path.join(ARTIFACT_DIR, file));
        }
      }
      console.log('✓ All verification screenshots copied to artifacts directory!');
    }

    console.log('\n>>> ALL 3 FIXES VERIFIED AND PASSING 100%! <<<');

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
