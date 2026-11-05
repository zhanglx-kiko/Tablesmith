const path = require('path');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));
const { spawn } = require('child_process');

async function test() {
  const appDir = path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith');
  const server = spawn('cmd.exe', ['/c', 'npm', 'run', 'preview', '--', '--port', '1427', '--strictPort'], { cwd: appDir });
  await new Promise(r => setTimeout(r, 2000));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:1427');
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

  const items = await page.evaluate(() => {
    const list = [];
    const all = document.querySelectorAll('.ag-filter *');
    for (const el of all) {
      const bg = window.getComputedStyle(el).backgroundImage;
      const before = window.getComputedStyle(el, '::before');
      const after = window.getComputedStyle(el, '::after');
      if (bg !== 'none') list.push({ tag: el.tagName, class: el.className, bg });
      if (before.content && before.content !== 'none' && before.content !== 'normal') {
        list.push({ tag: el.tagName, class: el.className, pseudo: '::before', content: before.content, bg: before.backgroundImage, font: before.fontFamily, left: before.left, width: before.width });
      }
      if (after.content && after.content !== 'none' && after.content !== 'normal') {
        list.push({ tag: el.tagName, class: el.className, pseudo: '::after', content: after.content, bg: after.backgroundImage });
      }
    }
    return list;
  });
  console.log('Items with bg or pseudo-content:\n', JSON.stringify(items, null, 2));

  await browser.close();
  spawn('taskkill', ['/pid', String(server.pid), '/f', '/t']);
}
test();
