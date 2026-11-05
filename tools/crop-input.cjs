const path = require('path');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));
const { spawn } = require('child_process');

async function test() {
  const appDir = path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith');
  const server = spawn('cmd.exe', ['/c', 'npm', 'run', 'preview', '--', '--port', '1430', '--strictPort'], { cwd: appDir });
  await new Promise(r => setTimeout(r, 2000));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:1430');
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

  const input = await page.$('.ag-filter input');
  if (input) {
    await input.screenshot({ path: path.resolve(__dirname, '../screenshots/input_zoom_raw.png') });
    console.log('Saved input_zoom_raw.png');
  }

  // Also let's check what pseudo element or SVG is inside the filter
  const svgOrIcons = await page.evaluate(() => {
    const filter = document.querySelector('.ag-filter');
    return Array.from(filter.querySelectorAll('*')).map(el => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        className: el.className,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        text: el.textContent
      };
    });
  });
  console.log('All elements in filter:', JSON.stringify(svgOrIcons, null, 2));

  await browser.close();
  spawn('taskkill', ['/pid', String(server.pid), '/f', '/t']);
}
test();
