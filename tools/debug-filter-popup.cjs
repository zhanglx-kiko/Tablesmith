const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));

const TARGET_PORT = 1423;
const TARGET_URL = `http://localhost:${TARGET_PORT}/`;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startPreviewServer() {
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
      if (ok) return server;
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

    // Inject sample data
    const sampleData = {
      fileName: 'Financial_BP_Rolling_Forecast.xlsx',
      fileType: 'xlsx',
      sheets: [{
        name: 'Revenue Build',
        headers: ['Category', '2024-01', '2024-02', '2024-03', '2024-04'],
        rows: [
          ['Software', '100', '200', '300', '400'],
          ['Hardware', '150', '250', '350', '450']
        ]
      }]
    };

    await page.evaluate((data) => {
      if (window.__DATA_STORE__) {
        window.__DATA_STORE__.getState().setTheme('light');
        window.__DATA_STORE__.getState().addFile(data);
        window.__DATA_STORE__.getState().setActiveFile(0);
        window.__DATA_STORE__.getState().setActiveSheet(0);
      }
    }, sampleData);

    await sleep(1000);

    // Click on filter button of first or second column
    console.log('Finding filter button...');
    const filterBtn = await page.$('.ag-header-cell-filter-button, .ag-icon-filter');
    if (filterBtn) {
      console.log('Clicking filter button...');
      await filterBtn.click();
      await sleep(1000);

      // Check popup
      const popupHtml = await page.evaluate(() => {
        const popup = document.querySelector('.ag-popup, .ag-filter, .ag-menu');
        return popup ? popup.outerHTML : 'no-popup';
      });
      console.log('Popup HTML length:', popupHtml.length);
      console.log('Popup HTML snippet:', popupHtml.slice(0, 1000));

      // Type some text in the filter input if present
      const input = await page.$('.ag-popup input, .ag-filter input');
      if (input) {
        await input.type('Software');
        await sleep(500);
      }

      await page.screenshot({ path: path.resolve(__dirname, '../screenshots/debug_filter_popup.png') });
      console.log('Filter popup screenshot saved to screenshots/debug_filter_popup.png');
    } else {
      console.log('No filter button found!');
    }

  } finally {
    if (browser) await browser.close();
    if (serverProc) spawn('taskkill', ['/pid', String(serverProc.pid), '/f', '/t']);
  }
}

run();
