#!/usr/bin/env node
// End-to-end check of formula display on the desktop build, with the Excel-built fixture
// sample-data/edge-cases/formulas.{xlsx,xls,xlsb} and Excel's own formula list
// (sample-data/excel-reference/formulas.json): corner mark on exactly the formula cells,
// hover text, the formula bar on click, the health finding for typed-over cells, and
// that a column filter keeps each formula next to its own value.
// Usage: node tools/verify-formulas-e2e.cjs   (needs a release build)
const path = require('path');
const fs = require('fs');
const { launchDesktopApp, importPaths, resetWorkspace, setTheme, ROOT } = require('./lib/desktop-app.cjs');

const EDGE = path.join(ROOT, 'tablesmith/sample-data/edge-cases');
const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'tablesmith/sample-data/excel-reference/formulas.json'), 'utf8'));
const OUT = path.join(ROOT, 'screenshots', 'formulas_e2e');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// Excel's formulas on the 订单 sheet by data row (sheet row - 1) and column, without
// header-row formulas and `=""` (not shown by design).
const WANT = new Map(
  REF.filter((c) => c.sheet === '订单' && c.row > 0 && c.formula !== '""').map((c) => [`${c.row - 1},${c.col}`, c.formula]),
);

/** AG Grid renders only the columns in view; columns 0-5 fit on the left, 6-10 on the right. */
async function scrollTo(page, side) {
  await page.evaluate((s) => {
    const vp = document.querySelector('.ag-body-horizontal-scroll-viewport');
    if (vp) vp.scrollLeft = s === 'right' ? vp.scrollWidth : 0;
  }, side);
  await sleep(400);
}

/** Rendered grid: rowIndex,colIndex -> { mark, text } for every cell in view. */
async function gridCells(page) {
  return page.evaluate(() => {
    const out = {};
    for (const row of document.querySelectorAll('.ag-center-cols-container .ag-row')) {
      const r = row.getAttribute('row-index');
      for (const cell of row.querySelectorAll('.ag-cell')) {
        const c = Number(cell.getAttribute('col-id').slice(1));
        out[`${r},${c}`] = { mark: cell.classList.contains('ts-formula-cell'), text: cell.textContent.trim() };
      }
    }
    return out;
  });
}

async function cellBox(page, rowIndex, col) {
  await scrollTo(page, col > 5 ? 'right' : 'left');
  const h = await page.evaluateHandle(
    (r, c) => document.querySelector(`.ag-center-cols-container .ag-row[row-index="${r}"] .ag-cell[col-id="c${c}"]`),
    rowIndex,
    col,
  );
  const el = h.asElement();
  if (!el) return null;
  await el.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'center' }));
  await sleep(200);
  return el.boundingBox();
}

async function hoverText(page, rowIndex, col) {
  await page.mouse.move(5, 5);
  await sleep(300);
  const box = await cellBox(page, rowIndex, col);
  if (!box) return '';
  // Two moves inside the cell so AG Grid sees the pointer enter it.
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.waitForSelector('.ag-tooltip', { timeout: 3000 }).catch(() => null);
  await sleep(200);
  return page.$eval('.ag-tooltip', (e) => e.innerText.trim()).catch(() => '');
}

