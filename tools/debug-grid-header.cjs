const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));

const TARGET_PORT = 1422;
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

    // Inject sample data with column name "2024-01"
    const sampleData = {
      fileName: 'test.xlsx',
      fileType: 'xlsx',
      sheets: [{
        name: 'Sheet1',
        headers: ['2024-01', '2024-02', 'Product', 'Revenue'],
        rows: [
          ['100', '200', 'Apple', '1000'],
          ['150', '250', 'Orange', '2000']
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

    // Get header DOM structure
    const headerInfo = await page.evaluate(() => {
      const headerCells = Array.from(document.querySelectorAll('.ag-header-cell'));
      return headerCells.map(cell => {
        const text = cell.querySelector('.ag-header-cell-text')?.textContent;
        const menuBtn = cell.querySelector('.ag-header-cell-menu-button');
        const filterBtn = cell.querySelector('.ag-filter-icon, [class*="filter"]');
        const allIcons = Array.from(cell.querySelectorAll('[class*="icon"], svg, span')).map(el => ({
          className: el.className,
          tagName: el.tagName,
          computedStyle: {
            display: window.getComputedStyle(el).display,
            visibility: window.getComputedStyle(el).visibility,
            opacity: window.getComputedStyle(el).opacity,
            color: window.getComputedStyle(el).color,
            fill: window.getComputedStyle(el).fill,
            width: window.getComputedStyle(el).width,
            height: window.getComputedStyle(el).height,
            backgroundColor: window.getComputedStyle(el).backgroundColor
          },
          innerHTML: el.innerHTML
        }));

        return {
          text,
          outerHTML: cell.outerHTML,
          menuBtn: menuBtn ? {
            className: menuBtn.className,
            outerHTML: menuBtn.outerHTML,
            computedStyle: {
              display: window.getComputedStyle(menuBtn).display,
              visibility: window.getComputedStyle(menuBtn).visibility,
              color: window.getComputedStyle(menuBtn).color,
              backgroundColor: window.getComputedStyle(menuBtn).backgroundColor,
              width: window.getComputedStyle(menuBtn).width,
              height: window.getComputedStyle(menuBtn).height,
            }
          } : null,
          allIcons
        };
      });
    });

    console.log('=== HEADER INFO ===');
    console.log(JSON.stringify(headerInfo[0], null, 2));

    // Capture screenshot of the header
    const headerEl = await page.$('.ag-header');
    if (headerEl) {
      await headerEl.screenshot({ path: path.resolve(__dirname, '../screenshots/debug_header.png') });
      console.log('Header screenshot saved to screenshots/debug_header.png');
    }

  } finally {
    if (browser) await browser.close();
    if (serverProc) spawn('taskkill', ['/pid', String(serverProc.pid), '/f', '/t']);
  }
}

run();
