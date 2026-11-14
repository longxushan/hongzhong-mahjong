// 临时探针：顶栏单行左右滑动（竖屏不折行）+ 右缘渐隐提示 tbMore 状态机
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
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => { window.__noCloudExp = 1; window.__noSplitBar = 1;
    HTMLMediaElement.prototype.play = function () { const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20); return Promise.resolve(); }; });
  await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
  await page.click('#startBtn');
  await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
  await page.locator('.roleBtn').first().click();
  await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const out = await page.evaluate(() => {
    const tb = document.getElementById('topbar');
    const st = getComputedStyle(tb);
    const btns = [...tb.querySelectorAll('button')];
    // 行数：按按钮 top 去重
    const tops = [...new Set(btns.map(b => Math.round(b.getBoundingClientRect().top)))].length;
    const first = { wrap: st.flexWrap, overflowX: st.overflowX, rows: tops,
      scrollable: tb.scrollWidth > tb.clientWidth + 1, more: tb.classList.contains('tbMore'),
      scrollW: tb.scrollWidth, clientW: tb.clientWidth, h: Math.round(tb.getBoundingClientRect().height) };
    return first;
  });
  // 滑到底：tbMore 应消失
  await page.evaluate(() => { const tb = document.getElementById('topbar'); tb.scrollLeft = tb.scrollWidth; tb.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(120);
  const atEnd = await page.evaluate(() => {
    const tb = document.getElementById('topbar');
    return { more: tb.classList.contains('tbMore'), scrollLeft: tb.scrollLeft };
  });
  // 回到最左：tbMore 应恢复
  await page.evaluate(() => { const tb = document.getElementById('topbar'); tb.scrollLeft = 0; tb.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(120);
  const atHome = await page.evaluate(() => document.getElementById('topbar').classList.contains('tbMore'));
  console.log(label, JSON.stringify({ ...out, atEnd, atHomeMore: atHome, errs: errs.length }));
  if (label === 'phone-port') {
    await page.screenshot({ path: 'E:/tmp-topbar.png' });
  }
  await page.close();
}

await probe(390, 844, 'phone-port');
await probe(834, 1112, 'tablet-port');
await probe(844, 390, 'phone-land');
await browser.close();
console.log('done');
