// 临时探针：复现用户手机竖屏截图，量出各区块几何，定位「黑色空当」位置
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
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 300)); });
await page.addInitScript(() => { window.__noCloudExp = 1; window.__noSplitBar = 1;
  HTMLMediaElement.prototype.play = function () { const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20); return Promise.resolve(); }; });
await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
await page.waitForTimeout(600);
const geo = await page.evaluate(() => {
  const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height) }; };
  const dock = document.getElementById('bottomDock');
  return {
    inner: { w: innerWidth, h: innerHeight },
    stage: r('#stage'), topbar: r('#topbar'), table: r('#table'), seat0: r('#seat0'),
    hand: r('#hand'), actions: r('#actions'), handWrap: r('#handWrap'),
    liveWarn: (() => { const e = document.querySelector('#liveWarn'); return e && getComputedStyle(e).display !== 'none' ? r('#liveWarn') : null; })(),
    dock: { ...r('#bottomDock'), disp: getComputedStyle(dock).display, fixed: dock.classList.contains('dockFixed'), hpx: dock.style.height },
    dockAuto: window.__dockAuto,
    storedV4: localStorage.getItem('banshanDockHPortV4'),
    gapTableToDock: Math.round(r('#table').b - (dock.getBoundingClientRect().bottom ? 0 : 0)),
    gapHandToDockTop: Math.round(dock.getBoundingClientRect().top - r('#hand').b),
    gapActionsToDockTop: Math.round(dock.getBoundingClientRect().top - r('#actions').b),
    gapSeat0ToDockTop: Math.round(dock.getBoundingClientRect().top - r('#seat0').b),
    tableMaxH: getComputedStyle(document.getElementById('table')).maxHeight,
  };
});
console.log(JSON.stringify(geo, null, 2));
await browser.close();
