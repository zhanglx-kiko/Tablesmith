// Launch the real Tablesmith desktop build and attach Puppeteer to its WebView2 through
// the Chrome DevTools Protocol. UI checks run against the shipped app, not a browser copy.
//
// The app is started with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port and
// WEBVIEW2_USER_DATA_FOLDER pointing at a fresh temp directory, so checks never touch the
// user's own workspace, history or theme. Both variables only affect the spawned process.
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const http = require('http');
const path = require('path');

let puppeteer;
try {
  puppeteer = require(path.resolve(process.env.APPDATA || 'C:/Users/16147/AppData/Roaming', 'npm/node_modules/puppeteer'));
} catch {
  puppeteer = require(path.resolve(__dirname, '../../tablesmith/node_modules/puppeteer'));
}

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_EXE = path.join(ROOT, 'tablesmith/src-tauri/target/release/tablesmith.exe');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function waitForDevtools(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const version = await getJson(`http://127.0.0.1:${port}/json/version`);
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`WebView2 DevTools 端口 ${port} 未在 ${timeoutMs} ms 内就绪`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Start tablesmith.exe and return `{ browser, page, close }`. `close()` disconnects and
 * kills only the process started here.
 */
async function launchDesktopApp({ exe = process.env.TABLESMITH_EXE || DEFAULT_EXE, port = 9333 } = {}) {
  if (!fs.existsSync(exe)) {
    throw new Error(`找不到 ${exe}，请先在 tablesmith 目录运行 npx tauri build --no-bundle`);
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tablesmith-qa-'));
  const child = spawn(exe, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: profile,
    },
    stdio: 'ignore',
  });
  console.log(`[desktop] started ${path.basename(exe)} pid=${child.pid}`);
  const close = async (browser) => {
    try {
      await browser?.disconnect();
    } catch {
      // ignore
    }
    if (child.exitCode === null) child.kill();
    await new Promise((r) => setTimeout(r, 800));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    console.log(`[desktop] stopped pid=${child.pid}`);
  };

  let browser;
  try {
    const ws = await waitForDevtools(port, 20000);
    browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
    let page;
    for (let i = 0; i < 40 && !page; i += 1) {
      page = (await browser.pages()).find((p) => p.url().startsWith('http://tauri.localhost'));
      if (!page) await new Promise((r) => setTimeout(r, 250));
    }
    if (!page) throw new Error('没有找到 Tablesmith 主窗口页面');
    await page.waitForSelector('aside', { timeout: 15000 });
    return { browser, page, close: () => close(browser) };
  } catch (err) {
    await close(browser);
    throw err;
  }
}

/**
 * Import files through the real Rust + worker pipeline, as a native drop would.
 * Right after launch the app may not have subscribed to drag-drop yet and the drop would
 * be lost, so first wait for the subscription: a probe "over" event must mark the drop target
 * (data-dragging). The probe is followed by "leave" so it leaves nothing behind.
 */
async function importPaths(page, paths) {
  for (let i = 0; i < 40; i += 1) {
    const ready = await page.evaluate(async () => {
      const { emit } = window.__TAURI__.event;
      await emit('tauri://drag-over', { position: { x: 400, y: 300 } });
      await new Promise((r) => setTimeout(r, 100));
      const shown = Boolean(document.querySelector('[data-dragging]'));
      await emit('tauri://drag-leave', {});
      return shown;
    });
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await page.evaluate(async (list) => {
    const { emit } = window.__TAURI__.event;
    await emit('tauri://drag-drop', { paths: list, position: { x: 400, y: 300 } });
  }, paths);
}

/** Close every open data source and dismiss toasts (inside the throwaway QA profile). */
async function resetWorkspace(page) {
  let closed = 0;
  for (;;) {
    const btn = await page.$('button[aria-label^="关闭数据源"]');
    if (!btn) break;
    await btn.click();
    closed += 1;
    await new Promise((r) => setTimeout(r, 150));
  }
  for (const b of await page.$$('button[aria-label="关闭提示"]')) await b.click().catch(() => {});
  return closed;
}

async function setTheme(page, mode) {
  const title = { light: '浅色模式', dark: '深色模式', system: '跟随系统' }[mode];
  await page.click(`button[title="${title}"]`);
  await new Promise((r) => setTimeout(r, 400));
}

module.exports = { launchDesktopApp, importPaths, resetWorkspace, setTheme, ROOT };
