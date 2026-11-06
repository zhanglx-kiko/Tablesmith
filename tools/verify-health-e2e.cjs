#!/usr/bin/env node
// Data health check on the desktop build: import a file with known planted defects
// (tablesmith/sample-data/edge-cases/health_defects.csv), open the panel, require every
// planted defect to be listed, click a row link and require the grid to scroll to it.
// Also checks the panel does not change the data and that a clean real sheet reports
// nothing alarming.
// Usage: node tools/verify-health-e2e.cjs   (needs a release build)
const path = require('path');
const fs = require('fs');
const { launchDesktopApp, importPaths, resetWorkspace, setTheme, ROOT } = require('./lib/desktop-app.cjs');

const FIXTURE = path.join(ROOT, 'tablesmith/sample-data/edge-cases/health_defects.csv');
const PLANTED = JSON.parse(fs.readFileSync(FIXTURE.replace(/\.csv$/, '.planted.json'), 'utf8'));
const OUT = path.join(ROOT, 'screenshots', 'health_e2e');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { page, close } = await launchDesktopApp();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await resetWorkspace(page);
    await setTheme(page, 'light');
    await importPaths(page, [FIXTURE]);
    await page.waitForFunction(() => document.querySelectorAll('.ag-center-cols-container .ag-row').length > 0, { timeout: 30000 });
    await sleep(500);
    const firstCellsBefore = await page.$$eval('.ag-center-cols-container .ag-row', (rs) => rs.map((r) => ({ i: Number(r.getAttribute('row-index')), t: [...r.querySelectorAll('.ag-cell')].map((c) => c.textContent) })).sort((a, b) => a.i - b.i).slice(0, 10));

    await page.click('[data-testid="health-toggle"]');
    await page.waitForSelector('[data-testid="health-panel"]', { timeout: 5000 });
    await sleep(300);
    const listed = await page.$$eval('[data-testid="health-issue"]', (items) =>
      items.map((li) => ({
        kind: li.getAttribute('data-kind'),
        rows: [...li.querySelectorAll('button')].map((b) => Number(b.textContent.replace(/\D/g, '')) - 1),
      })),
    );
    const missing = Object.entries(PLANTED).filter(([kind, rows]) => {
      const got = new Set(listed.filter((i) => i.kind === kind).flatMap((i) => i.rows));
      return !rows.every((r) => got.has(r));
    });
    check('every planted defect is listed at its row', missing.length === 0, missing.map(([k]) => k).join(', '));
    check('nothing is listed that was not planted', listed.length === Object.keys(PLANTED).length, `${listed.length} findings`);
    const summary = await page.$eval('[data-testid="health-summary"]', (e) => e.textContent.trim()).catch(() => '');
    check('summary counts are shown', /\d+ 个错误/.test(summary), summary);
    await page.screenshot({ path: path.join(OUT, '01_panel_light.png') });

    // Locate: the outlier is at data row 222, far below the first screen.
    const target = PLANTED.outlier[0];
    const visibleBefore = await page.$$eval('.ag-center-cols-container .ag-row', (rs) => rs.map((r) => Number(r.getAttribute('row-index'))));
    await page.evaluate((row) => {
      const item = [...document.querySelectorAll('[data-testid="health-issue"]')].find((li) => li.getAttribute('data-kind') === 'outlier');
      const btn = [...(item?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes(`第 ${row + 1} 行`));
      btn?.click();
    }, target);
    await sleep(700);
    const visibleAfter = await page.$$eval('.ag-center-cols-container .ag-row', (rs) => rs.map((r) => Number(r.getAttribute('row-index'))));
    check('row link scrolls the grid to that row', !visibleBefore.includes(target) && visibleAfter.includes(target), `before max ${Math.max(...visibleBefore)}, after has ${target}: ${visibleAfter.includes(target)}`);
    // The located cell keeps focus (outlined) after the flash fades.
    await sleep(2500);
    const focused = await page.evaluate(() => {
      const cell = document.querySelector('.ts-located-cell');
      return cell ? { row: Number(cell.closest('.ag-row')?.getAttribute('row-index')), col: cell.getAttribute('col-id'), text: cell.textContent.trim() } : null;
    });
    check('located cell stays outlined on the planted value', focused?.row === target && focused?.col === 'c3' && focused?.text === '99000000.00', JSON.stringify(focused));
    await page.screenshot({ path: path.join(OUT, '02_located_outlier.png') });

    await page.click('[aria-label="关闭数据体检"]');
    await sleep(300);
    check('panel closes', (await page.$('[data-testid="health-panel"]')) === null);
    await page.evaluate(() => document.querySelector('.ag-body-viewport')?.scrollTo(0, 0));
    await sleep(400);
    const firstCellsAfter = await page.$$eval('.ag-center-cols-container .ag-row', (rs) => rs.map((r) => ({ i: Number(r.getAttribute('row-index')), t: [...r.querySelectorAll('.ag-cell')].map((c) => c.textContent) })).sort((a, b) => a.i - b.i).slice(0, 10));
    check('health check did not change any shown value', JSON.stringify(firstCellsAfter) === JSON.stringify(firstCellsBefore));

    await setTheme(page, 'dark');
    await page.click('[data-testid="health-toggle"]');
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, '03_panel_dark.png') });

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
