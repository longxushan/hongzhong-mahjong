// 2026-11-15 摊牌新模式视觉探针：三家暗牌摊在头像底下——手机竖屏 + 手机横屏各截一张牌桌图
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

async function shot(w, h, out) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
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
  await page.waitForFunction(() => G && G.revealLog && G.revealLog.length >= 8, null, { timeout: 90000 }).catch(() => {});
  await page.evaluate(() => {
    // 关掉可能弹出的结算弹窗，停在牌局中途
    const btn = document.getElementById('mNext');
    if (btn && btn.offsetParent !== null) btn.click();
  });
  await page.waitForTimeout(400);
  const geo = await page.evaluate(() => {
    const r = {};
    for (const i of [1, 2, 3]) {
      const rv = document.querySelector('#seat' + i + ' .rvHand');
      const seat = document.getElementById('seat' + i);
      if (rv && seat) {
        const rr = rv.getBoundingClientRect(), sr = seat.getBoundingClientRect();
        r['seat' + i] = { tiles: rv.querySelectorAll('.tp-sm').length, rows: Math.round(rr.height / (rv.querySelector('.tp-sm') ? rv.querySelector('.tp-sm').getBoundingClientRect().height : 1)), w: Math.round(rr.width), clipped: rr.bottom > sr.bottom + 1 || rr.right > sr.right + 1 };
      } else r['seat' + i] = null;
    }
    return r;
  });
  console.log(out, JSON.stringify(geo));
  await page.screenshot({ path: out });
  await page.close();
}

await shot(390, 844, 'E:/9-workbuddy/16-github/hzmj/reveal-av-port.png');
await shot(844, 390, 'E:/9-workbuddy/16-github/hzmj/reveal-av-land.png');
await browser.close();
console.log('done');
