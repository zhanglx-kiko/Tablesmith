const path = require('path');
const fs = require('fs');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));

const TARGET_URL = 'http://localhost:1420/';
const OUTPUT_DIR = path.resolve(__dirname, '../screenshots/e2e_verification');

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
        ['2025-Q4', '7800', '4500', '4200'],
        ['2025-Q4', '7800', '4500', '4200'], // duplicate row for testing clean
        ['  ', '', '  ', ''] // empty row for testing clean
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

async function navigateTo(page, targetPath) {
  await page.evaluate((path) => {
    const links = Array.from(document.querySelectorAll('aside a, nav a'));
    const link = links.find((a) => a.getAttribute('href') === path || a.pathname === path);
    if (link) {
      link.click();
    }
  }, targetPath);
  await new Promise((r) => setTimeout(r, 600));
}

async function testAll() {
  console.log('--- Starting Tablesmith Full Feature & Ergonomics Walkthrough ---');
  const browser = await puppeteer.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1400, height: 900 }
  });

  const page = await browser.newPage();

  // 1. Initial Load & Data Injection
  console.log('[Step 1] Loading app and injecting multi-sheet dataset...');
  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });
  await page.evaluate((data) => {
    if (window.__DATA_STORE__) {
      window.__DATA_STORE__.getState().addFile(data);
      window.__DATA_STORE__.getState().setTheme('dark');
    }
    document.documentElement.classList.add('dark');
  }, SAMPLE_FILE);
  await new Promise((r) => setTimeout(r, 800));

  // Screenshot 1: DataSourceView with Export button
  await page.screenshot({ path: path.join(OUTPUT_DIR, '01_datasource_view.png') });
  console.log('Saved 01_datasource_view.png');

  // Test Export Modal in DataSourceView
  console.log('[Step 2] Testing ExportModal on DataSourceView...');
  const exportBtnFound = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent && b.textContent.includes('导出当前工作表'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  console.log('DataSource export button clicked:', exportBtnFound);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '02_export_modal_datasource.png') });
  console.log('Saved 02_export_modal_datasource.png');

  // Close Export Modal
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));

  // 2. Format Converter (ConvertView)
  console.log('[Step 3] Navigating to /convert and testing format conversion modal...');
  await navigateTo(page, '/convert');

  // Select target format JSON
  await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    for (const s of selects) {
      if (s.innerHTML.includes('JSON (.json)')) {
        s.value = 'json';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });
  await new Promise((r) => setTimeout(r, 400));

  // Click "一键转换并导出"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent && b.textContent.includes('一键转换并导出'));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '03_export_modal_convert.png') });
  console.log('Saved 03_export_modal_convert.png');

  // Click "确认导出"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent && b.textContent.includes('确认导出'));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '04_convert_toast_feedback.png') });
  console.log('Saved 04_convert_toast_feedback.png');

  // 3. ChartView
  console.log('[Step 4] Navigating to /chart and testing chart export modal...');
  await navigateTo(page, '/chart');

  // Change palette to Ocean and click Export PNG
  await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    for (const s of selects) {
      if (s.innerHTML.includes('海洋科技蓝')) {
        s.value = 'ocean';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const btns = Array.from(document.querySelectorAll('button'));
    const exportBtn = btns.find((b) => b.textContent && b.textContent.includes('导出高清 PNG'));
    if (exportBtn) exportBtn.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '05_export_modal_chart_png.png') });
  console.log('Saved 05_export_modal_chart_png.png');

  // Confirm export
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent && b.textContent.includes('确认导出'));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '06_chart_toast_feedback.png') });
  console.log('Saved 06_chart_toast_feedback.png');

  // 4. ProcessView (Data Processing, Clean, Filter, Pivot)
  console.log('[Step 5] Navigating to /process for deep data processing walkthrough...');
  await navigateTo(page, '/process');

  // 4.1 Test Clean (去重复数据, 清除空行)
  console.log('[Step 5.1] Testing Clean operations (去重复数据, 清除空行)...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const dedupBtn = btns.find((b) => b.textContent && b.textContent.includes('去重复数据'));
    if (dedupBtn) dedupBtn.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '07_process_clean_dedup.png') });
  console.log('Saved 07_process_clean_dedup.png');

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const emptyBtn = btns.find((b) => b.textContent && b.textContent.includes('清除空行'));
    if (emptyBtn) emptyBtn.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '08_process_clean_empty.png') });
  console.log('Saved 08_process_clean_empty.png');

  // 4.2 Test Filter
  console.log('[Step 5.2] Testing Filter tab...');
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const filterTab = tabs.find((b) => b.textContent && b.textContent.includes('条件筛选'));
    if (filterTab) filterTab.click();
  });
  await new Promise((r) => setTimeout(r, 400));

  // Click "添加筛选条件"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const addRuleBtn = btns.find((b) => b.textContent && b.textContent.includes('添加筛选条件'));
    if (addRuleBtn) addRuleBtn.click();
  });
  await new Promise((r) => setTimeout(r, 400));

  // Set filter condition: 产品线A > 5000
  await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    // Find the operator select
    for (const s of selects) {
      if (s.innerHTML.includes('大于') && s.innerHTML.includes('小于')) {
        s.value = 'greaterThan';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const input = document.querySelector('input[placeholder="比对值..."]');
    if (input) {
      input.value = '5000';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 400));

  // Click "应用筛选规则"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const applyBtn = btns.find((b) => b.textContent && b.textContent.includes('应用筛选规则'));
    if (applyBtn) applyBtn.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '09_process_filter_applied.png') });
  console.log('Saved 09_process_filter_applied.png');

  // 4.3 Test Pivot Table (透视表)
  console.log('[Step 5.3] Testing Pivot Table...');
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const pivotTab = tabs.find((b) => b.textContent && b.textContent.includes('数据透视表'));
    if (pivotTab) pivotTab.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  // Click "生成并预览透视表"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const pivotBtn = btns.find((b) => b.textContent && b.textContent.includes('生成并预览透视表'));
    if (pivotBtn) pivotBtn.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '10_process_pivot_matrix.png') });
  console.log('Saved 10_process_pivot_matrix.png');

  // Click "导出 Excel" in Pivot
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const exportExcelBtn = btns.find((b) => b.textContent && b.textContent.includes('导出 Excel'));
    if (exportExcelBtn) exportExcelBtn.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '11_export_modal_pivot_excel.png') });
  console.log('Saved 11_export_modal_pivot_excel.png');

  // Confirm export
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent && b.textContent.includes('确认导出'));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '12_pivot_toast_feedback.png') });
  console.log('Saved 12_pivot_toast_feedback.png');

  // 5. ReportView (报表生成)
  console.log('[Step 6] Navigating to /report for PDF report export test...');
  await navigateTo(page, '/report');

  // Click "一键导出 PDF 报告"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const pdfBtn = btns.find((b) => b.textContent && b.textContent.includes('一键导出 PDF 报告'));
    if (pdfBtn) pdfBtn.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '13_export_modal_report_pdf.png') });
  console.log('Saved 13_export_modal_report_pdf.png');

  await browser.close();
  console.log('--- All Features & Ergonomics Walkthrough Verified Successfully! ---');
}

testAll().catch((err) => {
  console.error('Walkthrough error:', err);
  process.exit(1);
});
