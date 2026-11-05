const path = require('path');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));
const { spawn } = require('child_process');

async function test() {
  const appDir = path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith');
  const server = spawn('cmd.exe', ['/c', 'npm', 'run', 'preview', '--', '--port', '1429', '--strictPort'], { cwd: appDir });
  await new Promise(r => setTimeout(r, 2000));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:1429');
  await page.evaluate(() => {
    window.__DATA_STORE__.getState().addFile({
      fileName: 'test.csv',
      fileType: 'csv',
      sheets: [{ name: 'S1', headers: ['Col1'], rows: [['Val1']] }]
    });
  });
  await new Promise(r => setTimeout(r, 800));
  const btn = await page.$('.ag-header-cell-filter-button');
  if (btn) await btn.click();
  await new Promise(r => setTimeout(r, 600));

  const rule = await page.evaluate(() => {
    const el = document.querySelector('.ag-filter .ag-input-wrapper');
    const b = window.getComputedStyle(el, '::before');
    // find matching rule
    for (const sheet of document.styleSheets) {
      try {
        for (const r of sheet.cssRules) {
          if (r.selectorText && r.selectorText.includes('::before')) {
            // check if el matches the selector (strip ::before)
            const baseSelector = r.selectorText.replace(/::before/g, '').trim();
            try {
              if (el.matches(baseSelector)) {
                return { selector: r.selectorText, cssText: r.cssText };
              }
            } catch (err) {}
          }
        }
      } catch (e) {}
    }
    return null;
  });

  console.log('Found matching rule for ::before:', JSON.stringify(rule, null, 2));

  await browser.close();
  spawn('taskkill', ['/pid', String(server.pid), '/f', '/t']);
}
test();
