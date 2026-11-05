const path = require('path');
const fs = require('fs');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));
const { spawn } = require('child_process');

async function test() {
  const appDir = path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith');
  const server = spawn('cmd.exe', ['/c', 'npm', 'run', 'preview', '--', '--port', '1426', '--strictPort'], { cwd: appDir });
  await new Promise(r => setTimeout(r, 2000));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:1426');
  await page.evaluate(() => {
    window.__DATA_STORE__.getState().addFile({
      fileName: 'test.csv',
      fileType: 'csv',
      sheets: [{ name: 'S1', headers: ['Col1'], rows: [['Val1']] }]
    });
  });
  await new Promise(r => setTimeout(r, 1000));
  const btn = await page.$('.ag-header-cell-filter-button');
  if (btn) await btn.click();
  await new Promise(r => setTimeout(r, 800));

  const info = await page.evaluate(() => {
    const el = document.querySelector('.ag-filter .ag-input-wrapper');
    const input = document.querySelector('.ag-filter input');
    if (!el) return 'no el';
    const b = window.getComputedStyle(el, '::before');
    const a = window.getComputedStyle(el, '::after');
    const ib = window.getComputedStyle(input, '::before');
    const ia = window.getComputedStyle(input, '::after');

    // Find all style rules in document.styleSheets that mention ag-text-field or ag-input-wrapper
    const matchedRules = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && (
            rule.selectorText.includes('ag-text-field') ||
            rule.selectorText.includes('ag-input-wrapper') ||
            rule.selectorText.includes('ag-filter')
          )) {
            if (rule.cssText.includes('::before') || rule.cssText.includes('::after') || rule.cssText.includes('icon') || rule.cssText.includes('background')) {
              matchedRules.push(rule.cssText);
            }
          }
        }
      } catch (e) {
        // ignore cross-origin
      }
    }

    return {
      wrapperBefore: {
        content: b.content,
        backgroundImage: b.backgroundImage,
        display: b.display,
        position: b.position,
        left: b.left,
        top: b.top,
        width: b.width,
        height: b.height,
        fontFamily: b.fontFamily,
      },
      wrapperAfter: {
        content: a.content,
        display: a.display,
      },
      matchedRules: matchedRules.slice(0, 30)
    };
  });

  console.log(JSON.stringify(info, null, 2));

  // Take zoomed screenshot of the filter input
  const popupEl = await page.$('.ag-menu.ag-filter-menu');
  if (popupEl) {
    await popupEl.screenshot({ path: path.resolve(__dirname, '../screenshots/filter_popup_zoom.png') });
    console.log('Saved filter_popup_zoom.png');
  }

  await browser.close();
  spawn('taskkill', ['/pid', String(server.pid), '/f', '/t']);
}
test();