/** Click a cell as a user would; waits past the tooltip delay so a shown tooltip must not block it. */
async function clickCell(page, rowIndex, col) {
  const box = await cellBox(page, rowIndex, col);
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(700);
  return page.$eval('[data-testid="formula-bar-text"]', (e) => e.value).catch(() => null);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { page, close } = await launchDesktopApp();
  try {
    await setTheme(page, 'light');
    for (const ext of ['xlsx', 'xls', 'xlsb']) {
      await resetWorkspace(page);
      await importPaths(page, [path.join(EDGE, `formulas.${ext}`)]);
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 20000 });
      await sleep(800);
      // Excel saved every result (including the `=1/0` error), so no import notice.
      const uncachedNotice = await page.evaluate(() => document.body.innerText.includes('没有保存计算结果'));
      check(`${ext}: no "uncached formula" notice`, !uncachedNotice);
      // Wide enough that every column renders (AG Grid virtualises off-screen columns).
      await page.evaluate(() => document.querySelector('[aria-label="自适应列宽"], button[title*="自适应"]')?.click());
      await sleep(400);

      await scrollTo(page, 'left');
      const cells = { ...(await gridCells(page)) };
      await scrollTo(page, 'right');
      Object.assign(cells, await gridCells(page));
      const marked = Object.entries(cells).filter(([, v]) => v.mark).map(([k]) => k).sort();
      const want = [...WANT.keys()].filter((k) => k in cells).sort();
      check(`${ext}: corner mark on exactly Excel's formula cells`, JSON.stringify(marked) === JSON.stringify(want) && want.length >= 40,
        `marked ${marked.length}, want ${want.length}; extra ${marked.filter((k) => !WANT.has(k)).slice(0, 3)} missing ${want.filter((k) => !marked.includes(k)).slice(0, 3)}`);

      // F2: cross-sheet reference with a quoted sheet name.
      const tip = await hoverText(page, 0, 5);
      check(`${ext}: hover shows the formula`, tip.startsWith(`公式：=${WANT.get('0,5')}`), tip);
      if (ext === 'xlsx') await page.screenshot({ path: path.join(OUT, '01_hover_formula.png') });
      await page.mouse.move(5, 5);

      const bar = await clickCell(page, 0, 5);
      check(`${ext}: formula bar shows the clicked cell's formula`, bar === `=${WANT.get('0,5')}`, String(bar));
      // A typed number over the formula column (D5): no formula, the bar shows the value.
      const typed = await clickCell(page, 3, 3);
      check(`${ext}: typed cell in a formula column shows its value, not a formula`, typed === '123.45' && !cells['3,3']?.mark, String(typed));
      // Array formula K2:K4 on every cell of the range.
      const arr = await clickCell(page, 2, 10);
      check(`${ext}: array formula shows on every cell of its range`, arr === '=B2:B4*2', String(arr));
      if (ext === 'xlsx') await page.screenshot({ path: path.join(OUT, '02_formula_bar.png') });
    }

    // Health check: the two typed-over amounts (data rows 3 and 7).
    await page.mouse.move(5, 5);
    await page.evaluate(() => document.querySelector('[data-testid="health-toggle"]')?.click());
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, '03a_after_health_click.png') });
    await page.waitForSelector('[data-testid="health-panel"]', { timeout: 5000 });
    await sleep(300);
    const finding = await page.evaluate(() => {
      const li = [...document.querySelectorAll('[data-testid="health-issue"]')].find((x) => x.getAttribute('data-kind') === 'typedInFormulaColumn');
      return li ? { text: li.textContent, rows: [...li.querySelectorAll('button')].map((b) => Number(b.textContent.replace(/\D/g, '')) - 1) } : null;
    });
    check('health check lists the typed-over cells', JSON.stringify(finding?.rows) === '[3,7]', JSON.stringify(finding));
    await page.screenshot({ path: path.join(OUT, '03_health_typed.png') });
    await page.evaluate(() => document.querySelector('[data-testid="health-toggle"]')?.click());
    await sleep(300);

    // Column filter on currency = USD: every remaining row keeps its own formula.
    const filtered = await page.evaluate(async () => {
      const header = document.querySelector('.ag-header-cell[col-id="c4"] .ag-header-cell-menu-button, .ag-header-cell[col-id="c4"] .ag-header-icon');
      header?.click();
      await new Promise((r) => setTimeout(r, 400));
      const input = document.querySelector('.ag-filter input[type="text"], .ag-filter input:not([type])');
      if (!input) return null;
      input.value = 'USD';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      document.body.click();
      return document.querySelector('[data-testid="filter-status"]')?.textContent ?? '';
    });
    await sleep(500);
    await page.keyboard.press('Escape');
    await scrollTo(page, 'left');
    const after = await gridCells(page);
    // Each shown row's id column (c0, "A-n") tells which source row it is: A-n is data row n-1.
    const rowsShown = [...new Set(Object.keys(after).map((k) => k.split(',')[0]))];
    let wrong = 0;
    let checkedRows = 0;
    for (const r of rowsShown) {
      const id = after[`${r},0`]?.text ?? '';
      const src = Number(id.replace('A-', '')) - 1;
      if (!Number.isInteger(src) || src < 0) continue;
      checkedRows += 1;
      const bar = await clickCell(page, Number(r), 5);
      if (bar !== `=${WANT.get(`${src},5`)}`) wrong += 1;
    }
    check('after filtering, each row keeps its own formula', checkedRows >= 3 && checkedRows < 10 && wrong === 0, `${filtered}; ${checkedRows} rows, ${wrong} wrong`);
    await page.screenshot({ path: path.join(OUT, '04_filtered.png') });

    await setTheme(page, 'dark');
    await sleep(400);
    await clickCell(page, Number(rowsShown[0] ?? 0), 5);
    await page.screenshot({ path: path.join(OUT, '05_dark.png') });
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
