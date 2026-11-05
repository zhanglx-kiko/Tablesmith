const path = require('path');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));
const { spawn } = require('child_process');

async function test() {
  const appDir = path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith');
  const server = spawn('cmd.exe', ['/c', 'npm', 'run', 'preview', '--', '--port', '1433', '--strictPort'], { cwd: appDir });
  await new Promise(r => setTimeout(r, 2000));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:1433');
  await page.evaluate(() => {
    window.__DATA_STORE__.getState().addFile({
      fileName: 'test.csv',
      fileType: 'csv',
      sheets: [{
        name: 'S1',
        headers: ['2024-01', '2024-02', 'Revenue'],
        rows: [['100', '200', '300']]
      }]
    });
  });
  await new Promise(r => setTimeout(r, 800));

  // Inject our SVG mask CSS and test how it looks
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      .ag-icon-filter::before {
        content: "" !important;
        display: inline-block !important;
        width: 13px !important;
        height: 13px !important;
        background-color: currentColor !important;
        mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3'%3E%3C/polygon%3E%3C/svg%3E") !important;
        -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3'%3E%3C/polygon%3E%3C/svg%3E") !important;
        mask-size: contain !important;
        -webkit-mask-size: contain !important;
        mask-repeat: no-repeat !important;
        -webkit-mask-repeat: no-repeat !important;
        mask-position: center !important;
        -webkit-mask-position: center !important;
      }
      .ag-header-cell-filter-button {
        opacity: 0.75 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 3px !important;
        border-radius: 4px !important;
        transition: all 0.15s ease !important;
      }
      .ag-header-cell-filter-button:hover {
        opacity: 1 !important;
        background-color: rgba(59, 130, 246, 0.12) !important;
        color: #2563eb !important;
      }
    `;
    document.head.appendChild(style);
  });
  await new Promise(r => setTimeout(r, 400));

  const header = await page.$('.ag-header');
  if (header) {
    await header.screenshot({ path: path.resolve(__dirname, '../screenshots/svg_filter_icon.png') });
    console.log('Saved svg_filter_icon.png');
  }

  // Hover over the filter button
  const filterBtn = await page.$('.ag-header-cell-filter-button');
  if (filterBtn) {
    await filterBtn.hover();
    await new Promise(r => setTimeout(r, 300));
    await header.screenshot({ path: path.resolve(__dirname, '../screenshots/svg_filter_icon_hover.png') });
    console.log('Saved svg_filter_icon_hover.png');
  }

  await browser.close();
  spawn('taskkill', ['/pid', String(server.pid), '/f', '/t']);
}
test();
