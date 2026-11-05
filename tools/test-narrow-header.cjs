const path = require('path');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));
const { spawn } = require('child_process');

async function test() {
  const appDir = path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith');
  const server = spawn('cmd.exe', ['/c', 'npm', 'run', 'preview', '--', '--port', '1432', '--strictPort'], { cwd: appDir });
  await new Promise(r => setTimeout(r, 2000));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:1432');
  await page.evaluate(() => {
    window.__DATA_STORE__.getState().addFile({
      fileName: 'test.csv',
      fileType: 'csv',
      sheets: [{
        name: 'S1',
        headers: ['2024-01-Financial-Metric-Very-Long-Header', '2024-02', '2024-03'],
        rows: [['1', '2', '3']]
      }]
    });
  });
  await new Promise(r => setTimeout(r, 800));

  // Let's set the column width of 2024-01 to narrow (e.g. 70px)
  await page.evaluate(() => {
    // hover over first header cell
    const cell = document.querySelector('.ag-header-cell');
    if (cell) {
      cell.style.width = '75px';
    }
  });
  await new Promise(r => setTimeout(r, 300));

  const filterBtn = await page.$('.ag-header-cell-filter-button');
  if (filterBtn) {
    await filterBtn.hover();
    await new Promise(r => setTimeout(r, 300));
    const btnBox = await filterBtn.boundingBox();
    console.log('Filter button bounding box:', btnBox);
    const iconBox = await page.evaluate(() => {
      const icon = document.querySelector('.ag-header-cell-filter-button .ag-icon');
      if (!icon) return null;
      const rect = icon.getBoundingClientRect();
      const style = window.getComputedStyle(icon);
      return {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        color: style.color,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity
      };
    });
    console.log('Icon box & style:', iconBox);
  }

  const header = await page.$('.ag-header');
  if (header) {
    await header.screenshot({ path: path.resolve(__dirname, '../screenshots/narrow_header_hover.png') });
    console.log('Saved narrow_header_hover.png');
  }

  await browser.close();
  spawn('taskkill', ['/pid', String(server.pid), '/f', '/t']);
}
test();
