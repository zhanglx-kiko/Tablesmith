#!/usr/bin/env node
// End-to-end check of Excel-format display on the desktop build: what the grid shows in
// each mode, the hover alternative, numeric vs text filtering, sorting by raw value and
// the export content choice. Values are compared with what desktop Excel shows for the
// same cells (the private reference from scripts/excel-reference.ps1, kept under the
// ignored src-tauri/target/excel-reference/ because the workbook is the user's file).
// Usage: node tools/verify-display-e2e.cjs   (needs a release build)
const path = require('path');
const fs = require('fs');
const { launchDesktopApp, importPaths, resetWorkspace, setTheme, ROOT } = require('./lib/desktop-app.cjs');

const MODEL = 'D:/tmp/excel/Financial_BP_Rolling_Forecast.xlsx';
const OUT = path.join(ROOT, 'screenshots', 'display_e2e');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function openSheet(page, name) {
  await page.evaluate((n) => {
    const bar = document.querySelector('[data-testid="sheet-tabs"]');
    const btn = [...(bar?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === n);
    btn?.click();
  }, name);
  await page.waitForFunction(() => document.querySelectorAll('.ag-center-cols-container .ag-row').length > 0);
  await sleep(500);
}

/** First-column label -> rendered text of one data column, for rows in view. */
async function columnTexts(page, colIndex) {
  return page.evaluate((ci) => {
    const out = {};
    const left = document.querySelectorAll('.ag-center-cols-container .ag-row');
    for (const row of left) {
      const cells = row.querySelectorAll('.ag-cell');
      const label = cells[0]?.textContent.trim();
      if (label) out[label] = cells[ci]?.textContent.trim() ?? '';
    }
    return out;
  }, colIndex);
}

async function setMode(page, label) {
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('[data-testid="value-mode"] button')].find((b) => b.textContent.trim() === l);
    btn?.click();
  }, label);
  await sleep(400);
}

