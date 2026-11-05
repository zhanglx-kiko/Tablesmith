#!/usr/bin/env node
// End-to-end import check in a real browser: uploads files through the app's own file
// input (worker parsing, toasts, grid rendering) and saves screenshots.
// Usage: node tools/verify-import-e2e.cjs [url]   (dev server must be running)
const path = require('path');
const fs = require('fs');

let puppeteer;
try {
  puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));
} catch {
  puppeteer = require(path.resolve(__dirname, '../tablesmith/node_modules/puppeteer'));
}

const TARGET_URL = process.argv[2] || 'http://localhost:1420/';
const OUT = path.resolve(__dirname, '../screenshots/import_e2e');
const EDGE = path.resolve(__dirname, '../tablesmith/sample-data/edge-cases');
const REAL = 'D:/tmp/excel';
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function upload(page, files) {
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 5000 }),
    page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('导入文件'));
      (btn || document.querySelector('[role="button"]')).click();
    }),
  ]);
  await chooser.accept(files);
}

async function state(page) {
  return page.evaluate(() => {
    const s = window.__DATA_STORE__.getState();
    return {
      files: s.files.map((f) => ({ name: f.fileName, sheets: f.sheets.map((x) => ({ name: x.name, headers: x.headers, rows: x.rows.length })) })),
      toasts: s.toasts.map((t) => ({ type: t.type, title: t.title, message: t.message || '' })),
    };
  });
}

async function waitFor(page, predicate, timeout = 20000) {
  const start = Date.now();
  for (;;) {
    const s = await state(page);
    if (predicate(s)) return s;
    if (Date.now() - start > timeout) return s;
    await new Promise((r) => setTimeout(r, 200));
  }
}

(async () => {
  const browser = await puppeteer.launch({ channel: 'chrome', headless: true, defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    const s = window.__DATA_STORE__.getState();
    for (let i = s.files.length - 1; i >= 0; i -= 1) s.removeFile(i);
    s.setTheme('dark');
  });
  await page.waitForSelector('[role="button"]');

  // 1. Real financial workbook
  const t0 = Date.now();
  await upload(page, [path.join(REAL, 'Financial_BP_Rolling_Forecast.xlsx')]);
  let s = await waitFor(page, (x) => x.files.length === 1);
  const bp = s.files[0];
  check('financial workbook imported', !!bp, `${Date.now() - t0} ms`);
  const revenue = bp?.sheets.find((x) => x.name === 'Revenue Build');
  check('Revenue Build month headers', revenue?.headers.slice(0, 3).join('|') === 'Month|2024-01|2024-02', revenue?.headers.slice(0, 3).join('|'));
  check('Sales Detail rows', bp?.sheets.find((x) => x.name === 'Sales Detail')?.rows === 8640);
  check('notice toast for skipped rows', s.toasts.some((t) => t.type === 'info' && t.message.includes('说明行')));
  await page.evaluate(() => {
    const st = window.__DATA_STORE__.getState();
    st.setActiveSheet(st.files[0].sheets.findIndex((x) => x.name === 'Revenue Build'));
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUT, '01_revenue_build_dark.png') });

  // 2. Several edge-case files at once, including one invalid file
  await page.evaluate(() => window.__DATA_STORE__.setState({ toasts: [] }));
  await upload(page, ['report_layouts.xlsx', 'nested_wrapped.json', 'gbk_encoded.csv', 'invalid.json'].map((f) => path.join(EDGE, f)));
  s = await waitFor(page, (x) => x.files.length === 4 && x.toasts.some((t) => t.type === 'error'));
  check('batch imported 3 of 4', s.files.length === 4, s.files.map((f) => f.name).join(', '));
  const err = s.toasts.find((t) => t.type === 'error');
  check('invalid.json error toast with position', !!err && err.title.includes('invalid.json') && err.message.includes('第 1 行'), err?.message);
  const gbk = s.files.find((f) => f.name === 'gbk_encoded.csv');
  check('GBK csv headers', gbk?.sheets[0].headers.join('|') === '客户|城市|金额|备注');
  const report = s.files.find((f) => f.name === 'report_layouts.xlsx');
  check('merged two-level header', report?.sheets[0].headers.includes('上半年 / Q1'));

  // 3. Dotted JSON columns render in AG Grid
  await page.evaluate(() => {
    const st = window.__DATA_STORE__.getState();
    st.setActiveFile(st.files.findIndex((f) => f.fileName === 'nested_wrapped.json'));
  });
  await new Promise((r) => setTimeout(r, 800));
  const cityCells = await page.evaluate(() =>
    [...document.querySelectorAll('.ag-cell[col-id="c2"]')].map((c) => c.textContent.trim()),
  );
  check('address.city column renders', cityCells.includes('Berlin') && cityCells.includes('Paris'), cityCells.join(','));
  await page.screenshot({ path: path.join(OUT, '02_nested_json_with_error_toast.png') });

  // 4. Light mode with the merged-header sheet
  await page.evaluate(() => {
    const st = window.__DATA_STORE__.getState();
    st.setTheme('light');
    st.setActiveFile(st.files.findIndex((f) => f.fileName === 'report_layouts.xlsx'));
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUT, '03_merged_headers_light.png') });

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed; screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
