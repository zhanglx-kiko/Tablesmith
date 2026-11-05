const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.resolve('C:/Users/16147/.gemini/antigravity/brain/6b1e106f-60e5-4833-870d-26ff781fef32/scratch');

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
    },
    {
      name: '成本与利润',
      headers: ['季度', '总营收', '研发成本', '营销成本', '净利润'],
      rows: [
        ['2025-Q1', '9700', '3000', '2200', '4500'],
        ['2025-Q2', '11400', '3200', '2500', '5700'],
        ['2025-Q3', '13800', '3500', '2800', '7500'],
        ['2025-Q4', '16500', '4000', '3200', '9300']
      ]
    }
  ]
};

async function run() {
  console.log('Launching Chrome for end-to-end visual review...');
  const browser = await puppeteer.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1366, height: 860 }
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });

  // 1. Inject sample data into the Zustand store
  console.log('Injecting sample data into store...');
  await page.evaluate((data) => {
    window.__DATA_STORE__.getState().addFile(data);
  }, SAMPLE_FILE);
  await new Promise((r) => setTimeout(r, 600));

  // 2. Click Dark Mode button
  console.log('Enabling Dark Mode...');
  const darkBtn = await page.$('button[title="深色模式"]');
  if (darkBtn) await darkBtn.click();
  await new Promise((r) => setTimeout(r, 600));

  // Screenshot 1: DataSourceView with AG Grid in Dark Mode
  await page.screenshot({ path: path.join(OUTPUT_DIR, '01_datasource_grid_dark.png') });
  console.log('Saved 01_datasource_grid_dark.png');

  // Screenshot 2: ChartView in Dark Mode
  console.log('Visiting /chart ...');
  await page.click('a[href="/chart"]');
  await new Promise((r) => setTimeout(r, 800));

  // Enable "数值标签" checkbox if available
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const tagLabel = labels.find(l => l.textContent && l.textContent.includes('数值标签'));
    if (tagLabel) {
      const input = tagLabel.querySelector('input[type="checkbox"]');
      if (input && !input.checked) input.click();
    }
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '02_chart_view_dark.png') });
  console.log('Saved 02_chart_view_dark.png');

  // Screenshot 3: ProcessView Pivot Table in Dark Mode
  console.log('Visiting /process ...');
  await page.click('a[href="/process"]');
  await new Promise((r) => setTimeout(r, 800));

  // Click pivot tab
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent && b.textContent.includes('透视表'));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  // Click "生成并预览透视表"
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent && b.textContent.includes('生成并预览透视表'));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '03_pivot_view_dark.png') });
  console.log('Saved 03_pivot_view_dark.png');

  // Screenshot 4: ReportView in Dark Mode
  console.log('Visiting /report ...');
  await page.click('a[href="/report"]');
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '04_report_view_dark.png') });
  console.log('Saved 04_report_view_dark.png');

  // Screenshot 4b: ConvertView in Dark Mode
  console.log('Visiting /convert ...');
  await page.click('a[href="/convert"]');
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '06_convert_view_dark.png') });
  console.log('Saved 06_convert_view_dark.png');

  // Screenshot 5: Switch back to Light Mode on Chart View to verify Light Mode too
  console.log('Switching to Light Mode for comparison...');
  const lightBtn = await page.$('button[title="浅色模式"]');
  if (lightBtn) await lightBtn.click();
  await new Promise((r) => setTimeout(r, 600));
  await page.click('a[href="/chart"]');
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '05_chart_view_light.png') });
  console.log('Saved 05_chart_view_light.png');

  await browser.close();
  console.log('All automated screenshots generated successfully!');
}

run().catch((e) => {
  console.error('Error during visual verification:', e);
  process.exit(1);
});
