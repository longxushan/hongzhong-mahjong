// 临时探针：实测教学抽屉内牌面尺寸（推荐打出 tRecBig / 听牌列表 teachTile），手机竖屏 + 平板竖屏两档
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

async function probe(w, h, label) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.addInitScript(() => { window.__noCloudExp = 1; window.__noSplitBar = 1;
    HTMLMediaElement.prototype.play = function () { const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20); return Promise.resolve(); }; });
  await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
  await page.click('#startBtn');
  await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
  await page.locator('.roleBtn').first().click();
  await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
  await page.waitForTimeout(600);
  // 强制一副「打孤张即听」的手牌（13 张 + 摸入 1 = 14 张选打），保证进张/听牌列表必现
  await page.evaluate(() => {
    window.__mk = (id, uid) => ({ id, uid, suit: id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) });
    const me = p(0);
    const ids = ['W1','W1','W2','W3','W5','W5','T2','T2','T4','T4','B6','B7','B8','B9'];
    me.hand = ids.map((x, i) => window.__mk(x, 920000 + i));
    updateTeachPanel();
  });
  await page.waitForTimeout(300);
  const out = await page.evaluate(() => {
    const sm = getComputedStyle(document.documentElement).getPropertyValue('--sm') || getComputedStyle(document.getElementById('stage')).getPropertyValue('--sm');
    const rec = document.querySelector('.tRecBig .tp-sm');
    const tiles = [...document.querySelectorAll('.teachTile .tp-sm')];
    const name = document.querySelector('.tRecName');
    const recR = rec ? rec.getBoundingClientRect() : null;
    const dock = document.getElementById('bottomDock');
    const dr = dock.getBoundingClientRect();
    const tilesAll = [...document.querySelectorAll('.teachTile')];
    const overflow = tilesAll.filter(t => { const r = t.getBoundingClientRect(); return r.right > dr.right + 1 || r.left < dr.left - 1; }).length;
    return {
      smRaw: (sm || '').trim(),
      rec: recR ? { w: Math.round(recR.width), h: Math.round(recR.height) } : null,
      recNameFS: name ? getComputedStyle(name).fontSize : null,
      teachTileN: tiles.length,
      teachTile: tiles.length ? (() => { const r = tiles[0].getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
      tingTilesN: document.querySelectorAll('.tColTing .teachTile').length,
      effTilesN: document.querySelectorAll('.tSecRec .teachTile').length,
      tileOverflowN: overflow,
    };
  });
  console.log(label, JSON.stringify(out));
  if (label === 'phone') {
    const dock = await page.$('#bottomDock');
    await dock.screenshot({ path: 'E:/tmp-teach-dock.png' });
  }
  await page.close();
  return out;
}

await probe(390, 844, 'phone');
await probe(834, 1112, 'tablet');
await browser.close();
console.log('done');
