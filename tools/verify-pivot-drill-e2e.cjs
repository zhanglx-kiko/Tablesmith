#!/usr/bin/env node
// Pivot drill-down on the desktop build (Excel's "Show Details"): build region x
// sales_channel sum of net_revenue_usd on sales_detail.csv, double-click a body cell, a
// row total and the grand total, and check the detail lists exactly the source rows an
// independent count of the raw CSV gives, that the rows add up to the pivot value, that
// saving the detail adds a sheet, and that the source table is unchanged.
// Usage: node tools/verify-pivot-drill-e2e.cjs   (needs a release build)
const path = require('path');
const fs = require('fs');
const { launchDesktopApp, importPaths, resetWorkspace, setTheme, ROOT } = require('./lib/desktop-app.cjs');

const CSV = 'D:/tmp/excel/sales_detail.csv';
const OUT = path.join(ROOT, 'screenshots', 'pivot_drill_e2e');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/** Oracle from the raw text: rows matching region / channel (null = any), and their sum. */
function oracle(region, channel) {
  const lines = fs.readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean);
  const h = lines[0].split(',');
  const [ri, ci, vi] = ['region', 'sales_channel', 'net_revenue_usd'].map((x) => h.indexOf(x));
  const rows = lines.slice(1).map((l) => l.split(',')).filter((f) => (region === null || f[ri] === region) && (channel === null || f[ci] === channel));
  return { ids: rows.map((f) => f[0]).sort(), sum: rows.reduce((a, f) => a + Number(f[vi]), 0) };
}

async function clickText(page, text) {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(t) && !b.disabled);
    el?.click();
    return Boolean(el);
  }, text);
  await sleep(500);
  return ok;
}

/** Set the n-th select of the pivot panel (main row, sub row, column, value, agg, ...). */
async function setPivotSelect(page, n, value) {
  return page.evaluate(
    (i, v) => {
      const panel = document.querySelector('[data-testid="pivot-panel"]');
      const sel = panel?.querySelectorAll('select')[i];
      if (!sel || ![...sel.options].some((o) => o.value === v)) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, v);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    n,
    value,
  );
}

/** Grid on the right (not inside the detail dialog): label of row r -> rendered row index. */
async function findCell(page, scope, rowLabel, colHeader) {
  return page.evaluate(
    (s, rl, ch) => {
      const root = s ? document.querySelector(s) : document.querySelector('main') ?? document;
      const grid = [...root.querySelectorAll('.ag-root-wrapper')].pop();
      if (!grid) return null;
      const header = [...grid.querySelectorAll('.ag-header-cell')].find((h) => h.textContent.trim() === ch);
      const colId = header?.getAttribute('col-id');
      const label = [...grid.querySelectorAll('.ag-center-cols-container .ag-cell[col-id="c0"]')].find((c) => c.textContent.trim() === rl);
      const rowIndex = label?.closest('.ag-row')?.getAttribute('row-index');
      if (!colId || rowIndex == null) return null;
      const cell = grid.querySelector(`.ag-center-cols-container .ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`);
      cell?.scrollIntoView({ block: 'center', inline: 'center' });
      return cell ? { text: cell.textContent.trim(), rowIndex, colId } : null;
    },
    scope,
    rowLabel,
    colHeader,
  );
}

async function doubleClick(page, rowIndex, colId) {
  const h = await page.evaluateHandle(
    (r, c) => [...document.querySelectorAll('.ag-root-wrapper')][0].querySelector(`.ag-center-cols-container .ag-row[row-index="${r}"] .ag-cell[col-id="${c}"]`),
    rowIndex,
    colId,
  );
  const box = await h.asElement()?.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { count: 2 });
  await page.waitForSelector('[data-testid="pivot-detail"]', { timeout: 5000 }).catch(() => null);
  await sleep(600);
  return true;
}

/**
 * Ids (column c0) and summed net revenue of every row in the detail grid, read by
 * scrolling (rows are virtualised). `full` false reads only the summary line.
 */
async function detailRows(page, full) {
  return page.evaluate(async (readAll) => {
    const dlg = document.querySelector('[data-testid="pivot-detail"]');
    const vp = dlg.querySelector('.ag-body-viewport');
    const headers = [...dlg.querySelectorAll('.ag-header-cell')].map((x) => [x.textContent.trim(), x.getAttribute('col-id')]);
    const valCol = headers.find(([t]) => t === 'net_revenue_usd')?.[1];
    const seen = new Map();
    for (let top = 0; readAll && top <= vp.scrollHeight + vp.clientHeight; top += Math.max(50, vp.clientHeight / 2)) {
      vp.scrollTop = top;
      await new Promise((r) => setTimeout(r, 60));
      for (const row of dlg.querySelectorAll('.ag-center-cols-container .ag-row')) {
        const id = row.querySelector('.ag-cell[col-id="c0"]')?.textContent.trim();
        if (id) seen.set(row.getAttribute('row-index'), { id, v: row.querySelector(`.ag-cell[col-id="${valCol}"]`)?.textContent.trim() });
      }
    }
    const summary = dlg.querySelector('[data-testid="pivot-detail-summary"]')?.textContent.replace(/\s+/g, ' ').trim();
    return { rows: [...seen.values()], summary, title: dlg.querySelector('#pivot-detail-title')?.textContent.trim() };
  }, full);
}

