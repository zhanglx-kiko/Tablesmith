const path = require('path');
const fs = require('fs');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));

const TARGET_URL = 'http://localhost:1420/';
const OUTPUT_DIR = path.resolve(__dirname, '../screenshots');

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

async function run() {
  const browser = await puppeteer.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1366, height: 860 }
  });

  const page = await browser.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });

  // 1. Inject data and enable dark mode
  await page.evaluate((data) => {
    if (window.__DATA_STORE__) {
      window.__DATA_STORE__.getState().addFile(data);
      window.__DATA_STORE__.getState().setTheme('dark');
    }
    document.documentElement.classList.add('dark');
  }, SAMPLE_FILE);
  await new Promise((r) => setTimeout(r, 600));

  // Navigate to Chart
  await page.goto(TARGET_URL + 'chart', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));

  // Screenshot 1: Ocean theme (Blue)
  console.log('Testing Ocean Theme...');
  await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    // Palette theme select is the 4th select in ChartPanel
    for (const s of selects) {
      if (s.innerHTML.includes('商务经典')) {
        s.value = 'ocean';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '06_chart_ocean_blue_dark.png') });

  // Screenshot 2: Purple theme with Light tone (68%)
  console.log('Testing Purple Theme with Light tone...');
  await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    for (const s of selects) {
      if (s.innerHTML.includes('商务经典')) {
        s.value = 'purple';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    // Click '浅亮' button
    const buttons = Array.from(document.querySelectorAll('button'));
    const lightBtn = buttons.find((b) => b.textContent && b.textContent.includes('浅亮'));
    if (lightBtn) lightBtn.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '07_chart_purple_light_tone.png') });

  // Screenshot 3: Green theme with Deep tone (32%)
  console.log('Testing Green Theme with Deep tone...');
  await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    for (const s of selects) {
      if (s.innerHTML.includes('商务经典')) {
        s.value = 'green';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    // Click '浓郁' button
    const buttons = Array.from(document.querySelectorAll('button'));
    const deepBtn = buttons.find((b) => b.textContent && b.textContent.includes('浓郁'));
    if (deepBtn) deepBtn.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '08_chart_green_deep_tone.png') });

  // 4. Test DataSource cancel file picker
  console.log('Testing FileDropZone cancel behavior...');
  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    if (window.__DATA_STORE__) {
      window.__DATA_STORE__.setState({ files: [], activeFileIndex: 0 });
    }
  });
  await new Promise((r) => setTimeout(r, 600));
  // At this point, files = [], dropzone is visible.
  // Click dropzone to trigger input creation, then dispatch cancel event
  const cancelTestResult = await page.evaluate(() => {
    const dropzone = document.querySelector('p');
    const dropzoneCard = dropzone ? dropzone.closest('.cursor-pointer') : null;
    if (!dropzoneCard) return 'No dropzone';
    dropzoneCard.click();
    // Find the created input
    const input = document.querySelector('input[type="file"]');
    if (!input) return 'No input created';
    // Dispatch cancel event
    input.dispatchEvent(new Event('cancel'));
    return 'Dispatched cancel successfully';
  });
  console.log('Cancel test dispatch:', cancelTestResult);
  await new Promise((r) => setTimeout(r, 500));
  
  // Verify if it is still loading or returned to normal
  const isStillLoading = await page.evaluate(() => {
    return document.body.innerText.includes('正在解析文件');
  });
  console.log('Is still loading after cancel?:', isStillLoading);
  await page.screenshot({ path: path.join(OUTPUT_DIR, '09_datasource_after_cancel.png') });

  await browser.close();
  console.log('Targeted verification finished successfully!');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
