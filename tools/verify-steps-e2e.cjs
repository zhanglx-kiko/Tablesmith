#!/usr/bin/env node
// Step recording and replay on the desktop build: record steps on the workbook's Sales
// Detail sheet, undo one, save the step file, switch to sales_detail.csv and replay.
// The replayed row count must equal the recorded one (same data, different text).
// Opening a step file goes through the native file dialog, which cannot be driven
// here; parseRecipe / runRecipe on saved files are covered by recipe.test.ts, and this
// script checks the saved file parses back to the same steps.
// Usage: node tools/verify-steps-e2e.cjs   (needs a release build)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launchDesktopApp, importPaths, resetWorkspace, setTheme, ROOT } = require('./lib/desktop-app.cjs');

const MODEL = 'D:/tmp/excel/Financial_BP_Rolling_Forecast.xlsx';
const CSV = 'D:/tmp/excel/sales_detail.csv';
const OUT = path.join(ROOT, 'screenshots', 'steps_e2e');
const SAVE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tablesmith-steps-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function clickText(page, text, scope = 'button') {
  const ok = await page.evaluate(
    (t, s) => {
      const el = [...document.querySelectorAll(s)].find((b) => b.textContent.trim().includes(t) && !b.disabled);
      el?.click();
      return Boolean(el);
    },
    text,
    scope,
  );
  await sleep(500);
  return ok;
}

async function selectByLabel(page, labelText, optionText) {
  return page.evaluate(
    (l, o) => {
      const label = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(l));
      const sel = label?.querySelector('select');
      const opt = sel && [...sel.options].find((x) => x.textContent.trim() === o);
      if (!sel || !opt) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    labelText,
    optionText,
  );
}

const stepLabels = (page) => page.$$eval('[data-testid="steps-list"] li', (lis) => lis.map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
/** Rows and columns shown in the "当前预览" counter. */
const preview = (page) =>
  page.evaluate(() => {
    const t = [...document.querySelectorAll('span')].find((s) => s.textContent.includes('当前预览'));
    const [rows, cols] = [...(t?.querySelectorAll('strong') ?? [])].map((x) => Number(x.textContent));
    return { rows, cols };
  });

/** Independent oracle: distinct values of one column in the raw CSV text. */
function distinctInCsv(file, column) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const i = header.indexOf(column);
  return new Set(lines.slice(1).map((l) => l.split(',')[i])).size;
}

(async () => {
  for (const f of [MODEL, CSV]) if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
  fs.mkdirSync(OUT, { recursive: true });
  const { page, close } = await launchDesktopApp();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await resetWorkspace(page);
    await setTheme(page, 'light');
    await page.evaluate((dir) => localStorage.setItem('tablesmith_last_export_dir', dir), SAVE_DIR);
    await importPaths(page, [MODEL, CSV]);
    await page.waitForFunction(() => document.querySelectorAll('[aria-label^="关闭数据源"]').length >= 2, { timeout: 60000 });
    await sleep(800);

    await page.click('a[href="/process"]');
    await page.waitForSelector('[data-testid="steps-panel"]', { timeout: 10000 });
    await selectByLabel(page, '数据文件', 'Financial_BP_Rolling_Forecast.xlsx');
    await sleep(400);
    check('switched to Sales Detail', await selectByLabel(page, '工作表', 'Sales Detail'));
    await sleep(800);
    const start = await preview(page);
    check('Sales Detail has 8640 rows x 15 columns', start.rows === 8640 && start.cols === 15, JSON.stringify(start));
    const expectedRows = distinctInCsv(CSV, 'list_price_usd');

    // Step 1: trim. Step 2: remove empty rows. Step 3: dedupe by list_price_usd (text is
    // 199 in the workbook, 199.00 in the CSV). Step 4: delete currency_code, then undone.
    await clickText(page, '修剪全部空格');
    await clickText(page, '清除空白行');
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === '__ALL__' && o.textContent.includes('全部列均相同')));
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, 'list_price_usd');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(300);
    await clickText(page, '执行去重');
    await clickText(page, '删列');
    await page.evaluate(() => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === 'currency_code');
      label?.querySelector('input')?.click();
    });
    await sleep(300);
    await clickText(page, '删除所选');
    let labels = await stepLabels(page);
    check('four steps recorded in order', labels.length === 4 && labels[0].includes('去除首尾空格') && labels[2].includes('list_price_usd') && labels[3].includes('currency_code'), labels.join(' | '));
    const deduped = await preview(page);
    check('dedupe really dropped rows (oracle: distinct prices in the raw CSV)', deduped.rows === expectedRows && expectedRows > 1 && expectedRows < 8640, `${deduped.rows} vs ${expectedRows}`);
    await page.screenshot({ path: path.join(OUT, '01_recorded.png') });

    await clickText(page, '撤销');
    labels = await stepLabels(page);
    const afterUndo = await preview(page);
    check('undo removes the last step and restores the column', labels.length === 3 && afterUndo.cols === 15 && afterUndo.rows === expectedRows, `${labels.length} steps, ${JSON.stringify(afterUndo)}`);
    const recordedRows = afterUndo.rows;

    await clickText(page, '保存步骤');
    await sleep(800);
    const saved = fs.readdirSync(SAVE_DIR).filter((f) => f.endsWith('.tablesmith-steps.json'));
    check('step file saved', saved.length === 1, saved.join(','));
    const recipe = saved.length ? JSON.parse(fs.readFileSync(path.join(SAVE_DIR, saved[0]), 'utf8')) : null;
    check('saved file holds the three steps', recipe?.version === 1 && recipe.steps.map((s) => s.op).join(',') === 'trim,removeEmptyRows,dedupe' && recipe.steps[2].columns?.[0] === 'list_price_usd', JSON.stringify(recipe?.steps));

    // Switch to the CSV: the panel offers the recorded steps.
    await selectByLabel(page, '数据文件', 'sales_detail.csv');
    await sleep(800);
    check('switching sheets offers replay', (await page.$('[data-testid="carried-steps"]')) !== null);
    await page.screenshot({ path: path.join(OUT, '02_offer_replay.png') });
    await clickText(page, '在当前表重放');
    await sleep(800);
    labels = await stepLabels(page);
    const replayed = await preview(page);
    check('replay runs the same three steps on the CSV', labels.length === 3 && labels[2].includes('list_price_usd'), labels.join(' | '));
    check('replayed row count equals the recorded one', replayed.rows === recordedRows && replayed.rows === expectedRows, `${replayed.rows} vs ${recordedRows}`);
    check('replay offer is gone after replaying', (await page.$('[data-testid="carried-steps"]')) === null);
    await page.screenshot({ path: path.join(OUT, '03_replayed.png') });

    await setTheme(page, 'dark');
    await page.screenshot({ path: path.join(OUT, '04_replayed_dark.png') });
    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await close();
    fs.rmSync(SAVE_DIR, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed; screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
