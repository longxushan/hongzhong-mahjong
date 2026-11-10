// 2026-11-11 实测：定庄后在结果面板停留 1.5 秒再进牌局（2026-11-10 为 1 秒，用户要求加长）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');

function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  return candidates.find(p => fs.existsSync(p));
}

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: findBrowser() });
const page = await browser.newPage();

await page.addInitScript(() => {
  HTMLMediaElement.prototype.play = function () {
    const self = this;
    setTimeout(() => { if (typeof self.onended === 'function') self.onended(); }, 30);
    return Promise.resolve();
  };
});

await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
await page.locator('.roleBtn').first().click();

const result = await page.evaluate(async () => {
  const t = setInterval(() => { window.__snap = { dice: !!window._diceResult, show: document.getElementById('diceOverlay')?.classList.contains('show') }; }, 30);
  let tSet = null, tClosed = null, over = false;
  const t0 = Date.now();
  await new Promise(r => {
    const iv = setInterval(() => {
      const s = window.__snap || {};
      if (s.dice && tSet === null) tSet = Date.now();
      if (tSet !== null && !s.show && tClosed === null) tClosed = Date.now();
      if (G && G.players && G.players[0] && G.players[0].hand.length > 0) { over = true; }
      if (over || Date.now() - t0 > 40000) { clearInterval(iv); r(); }
    }, 30);
  });
  clearInterval(t);
  const hold = tSet !== null && tClosed !== null ? (tClosed - tSet) / 1000 : -1;
  return { hold, dealt: over, dice: window._diceResult ? { dealer: window._diceResult.dealer } : null };
});

console.log(`定庄(_diceResult 置位) → 面板收起: ${result.hold.toFixed(2)}s`);
console.log(`发牌进入牌局: ${result.dealt}，庄家=座位${result.dice?.dealer}`);
const pass = result.hold >= 1.4 && result.hold <= 1.75 && result.dealt;
console.log(pass ? 'PASS: 定庄后停留约 1.5 秒再进局' : 'FAIL: 需检查');

await browser.close();
process.exit(pass ? 0 : 1);
