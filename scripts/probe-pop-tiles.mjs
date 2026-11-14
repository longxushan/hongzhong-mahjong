// 临时探针：托管快打至结算弹窗出现，量弹窗内牌面尺寸 + 截图
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const EXE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1; window.__noSplitBar = 1;
  HTMLMediaElement.prototype.play = function () { const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20); return Promise.resolve(); };
});
await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
// 开托管快打，等结算弹窗出现
await page.evaluate(() => { document.getElementById('autoBtn').click(); });
await page.waitForSelector('.revealHands', { timeout: 240000 });
await page.waitForTimeout(300);
const geo = await page.evaluate(() => {
  const q = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), css: cs.width + ' x ' + cs.height }; };
  const popW = getComputedStyle(document.documentElement).getPropertyValue('--popW');
  return {
    popW: popW.trim(),
    revealTile: q('.revealRow .tp-sm'),
    revealImg: q('.revealRow .tp-sm img'),
    winnerTile: q('.wtHand .tp-sm'),
    revealRows: document.querySelectorAll('.revealRow').length,
    revealTiles: document.querySelectorAll('.revealRow .tp-sm').length,
    modalScrollable: (() => { const m = document.querySelector('.modal'); return m ? (m.scrollHeight > m.clientHeight) : null; })(),
    inner: innerWidth + 'x' + innerHeight,
  };
});
console.log(JSON.stringify(geo, null, 2));
await page.screenshot({ path: 'e:/tmp-settle.png' });
console.log('screenshot saved e:/tmp-settle.png');
await browser.close();
