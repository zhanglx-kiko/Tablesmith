const path = require('path');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));
const { spawn } = require('child_process');

async function test() {
  const appDir = path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith');
  const server = spawn('cmd.exe', ['/c', 'npm', 'run', 'preview', '--', '--port', '1428', '--strictPort'], { cwd: appDir });
  await new Promise(r => setTimeout(r, 2000));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:1428');
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

  // Let's inspect the input wrapper's ::before in detail
  const detail = await page.evaluate(() => {
    const wrapper = document.querySelector('.ag-filter .ag-input-wrapper');
    const input = document.querySelector('.ag-filter input');

    // test removing ::before
    const s = document.createElement('style');
    s.id = 'test-hide-before';
    s.textContent = `
      .ag-filter .ag-input-wrapper::before { display: none !important; }
    `;
    document.head.appendChild(s);
  });

  await page.screenshot({ path: path.resolve(__dirname, '../screenshots/filter_without_before.png') });
  console.log('Saved filter_without_before.png');

  await browser.close();
  spawn('taskkill', ['/pid', String(server.pid), '/f', '/t']);
}
test();
