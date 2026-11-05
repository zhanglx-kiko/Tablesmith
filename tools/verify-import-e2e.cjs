#!/usr/bin/env node
// End-to-end import check on the desktop build: files go through Rust (read_file_data),
// the worker and the store exactly as a native drop does; assertions read the rendered UI.
// Usage: node tools/verify-import-e2e.cjs   (needs a release build: npx tauri build --no-bundle)
const fs = require('fs');
const path = require('path');
const { launchDesktopApp, importPaths, resetWorkspace, setTheme, ROOT } = require('./lib/desktop-app.cjs');

const OUT = path.join(ROOT, 'screenshots/import_e2e');
const EDGE = path.join(ROOT, 'tablesmith/sample-data/edge-cases');
const REAL = 'D:/tmp/excel';
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ui(page) {
  return page.evaluate(() => {
    const text = (el) => (el.textContent || '').trim();
    const sheetBar = document.querySelector('[data-testid="sheet-tabs"]');
    return {
      files: [...document.querySelectorAll('button[aria-label^="关闭数据源: "]')].map((b) =>
        b.getAttribute('aria-label').replace('关闭数据源: ', ''),
      ),
      sheets: sheetBar ? [...sheetBar.querySelectorAll('button')].map(text) : [],
      headers: [...document.querySelectorAll('.ag-header-cell-text')].map(text),
      toasts: [...document.querySelectorAll('[data-testid="toast"]')].map((t) => ({
        type: t.getAttribute('data-type'),
        text: text(t),
      })),
    };
  });
}

async function waitUntil(page, predicate, timeout = 20000) {
  const start = Date.now();
  for (;;) {
    const state = await ui(page);
    if (predicate(state) || Date.now() - start > timeout) return state;
    await sleep(200);
  }
}

async function openFile(page, name) {
  await page.evaluate((n) => {
    const close = document.querySelector(`button[aria-label="关闭数据源: ${n}"]`);
    close?.parentElement?.click();
  }, name);
  await sleep(600);
}

async function openSheet(page, name) {
  await page.evaluate((n) => {
    const bar = document.querySelector('[data-testid="sheet-tabs"]');
    [...(bar?.querySelectorAll('button') ?? [])].find((b) => (b.textContent || '').trim() === n)?.click();
  }, name);
  await sleep(800);
}

(async () => {
  const { page, close } = await launchDesktopApp();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  try {
    await resetWorkspace(page);
    await setTheme(page, 'dark');

    // 1. Real financial workbook
    const t0 = Date.now();
    await importPaths(page, [path.join(REAL, 'Financial_BP_Rolling_Forecast.xlsx')]);
    let s = await waitUntil(page, (x) => x.files.length === 1 && x.sheets.length > 0);
    check('financial workbook imported', s.files[0] === 'Financial_BP_Rolling_Forecast.xlsx', `${Date.now() - t0} ms`);
    check('stacked tables split into sheets', s.sheets.some((n) => n.startsWith('Summary · Monthly trend')));
    check('notice toast for skipped rows', s.toasts.some((t) => t.type === 'info' && t.text.includes('说明行')));
    await openSheet(page, 'Revenue Build');
    s = await ui(page);
    check('Revenue Build month headers', s.headers.slice(0, 3).join('|') === 'Month|2024-01|2024-02', s.headers.slice(0, 3).join('|'));
    await page.screenshot({ path: path.join(OUT, '01_revenue_build_dark.png') });

    // 2. Several edge-case files at once, including one invalid file
    for (const b of await page.$$('button[aria-label="关闭提示"]')) await b.click().catch(() => {});
    await importPaths(page, ['report_layouts.xlsx', 'nested_wrapped.json', 'gbk_encoded.csv', 'invalid.json'].map((f) => path.join(EDGE, f)));
    s = await waitUntil(page, (x) => x.files.length === 4 && x.toasts.some((t) => t.type === 'error'));
    check('batch imported 3 of 4', s.files.length === 4, s.files.join(', '));
    const err = s.toasts.find((t) => t.type === 'error');
    check('invalid.json error toast with position', !!err && err.text.includes('invalid.json') && err.text.includes('第 1 行'), err?.text);
    check('GBK notice shown', s.toasts.some((t) => t.text.includes('gbk_encoded.csv') && t.text.includes('GB18030')));

    await openFile(page, 'gbk_encoded.csv');
    s = await ui(page);
    check('GBK csv headers', s.headers.join('|') === '客户|城市|金额|备注', s.headers.join('|'));

    await openFile(page, 'report_layouts.xlsx');
    s = await ui(page);
    check('merged two-level header', s.headers.includes('上半年 / Q1'), s.headers.join('|'));

    // 3. Dotted JSON columns render in AG Grid
    await openFile(page, 'nested_wrapped.json');
    const cityCells = await page.evaluate(() =>
      [...document.querySelectorAll('.ag-cell[col-id="c2"]')].map((c) => (c.textContent || '').trim()),
    );
    check('address.city column renders', cityCells.includes('Berlin') && cityCells.includes('Paris'), cityCells.join(','));
    await page.screenshot({ path: path.join(OUT, '02_nested_json_with_error_toast.png') });

    // 4. Light mode with the merged-header sheet
    await setTheme(page, 'light');
    await openFile(page, 'report_layouts.xlsx');
    await page.screenshot({ path: path.join(OUT, '03_merged_headers_light.png') });

    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed; screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
