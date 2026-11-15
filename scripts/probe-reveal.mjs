// 摊牌面板视觉探针：开启后托管跑几巡，截图对手分析栏
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(() => {
  window.__noCloudExp = 1; window.__noSplitBar = 1;
  HTMLMediaElement.prototype.play = function () { const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20); return Promise.resolve(); };
});
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
await page.evaluate(() => { if (!teachOn) toggleTeach(); });
await page.click('#revealBtn');
await page.click('#autoBtn');
await page.waitForFunction(() => G && G.revealLog && G.revealLog.length >= 10, null, { timeout: 90000 }).catch(() => {});
await page.evaluate(() => {
  const box = document.querySelector('.revealBox');
  if (box) box.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(500);
const info = await page.evaluate(() => {
  const box = document.querySelector('.revealBox');
  const lines = [...document.querySelectorAll('.rvLine')].map(x => x.textContent);
  return { has: !!box, logN: lines.length, sample: lines.slice(0, 6), rows: box ? box.querySelectorAll('.rvRow').length : 0 };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: 'E:/tmp-reveal.png' });
await browser.close();
