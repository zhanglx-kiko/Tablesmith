const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));

const TARGET_PORT = 1420;
const TARGET_URL = `http://localhost:${TARGET_PORT}/`;
const OUTPUT_DIR = path.resolve(__dirname, '../screenshots/audit_verification');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const SAMPLE_FILE = {
  fileName: 'enterprise_q4_sales.xlsx',
  fileType: 'xlsx',
  sheets: [
    {
      name: '销售业绩汇总',
      headers: ['季度', '销售经理', '联系电话', '身份证号', '邮箱', '产品线A', '产品线B', '产品线C'],
      rows: [
        ['2025-Q1', '张三', '13812345678', '110101199003072345', 'zhangsan@corp.com', '$4,200', '3,100', '2,400'],
        ['2025-Q2', '李小龙', '13987654321', '310101198501011234', 'lixiaolong@corp.com', '$5,100', '3,400', '2,900'],
        ['2025-Q3', '诸葛孔明', '18600001111', '440101200001015678', 'zhuge@corp.com', '$6,300', '3,900', '3,600'],
        ['2025-Q4', '赵云', '13700002222', '510101199205053333', 'zhaoyun@corp.com', '$7,800', '4,500', '4,200'],
        ['2025-Q4', '赵云', '13700002222', '510101199205053333', 'zhaoyun@corp.com', '$7,800', '4,500', '4,200'], // duplicate
        ['  ', '', '', '', '', '', '', ''] // empty
      ]
    },
    {
      name: '部门预算',
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

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function navigateTo(page, targetPath) {
  await page.evaluate((path) => {
    const links = Array.from(document.querySelectorAll('aside a, nav a'));
    const link = links.find((a) => a.getAttribute('href') === path || a.pathname === path);
    if (link) {
      link.click();
    }
  }, targetPath);
  await sleep(700);
}

async function startPreviewServer() {
  console.log('[Server] Starting vite preview server on port ' + TARGET_PORT + '...');
  const appDir = path.resolve(__dirname, '../tablesmith');
  const server = spawn('cmd.exe', ['/c', 'npm', 'run', 'preview', '--', '--port', String(TARGET_PORT), '--strictPort'], {
    cwd: appDir,
    stdio: 'pipe'
  });

  server.stdout.on('data', (d) => {
    // console.log(`[Vite stdout] ${d}`);
  });
  server.stderr.on('data', (d) => {
    // console.error(`[Vite stderr] ${d}`);
  });

  // Poll until HTTP 200
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const http = require('http');
      const ok = await new Promise((res) => {
        const req = http.get(TARGET_URL, (r) => res(r.statusCode === 200));
        req.on('error', () => res(false));
      });
      if (ok) {
        console.log('[Server] Preview server is up and responsive!');
        return server;
      }
    } catch {
      // retry
    }
  }
  throw new Error('Preview server timed out starting');
}

async function runAudit() {
  let serverProc = null;
  let browser = null;

  try {
    serverProc = await startPreviewServer();

    console.log('[Puppeteer] Launching headless browser...');
    browser = await puppeteer.launch({
      channel: 'chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: { width: 1440, height: 920 }
    });

    const page = await browser.newPage();
    console.log('[Test 1] Loading app at ' + TARGET_URL);
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });

    // Inject data and enable dark theme
    await page.evaluate((data) => {
      if (window.__DATA_STORE__) {
        window.__DATA_STORE__.getState().addFile(data);
        window.__DATA_STORE__.getState().setTheme('dark');
      }
      document.documentElement.classList.add('dark');
    }, SAMPLE_FILE);
    await sleep(1000);

    // Screen 1: Data Source View
    await page.screenshot({ path: path.join(OUTPUT_DIR, '01_datasource_grid.png') });
    console.log('✓ 01_datasource_grid.png captured');

    // Screen 2: Navigate to ProcessView
    console.log('[Test 2] Navigating to Data Process View (/process)...');
    await navigateTo(page, '/process');
    await sleep(600);

    // 2.1 Deduplication
    console.log('[Test 2.1] Executing Remove Duplicates...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find((b) => b.textContent && b.textContent.includes('删除重复行'));
      if (btn) btn.click();
    });
    await sleep(400);

    // 2.2 Remove Empty Rows
    console.log('[Test 2.2] Executing Remove Empty Rows...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find((b) => b.textContent && b.textContent.includes('清除空数据行'));
      if (btn) btn.click();
    });
    await sleep(400);

    await page.screenshot({ path: path.join(OUTPUT_DIR, '02_process_cleaned.png') });
    console.log('✓ 02_process_cleaned.png captured');

    // Screen 3: Test Filter Tab with Currency ($4,200 vs $5,100+)
    console.log('[Test 3] Testing Filter with Currency ($5,000 threshold)...');
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button'));
      const filterTab = tabs.find((b) => b.textContent && b.textContent.includes('条件筛选'));
      if (filterTab) filterTab.click();
    });
    await sleep(400);

    // Add filter rule: 产品线A > 5000
    await page.evaluate(() => {
      const addBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('添加筛选规则'));
      if (addBtn) addBtn.click();
    });
    await sleep(300);

    await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      // Set column to 产品线A
      if (selects.length >= 1) {
        selects[0].value = '产品线A';
        selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      }
      // Set operator to greaterThan
      if (selects.length >= 2) {
        selects[1].value = 'greaterThan';
        selects[1].dispatchEvent(new Event('change', { bubbles: true }));
      }
      // Set filter value input to 5000
      const inputs = document.querySelectorAll('input[type="text"]');
      if (inputs.length > 0) {
        const lastInput = inputs[inputs.length - 1];
        lastInput.value = '5000';
        lastInput.dispatchEvent(new Event('input', { bubbles: true }));
        lastInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await sleep(300);

    // Click "执行筛选"
    await page.evaluate(() => {
      const applyBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('执行筛选'));
      if (applyBtn) applyBtn.click();
    });
    await sleep(500);

    await page.screenshot({ path: path.join(OUTPUT_DIR, '03_filter_currency_applied.png') });
    console.log('✓ 03_filter_currency_applied.png captured');

    // Reset before next test
    await page.evaluate(() => {
      const resetBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('重置'));
      if (resetBtn) resetBtn.click();
    });
    await sleep(400);

    // Screen 4: Test Computed Columns
    console.log('[Test 4] Testing Computed Column (calc)...');
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button'));
      const computeTab = tabs.find((b) => b.textContent && b.textContent.includes('计算与派生'));
      if (computeTab) computeTab.click();
    });
    await sleep(400);

    await page.evaluate(() => {
      const nameInput = document.querySelector('input[placeholder="例如：总额、全名"]');
      if (nameInput) {
        nameInput.value = '产品BC合计';
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const selects = document.querySelectorAll('select');
      // Column A -> 产品线B, Column B -> 产品线C
      for (const s of selects) {
        if (s.innerHTML.includes('产品线B')) {
          s.value = '产品线B';
          s.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    });
    await sleep(300);

    // Click "添加计算列"
    await page.evaluate(() => {
      const addColBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('添加计算列'));
      if (addColBtn) addColBtn.click();
    });
    await sleep(500);

    await page.screenshot({ path: path.join(OUTPUT_DIR, '04_computed_column_applied.png') });
    console.log('✓ 04_computed_column_applied.png captured');

    // Screen 5: Test Data Masking
    console.log('[Test 5] Testing Data Masking on Phone...');
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button'));
      const maskTab = tabs.find((b) => b.textContent && b.textContent.includes('数据脱敏'));
      if (maskTab) maskTab.click();
    });
    await sleep(400);

    await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      for (const s of selects) {
        if (s.innerHTML.includes('联系电话')) {
          s.value = '联系电话';
          s.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    });
    await sleep(300);

    // Click "执行脱敏"
    await page.evaluate(() => {
      const maskBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('执行脱敏'));
      if (maskBtn) maskBtn.click();
    });
    await sleep(500);

    await page.screenshot({ path: path.join(OUTPUT_DIR, '05_masked_data_applied.png') });
    console.log('✓ 05_masked_data_applied.png captured');

    // Screen 6: Test Pivot Matrix Generation
    console.log('[Test 6] Testing Pivot Table Generation...');
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button'));
      const pivotTab = tabs.find((b) => b.textContent && b.textContent.includes('数据透视'));
      if (pivotTab) pivotTab.click();
    });
    await sleep(400);

    // Click "生成数据透视表"
    await page.evaluate(() => {
      const genBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('生成数据透视表'));
      if (genBtn) genBtn.click();
    });
    await sleep(600);

    await page.screenshot({ path: path.join(OUTPUT_DIR, '06_pivot_matrix_generated.png') });
    console.log('✓ 06_pivot_matrix_generated.png captured');

    // Screen 7: Test Safe Overwrite Confirmation Modal
    console.log('[Test 7] Testing Safe Overwrite Confirmation Dialog...');
    await page.evaluate(() => {
      const overwriteBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('覆盖当前表'));
      if (overwriteBtn) overwriteBtn.click();
    });
    await sleep(400);

    await page.screenshot({ path: path.join(OUTPUT_DIR, '07_confirm_overwrite_modal.png') });
    console.log('✓ 07_confirm_overwrite_modal.png captured');

    // Click Cancel on Overwrite Modal
    await page.evaluate(() => {
      const cancelBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.trim() === '取消');
      if (cancelBtn) cancelBtn.click();
    });
    await sleep(400);

    // Screen 8: Chart View
    console.log('[Test 8] Navigating to Chart View (/chart)...');
    await navigateTo(page, '/chart');
    await sleep(800);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '08_chart_view_rendered.png') });
    console.log('✓ 08_chart_view_rendered.png captured');

    // Screen 9: Report View
    console.log('[Test 9] Navigating to Report View (/report)...');
    await navigateTo(page, '/report');
    await sleep(800);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '09_report_view_kpi.png') });
    console.log('✓ 09_report_view_kpi.png captured');

    // Screen 10: Export Modal
    console.log('[Test 10] Testing Export Modal in Report View...');
    await page.evaluate(() => {
      const exportBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('导出 PDF 报告'));
      if (exportBtn) exportBtn.click();
    });
    await sleep(500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '10_export_modal_clean.png') });
    console.log('✓ 10_export_modal_clean.png captured');

    console.log('\n=============================================');
    console.log('>>> ALL 10 E2E WALKTHROUGH SCREENSHOTS CAPTURED! <<<');
    console.log('=============================================');

  } finally {
    if (browser) await browser.close();
    if (serverProc) {
      console.log('[Server] Shutting down preview server...');
      serverProc.kill();
    }
  }
}

runAudit().catch((err) => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
