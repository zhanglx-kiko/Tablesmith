#!/usr/bin/env node
// P0 visual walkthrough of the desktop app (BROWSER_ACCEPTANCE_SPEC.md §三).
// Usage: tablesmith-verify [outputDir]   (needs a release build: npx tauri build --no-bundle)
const fs = require('fs');
const path = require('path');
const { launchDesktopApp, importPaths, setTheme, ROOT } = require('./lib/desktop-app.cjs');

const OUTPUT_DIR = path.resolve(process.argv[2] || path.join(ROOT, 'screenshots'));
const SAMPLE = path.join(ROOT, 'tablesmith/sample-data/multi_sheet_demo.xlsx');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, selector, text) {
  const ok = await page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((n) => n.textContent && n.textContent.includes(t));
      if (el) el.click();
      return Boolean(el);
    },
    selector,
    text,
  );
  if (!ok) console.warn(`  (未找到包含“${text}”的 ${selector})`);
}

async function shot(page, name) {
  const file = path.join(OUTPUT_DIR, name);
  await page.screenshot({ path: file });
  console.log(`Saved: ${file}`);
}

(async () => {
  const { page, close } = await launchDesktopApp();
  try {
    console.log('[1/6] Importing multi_sheet_demo.xlsx ...');
    await importPaths(page, [SAMPLE]);
    await page.waitForSelector('.ag-row', { timeout: 15000 });

    console.log('[2/6] Dark mode data source');
    await setTheme(page, 'dark');
    await sleep(500);
    await shot(page, '01_datasource_grid_dark.png');

    console.log('[3/6] Chart view with value labels');
    await page.click('a[href="/chart"]');
    await sleep(800);
    await page.evaluate(() => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent && l.textContent.includes('数值标签'));
      const input = label && label.querySelector('input[type="checkbox"]');
      if (input && !input.checked) input.click();
    });
    await sleep(800);
    await shot(page, '02_chart_view_dark.png');

    console.log('[4/6] Pivot table');
    await page.click('a[href="/process"]');
    await sleep(800);
    await clickByText(page, 'button', '透视表');
    await sleep(500);
    await clickByText(page, 'button', '生成并预览透视表');
    await sleep(800);
    await shot(page, '03_pivot_view_dark.png');

    console.log('[5/6] Report view');
    await page.click('a[href="/report"]');
    await sleep(1000);
    await shot(page, '04_report_view_dark.png');

    console.log('[6/6] Light mode chart');
    await setTheme(page, 'light');
    await page.click('a[href="/chart"]');
    await sleep(1000);
    await shot(page, '05_chart_view_light.png');

    console.log('[Tablesmith Visual QA] done');
  } finally {
    await close();
  }
})().catch((e) => {
  console.error('[Tablesmith Visual QA Error]:', e);
  process.exit(1);
});
