#!/usr/bin/env node
// Cross-file compare on the desktop build. Builds an "old" CSV from the real
// sales_detail.csv with known edits (rows removed, rows added, cells changed), imports
// both, runs 对比差异 with sale_id as the key and requires the counts and the result
// table to match the planted edits exactly.
// Usage: node tools/verify-compare-e2e.cjs   (needs a release build)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launchDesktopApp, importPaths, resetWorkspace, setTheme, ROOT } = require('./lib/desktop-app.cjs');

const NEW = 'D:/tmp/excel/sales_detail.csv';
const OUT = path.join(ROOT, 'screenshots', 'compare_e2e');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tablesmith-compare-'));
const OLD = path.join(WORK, 'sales_detail_上月.csv');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/** Old file: drop 7 rows (-> added), add 3 rows (-> removed), change units in 5 rows. */
function buildOld() {
  const lines = fs.readFileSync(NEW, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const id = header.indexOf('sale_id');
  const units = header.indexOf('units');
  const rows = lines.slice(1).map((l) => l.split(','));
  const dropped = new Set([10, 500, 1234, 3000, 4321, 7000, 8600].map((i) => rows[i][id]));
  const changed = [20, 777, 2500, 6000, 8000].map((i) => rows[i][id]);
  const out = rows
    .filter((r) => !dropped.has(r[id]))
    .map((r) => (changed.includes(r[id]) ? r.map((v, c) => (c === units ? String(Number(v) + 3) : v)) : r));
  for (let i = 0; i < 3; i++) out.push(rows[i].map((v, c) => (c === id ? `SAL-GONE-${i}` : v)));
  fs.writeFileSync(OLD, [header.join(','), ...out.map((r) => r.join(','))].join('\n') + '\n');
  return { added: dropped.size, removed: 3, changed: changed.length, unchanged: rows.length - dropped.size - changed.length, changedIds: changed };
}

async function selectByLabel(page, labelText, optionText) {
  return page.evaluate(
    (l, o) => {
      const label = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(l));
      const sel = label?.querySelector('select') ?? label?.parentElement?.querySelector('select');
      const opt = sel && [...sel.options].find((x) => x.textContent.trim() === o);
      if (!sel || !opt) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    labelText,
    optionText,
  );
}

async function clickText(page, text) {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t && !b.disabled);
    el?.click();
    return Boolean(el);
  }, text);
  await sleep(600);
  return ok;
}

(async () => {
  if (!fs.existsSync(NEW)) throw new Error(`missing ${NEW}`);
  fs.mkdirSync(OUT, { recursive: true });
  const expected = buildOld();
  const { page, close } = await launchDesktopApp();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await resetWorkspace(page);
    await setTheme(page, 'light');
    await importPaths(page, [OLD, NEW]);
    await page.waitForFunction(() => document.querySelectorAll('[aria-label^="关闭数据源"]').length >= 2, { timeout: 60000 });
    await sleep(600);

    await page.click('a[href="/process"]');
    await page.waitForSelector('[data-testid="steps-panel"]', { timeout: 10000 });
    check('current table is the old file', await selectByLabel(page, '数据文件', path.basename(OLD)));
    await sleep(600);
    check('opened the 合并 tab', await clickText(page, '合并'));
    await page.click('[data-testid="merge-mode-compare"]');
    await sleep(300);
    check('target is the new file', await selectByLabel(page, '选择要关联的目标文件', 'sales_detail.csv'));
    await sleep(400);
    const keys = await page.$$eval('[data-testid="compare-options"] input[type=checkbox]:checked', (cs) => cs.map((c) => c.parentElement.textContent.trim()));
    check('sale_id is picked as the key by default', keys.length === 1 && keys[0] === 'sale_id', keys.join(','));

    check('ran the compare', await clickText(page, '生成对比结果'));
    await page.waitForSelector('[data-testid="compare-summary"]', { timeout: 15000 });
    const counts = await page.$$eval('[data-testid="compare-summary"] strong[data-count]', (ss) => Object.fromEntries(ss.map((s) => [s.dataset.count, Number(s.textContent)])));
    for (const k of ['changed', 'added', 'removed', 'unchanged']) check(`${k} count equals the planted edits`, counts[k] === expected[k], `${counts[k]} vs ${expected[k]}`);

    const grid = await page.evaluate(() => {
      const headers = [...document.querySelectorAll('.ag-header-cell-text')].map((h) => h.textContent.trim());
      const rows = [...document.querySelectorAll('.ag-center-cols-container .ag-row')]
        .sort((a, b) => Number(a.getAttribute('row-index')) - Number(b.getAttribute('row-index')))
        .map((r) => [...r.querySelectorAll('.ag-cell')].map((c) => c.textContent.trim()));
      return { headers, rows };
    });
    check('result table starts with 状态 / sale_id / 变化列', grid.headers.slice(0, 3).join('|') === '状态|sale_id|变化列', grid.headers.slice(0, 4).join('|'));
    const modified = grid.rows.filter((r) => r[0] === '修改');
    check('modified rows are the planted ones, change in units', modified.length === expected.changed && modified.every((r) => expected.changedIds.includes(r[1]) && r[2] === 'units'), modified.map((r) => `${r[1]}:${r[2]}`).join(' '));
    await page.screenshot({ path: path.join(OUT, '01_compare_light.png') });

    const stepLabels = await page.$$eval('[data-testid="steps-list"] li', (lis) => lis.map((li) => li.textContent.trim()));
    check('compare step names the other file', stepLabels.some((l) => l.includes('对比「sales_detail.csv」')), stepLabels.join(' | '));

    await setTheme(page, 'dark');
    await page.screenshot({ path: path.join(OUT, '02_compare_dark.png') });
    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await close();
    fs.rmSync(WORK, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed; screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