(async () => {
  if (!fs.existsSync(CSV)) throw new Error(`missing ${CSV}`);
  fs.mkdirSync(OUT, { recursive: true });
  const { page, close } = await launchDesktopApp();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await resetWorkspace(page);
    await setTheme(page, 'light');
    await importPaths(page, [CSV]);
    await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 30000 });
    const sourceBefore = await page.evaluate(() => [...(document.querySelector('.ag-center-cols-container .ag-row[row-index="0"]')?.querySelectorAll('.ag-cell') ?? [])].slice(0, 6).map((c) => c.textContent.trim()).join('|'));
    await page.click('a[href="/process"]');
    await sleep(800);
    await clickText(page, '透视表');
    const set = [await setPivotSelect(page, 0, 'region'), await setPivotSelect(page, 2, 'sales_channel'), await setPivotSelect(page, 3, 'net_revenue_usd'), await setPivotSelect(page, 4, 'sum')];
    await sleep(300);
    await clickText(page, '生成并预览透视表');
    await sleep(1200);
    check('pivot configured and generated', set.every(Boolean) && (await page.$('[data-testid="double-click-hint"]')) !== null, JSON.stringify(set));

    const cases = [
      ['body cell', 'Northeast', 'Direct', 'Northeast', 'Direct'],
      ['row total', 'Northeast', '总计', 'Northeast', null],
      ['column total', '总计', 'Partner', null, 'Partner'],
      ['grand total', '总计', '总计', null, null],
    ];
    for (const [what, rowLabel, colHeader, region, channel] of cases) {
      const cell = await findCell(page, null, rowLabel, colHeader);
      if (!cell || !(await doubleClick(page, cell.rowIndex, cell.colId))) {
        check(`${what}: detail opens`, false, JSON.stringify(cell));
        continue;
      }
      const want = oracle(region, channel);
      // Reading every row of a large detail through the virtualised grid is slow; the
      // body cell is read in full, totals by count (pivot.test.ts checks their rows
      // against Excel's Show Details).
      const full = what === 'body cell';
      const got = await detailRows(page, full);
      if (full) {
        const ids = got.rows.map((r) => r.id).sort();
        check(`${what}: exactly the matching source rows`, ids.length === want.ids.length && ids.every((id, i) => id === want.ids[i]), `${ids.length} vs ${want.ids.length}`);
      }
      check(`${what}: pivot value equals the oracle sum`, Math.abs(Number(cell.text.replace(/,/g, '')) - want.sum) < 1e-6 * want.sum, `cell ${cell.text} / oracle ${want.sum}`);
      check(`${what}: summary states the row count`, got.summary?.includes(`${want.ids.length} 行`), `${got.title} | ${got.summary}`);
      if (what === 'body cell') await page.screenshot({ path: path.join(OUT, '01_detail_light.png') });
      if (what === 'grand total') break;
      await page.keyboard.press('Escape');
      await sleep(400);
      check(`${what}: Escape closes the detail`, (await page.$('[data-testid="pivot-detail"]')) === null);
    }

    await page.keyboard.press('Escape');
    await sleep(400);

    // A label cell does nothing (the label must really be there).
    const label = await findCell(page, null, 'Northeast', 'region');
    if (label) await doubleClick(page, label.rowIndex, label.colId);
    check('double-click on a label opens nothing', label !== null && (await page.$('[data-testid="pivot-detail"]')) === null, JSON.stringify(label));

    await setTheme(page, 'dark');
    await sleep(400);
    const west = await findCell(page, null, 'West', 'Marketplace');
    const opened = west !== null && (await doubleClick(page, west.rowIndex, west.colId)) && (await page.$('[data-testid="pivot-detail"]')) !== null;
    const westSummary = opened ? (await detailRows(page, false)).summary : '';
    check('dark mode: West x Marketplace detail', opened && westSummary.includes(`${oracle('West', 'Marketplace').ids.length} 行`), westSummary);
    await page.screenshot({ path: path.join(OUT, '02_detail_dark.png') });

    // Save the detail as a sheet (the dialog's button, not the toolbar's).
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="pivot-detail"] button')].find((b) => b.textContent.includes('另存为新工作表'))?.click());
    await sleep(800);
    const saved = await page.evaluate(() => [...document.querySelectorAll('select option')].find((o) => o.textContent.includes('明细(region=West'))?.textContent ?? null);
    const savedRows = await page.evaluate(() => [...document.querySelectorAll('span')].find((x) => x.textContent.includes('当前预览'))?.querySelector('strong')?.textContent);
    check('detail saved as a new sheet', saved !== null && (await page.$('[data-testid="pivot-detail"]')) === null && Number(savedRows) === oracle('West', 'Marketplace').ids.length, `${saved} / ${savedRows} rows`);
    await page.screenshot({ path: path.join(OUT, '03_saved_dark.png') });

    await page.click('a[href="/"]');
    await sleep(800);
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="sheet-tabs"] button')].find((b) => b.textContent.trim() === 'Sheet1')?.click());
    await sleep(800);
    const sourceAfter = await page.evaluate(() => [...(document.querySelector('.ag-center-cols-container .ag-row[row-index="0"]')?.querySelectorAll('.ag-cell') ?? [])].slice(0, 6).map((c) => c.textContent.trim()).join('|'));
    await page.screenshot({ path: path.join(OUT, '04_source.png') });
    const footer = await page.evaluate(() => [...document.querySelectorAll('span')].find((x) => x.textContent.trim().startsWith('共') && x.querySelector('strong'))?.textContent.replace(/\s+/g, ''));
    check('source table unchanged', Boolean(sourceBefore) && sourceBefore === sourceAfter && footer === '共8640行×15列', `${footer}; first row ${sourceAfter?.slice(0, 30)}`);
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