(async () => {
  if (!fs.existsSync(MODEL)) throw new Error(`missing ${MODEL}`);
  fs.mkdirSync(OUT, { recursive: true });
  const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'tablesmith/src-tauri/target/excel-reference/Financial_BP_Rolling_Forecast.xlsx.json'), 'utf8'));
  // Excel's own text for P&L column B (Jan-24), keyed by the label in column A.
  const pnl = ref.sheets.find((s) => s.name === 'P&L');
  const byRow = new Map();
  for (const [r, c, value, , text] of pnl.cells) {
    const e = byRow.get(r) ?? {};
    if (c === 0) e.label = value;
    if (c === 1) Object.assign(e, { value, text });
    byRow.set(r, e);
  }
  const excelJan = {};
  const rawJan = {};
  for (const e of byRow.values()) if (e.label && e.text) { excelJan[e.label.trim()] = e.text.trim(); rawJan[e.label.trim()] = e.value; }

  const { page, close } = await launchDesktopApp();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await resetWorkspace(page);
    await setTheme(page, 'light');
    await importPaths(page, [MODEL]);
    await page.waitForSelector('[data-testid="sheet-tabs"]', { timeout: 30000 });
    await openSheet(page, 'P&L');

    check('value-mode toggle is shown for formatted sheets', (await page.$('[data-testid="value-mode"]')) !== null);
    await setMode(page, 'Excel 格式');
    const shownExcel = await columnTexts(page, 1);
    const rowsChecked = Object.keys(shownExcel).filter((k) => excelJan[k] !== undefined);
    const excelMismatch = rowsChecked.filter((k) => shownExcel[k] !== excelJan[k]);
    check('Excel mode: Jan-24 column equals what Excel shows', rowsChecked.length >= 10 && excelMismatch.length === 0,
      `${rowsChecked.length} rows, mismatched: ${excelMismatch.map((k) => `${k} ours=${shownExcel[k]} excel=${excelJan[k]}`).join('; ')}`);
    await page.screenshot({ path: path.join(OUT, '01_pnl_excel_mode.png') });

    // Hover shows the raw value.
    const netRevenue = await page.evaluateHandle(() => {
      const row = [...document.querySelectorAll('.ag-center-cols-container .ag-row')].find((r) => r.querySelector('.ag-cell')?.textContent.trim() === 'Net revenue');
      return row?.querySelectorAll('.ag-cell')[1];
    });
    const box = await netRevenue.asElement()?.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(900);
    }
    // The cell is a formula in the model, so a `公式：` line comes first.
    const tipExcel = await page.$eval('.ag-tooltip', (e) => e.innerText.trim()).catch(() => '');
    check('Excel mode hover shows the raw value', tipExcel.split('\n').at(-1) === `原始值：${rawJan['Net revenue']}`, tipExcel);
    await page.screenshot({ path: path.join(OUT, '02_hover_raw.png') });
    await page.mouse.move(5, 5);
    await sleep(300);

    await setMode(page, '原始值');
    const shownRaw = await columnTexts(page, 1);
    const rawMismatch = rowsChecked.filter((k) => shownRaw[k] !== rawJan[k]);
    check('raw mode: Jan-24 column equals the stored value', rawMismatch.length === 0,
      rawMismatch.map((k) => `${k} ours=${shownRaw[k]} raw=${rawJan[k]}`).join('; '));
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(900);
    }
    const tipRaw = await page.$eval('.ag-tooltip', (e) => e.innerText.trim()).catch(() => '');
    check('raw mode hover shows the Excel text', tipRaw.split('\n').at(-1) === `Excel 显示：${excelJan['Net revenue']}`, tipRaw);
    await page.screenshot({ path: path.join(OUT, '03_raw_mode_hover_excel.png') });
    await page.mouse.move(5, 5);

    // Mode survives a restart of the view (persisted preference).
    const persisted = await page.evaluate(() => localStorage.getItem('tablesmith_value_mode'));
    check('mode is persisted', persisted === 'raw', String(persisted));
    await setMode(page, 'Excel 格式');

    // Semantics line next to the row count.
    const semantics = await page.$eval('[data-testid="value-semantics"]', (e) => e.textContent.trim()).catch(() => '');
    check('footer states what filters and sorting use', semantics.includes('原始值'), semantics);

    // Numeric filter on the margin row's column uses raw numbers: Gross margin is 61.4%
    // on screen; "大于 0.61" must keep it, "大于 61" must not.
    await page.click('.ag-header-cell[col-id="c1"] .ag-header-cell-filter-button');
    await sleep(400);
    const filterInput = await page.$('.ag-filter input.ag-input-field-input');
    await filterInput.click({ clickCount: 3 });
    await page.select('.ag-filter select', 'greaterThan').catch(() => {});
    const pickGreater = await page.evaluate(() => {
      const picker = document.querySelector('.ag-filter .ag-picker-field-wrapper');
      picker?.click();
      return true;
    });
    await sleep(200);
    await page.evaluate(() => {
      const opt = [...document.querySelectorAll('.ag-list-item, .ag-select-list-item')].find((o) => o.textContent.trim() === '大于');
      opt?.click();
    });
    await sleep(200);
    await filterInput.type('0.61');
    await sleep(700);
    const keptLow = await columnTexts(page, 1);
    await filterInput.click({ clickCount: 3 });
    await filterInput.type('61');
    await sleep(700);
    const keptHigh = await columnTexts(page, 1);
    check('number filter compares raw values (> 0.61 keeps 61.4%)', keptLow['Gross margin'] === '61.4%' && pickGreater, JSON.stringify(Object.keys(keptLow).slice(0, 6)));
    check('number filter does not match on the text (> 61 drops 61.4%)', keptHigh['Gross margin'] === undefined, JSON.stringify(Object.keys(keptHigh).slice(0, 6)));
    await page.screenshot({ path: path.join(OUT, '04_number_filter_raw.png') });
    await page.click('[data-testid="filter-status"] button').catch(() => {});
    await page.keyboard.press('Escape');
    await sleep(400);

    // Export dialog offers the content choice with raw selected.
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('导出当前工作表'));
      btn?.click();
    });
    await page.waitForSelector('[data-testid="export-content"]', { timeout: 5000 }).catch(() => {});
    const exportChoice = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="export-content"]');
      if (!box) return null;
      const radios = [...box.querySelectorAll('input[type=radio]')];
      return { labels: box.textContent, checked: radios.map((r) => r.checked) };
    });
    check('export dialog offers raw / Excel text with raw selected',
      exportChoice !== null && exportChoice.checked[0] === true && exportChoice.checked[1] === false && exportChoice.labels.includes('原始值'),
      JSON.stringify(exportChoice));
    await page.screenshot({ path: path.join(OUT, '05_export_choice.png') });
    await page.keyboard.press('Escape');
    await sleep(300);

    await setTheme(page, 'dark');
    await openSheet(page, 'P&L');
    await page.screenshot({ path: path.join(OUT, '06_pnl_excel_mode_dark.png') });

    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed; screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
