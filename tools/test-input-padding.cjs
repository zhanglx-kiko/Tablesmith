const path = require('path');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));
const { spawn } = require('child_process');

async function test() {
  const appDir = path.resolve('d:/code/zhanglx-index/disktopApp/tablesmith');
  const server = spawn('cmd.exe', ['/c', 'npm', 'run', 'preview', '--', '--port', '1431', '--strictPort'], { cwd: appDir });
  await new Promise(r => setTimeout(r, 2000));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:1431');
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

  const result = await page.evaluate(() => {
    const input = document.querySelector('.ag-filter input');
    if (!input) return null;
    const computed = window.getComputedStyle(input);
    const props = {};
    for (let i = 0; i < computed.length; i++) {
      const name = computed[i];
      if (name.includes('background') || name.includes('image') || name.includes('icon') || name.includes('padding') || name.includes('margin') || name.includes('appearance')) {
        props[name] = computed.getPropertyValue(name);
      }
    }
    return props;
  });

  console.log('Input computed properties:\n', JSON.stringify(result, null, 2));

  // Let's test two solutions:
  // Solution A: add padding-left: 20px so text is indented nicely past the icon
  // Solution B: remove background icon if background-image has it
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      .ag-filter input.ag-input-field-input {
        padding-left: 22px !important;
      }
    `;
    document.head.appendChild(style);
  });
  await new Promise(r => setTimeout(r, 300));
  const inputEl = await page.$('.ag-filter input');
  if (inputEl) {
    await inputEl.screenshot({ path: path.resolve(__dirname, '../screenshots/input_with_padding.png') });
    console.log('Saved input_with_padding.png');
  }

  // Solution C: remove background icon completely
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      .ag-filter input.ag-input-field-input {
        background-image: none !important;
        padding-left: 8px !important;
      }
    `;
    document.head.appendChild(style);
  });
  await new Promise(r => setTimeout(r, 300));
  if (inputEl) {
    await inputEl.screenshot({ path: path.resolve(__dirname, '../screenshots/input_no_bg_icon.png') });
    console.log('Saved input_no_bg_icon.png');
  }

  await browser.close();
  spawn('taskkill', ['/pid', String(server.pid), '/f', '/t']);
}
test();
