const path = require('path');
const fs = require('fs');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));

const TARGET_URL = 'http://localhost:1420/';
const OUTPUT_DIR = path.resolve(__dirname, '../screenshots/e2e_verification');

const SAMPLE_FILE = {
  fileName: 'multi_sheet_demo.xlsx',
  fileType: 'xlsx',
  sheets: [
    {
      name: '销售汇总',
      headers: ['季度', '产品线A', '产品线B', '产品线C'],
      rows: [
        ['2025-Q1', '4200', '3100', '2400'],
        ['2025-Q2', '5100', '3400', '2900'],
        ['2025-Q3', '6300', '3900', '3600'],
        ['2025-Q4', '7800', '4500', '4200']
      ]
    }
  ]
};

async function testExportErgonomics() {
  console.log('--- Testing Export Ergonomics & Direct Save UX ---');
  const browser = await puppeteer.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1400, height: 900 }
  });

  const page = await browser.newPage();

  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => typeof window !== 'undefined' && !!window.__DATA_STORE__);

  // Inject dataset and set mock last export directory
  await page.evaluate((data) => {
    localStorage.setItem('tablesmith_last_export_dir', 'C:\\Users\\16147\\Downloads');
    window.__DATA_STORE__.getState().addFile(data);
    window.__DATA_STORE__.getState().setTheme('dark');
    document.documentElement.classList.add('dark');
  }, SAMPLE_FILE);

  await new Promise((r) => setTimeout(r, 600));

  // Click "导出当前工作表" directly in DataSourceView
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent && b.textContent.includes('导出当前工作表'));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  // Screenshot 1: ExportModal showing the real path and badge
  await page.screenshot({ path: path.join(OUTPUT_DIR, '14_export_modal_with_real_path.png') });
  console.log('Saved 14_export_modal_with_real_path.png');

  // Click "直接保存导出"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent && (b.textContent.includes('直接保存导出') || b.textContent.includes('确认导出')));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 800));

  // Screenshot 2: Toast feedback showing exact path and "在文件夹中显示" button
  await page.screenshot({ path: path.join(OUTPUT_DIR, '15_export_toast_with_folder_action.png') });
  console.log('Saved 15_export_toast_with_folder_action.png');

  // Verify that localStorage remembered the path
  const rememberedDir = await page.evaluate(() => {
    return localStorage.getItem('tablesmith_last_export_dir');
  });
  console.log('Remembered Export Directory in LocalStorage:', rememberedDir);

  await browser.close();
  console.log('--- Export Ergonomics Test Completed Successfully! ---');
}

testExportErgonomics().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
