#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

// Robust module loader: local node_modules -> global npm -> tablesmith node_modules
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  try {
    const globalPath = path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer');
    puppeteer = require(globalPath);
  } catch (err) {
    const localTablesmith = path.resolve(__dirname, '../tablesmith/node_modules/puppeteer');
    puppeteer = require(localTablesmith);
  }
}

const TARGET_URL = process.env.TABLESMITH_URL || process.argv[2] || 'http://localhost:5173/';
const OUTPUT_DIR = process.env.TABLESMITH_SCREENSHOT_DIR || path.resolve(__dirname, '../screenshots');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

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
  console.log(`[Tablesmith Visual QA] Launching Chrome targeting ${TARGET_URL}...`);
  const browser = await puppeteer.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1366, height: 860 }
  });

  const page = await browser.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });

  // 1. Inject sample data into the Zustand store
  console.log('[1/6] Injecting standardized test dataset...');
  await page.evaluate((data) => {
    if (window.__DATA_STORE__) {
      window.__DATA_STORE__.getState().addFile(data);
    }
  }, SAMPLE_FILE);
  await new Promise((r) => setTimeout(r, 600));

  // 2. Enable Dark Mode
  console.log('[2/6] Enabling Global Dark Mode...');
  const darkBtn = await page.$('button[title="深色模式"]');
  if (darkBtn) await darkBtn.click();
  await new Promise((r) => setTimeout(r, 600));

  // Screenshot 1: DataSourceView with AG Grid in Dark Mode
  const p1 = path.join(OUTPUT_DIR, '01_datasource_grid_dark.png');
  await page.screenshot({ path: p1 });
  console.log(`Saved: ${p1}`);

  // Screenshot 2: ChartView in Dark Mode
  console.log('[3/6] Navigating to /chart...');
  await page.click('a[href="/chart"]');
  await new Promise((r) => setTimeout(r, 800));

  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const tagLabel = labels.find((l) => l.textContent && l.textContent.includes('数值标签'));
    if (tagLabel) {
      const input = tagLabel.querySelector('input[type="checkbox"]');
      if (input && !input.checked) input.click();
    }
  });
  await new Promise((r) => setTimeout(r, 800));
  const p2 = path.join(OUTPUT_DIR, '02_chart_view_dark.png');
  await page.screenshot({ path: p2 });
  console.log(`Saved: ${p2}`);

  // Screenshot 3: ProcessView Pivot Table in Dark Mode
  console.log('[4/6] Navigating to /process (Pivot Table)...');
  await page.click('a[href="/process"]');
  await new Promise((r) => setTimeout(r, 800));

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find((b) => b.textContent && b.textContent.includes('透视表'));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find((b) => b.textContent && b.textContent.includes('生成并预览透视表'));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const p3 = path.join(OUTPUT_DIR, '03_pivot_view_dark.png');
  await page.screenshot({ path: p3 });
  console.log(`Saved: ${p3}`);

  // Screenshot 4: ReportView in Dark Mode
  console.log('[5/6] Navigating to /report...');
  await page.click('a[href="/report"]');
  await new Promise((r) => setTimeout(r, 800));
  const p4 = path.join(OUTPUT_DIR, '04_report_view_dark.png');
  await page.screenshot({ path: p4 });
  console.log(`Saved: ${p4}`);

  // Screenshot 5: Switch back to Light Mode on Chart View
  console.log('[6/6] Verifying Light Mode...');
  const lightBtn = await page.$('button[title="浅色模式"]');
  if (lightBtn) await lightBtn.click();
  await new Promise((r) => setTimeout(r, 600));
  await page.click('a[href="/chart"]');
  await new Promise((r) => setTimeout(r, 800));
  const p5 = path.join(OUTPUT_DIR, '05_chart_view_light.png');
  await page.screenshot({ path: p5 });
  console.log(`Saved: ${p5}`);

  await browser.close();
  console.log('[Tablesmith Visual QA] All automated end-to-end screenshots generated successfully!');
}

run().catch((e) => {
  console.error('[Tablesmith Visual QA Error]:', e);
  process.exit(1);
});
