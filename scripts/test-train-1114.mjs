// 2026-11-14 训练闭环 + 弃牌池放大 回归验证
// 断言：零 JS 报错、守恒 112、牌池尺寸真实放大、训练模式先答后揭、分级提示、成绩累计
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = 'E:/9-workbuddy/16-github/hzmj/repo';
const OUT = 'E:/9-workbuddy/16-github/hzmj';
const TARGET = process.env.TEST_URL || pathToFileURL(path.join(ROOT, 'index.html')).href;
const SHOT = process.env.SHOT_PREFIX || 'train-1114';
const EXE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));
if (!EXE) throw new Error('未找到 Edge/Chrome');

const errors = [];
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1; window.__noSplitBar = 1;
  HTMLMediaElement.prototype.play = function () {
    const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20);
    return Promise.resolve();
  };
});
await page.goto(TARGET, { waitUntil: 'load', timeout: 45000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });

const R = {};
R.conserve_start = await page.evaluate(() => {
  let n = 0; for (const pl of G.players) { n += pl.hand.length; for (const m of pl.melds) n += m.tiles.length; n += pl.discard.length; }
  return n + (G.tail - G.head + 1);
});
R.pool_css = await page.evaluate(() => {
  const dp = document.getElementById('discardPool');
  return { zoom: getComputedStyle(dp).zoom, disc: getComputedStyle(document.documentElement).getPropertyValue('--disc').trim(),
           tileW: getComputedStyle(dp).getPropertyValue('--disc') };
});

// 默认态：训练关闭，答案不遮挡（回归保护）
R.train_default = await page.evaluate(() => ({ on: TRAIN.on, level: TRAIN.level, answered: trainAnswered() }));

// 打开训练面板，检查内容
await page.click('#trainBtn');
R.modal_text = (await page.locator('#trainBody').innerText()).slice(0, 120);
R.modal_has_switch = (await page.locator('#trainBody [data-tr="on"]').count()) === 1;
R.modal_has_levels = (await page.locator('#trainBody [data-tr="lv"]').count()) === 3;

// 开启训练模式 → 应自动打开教学面板
await page.locator('#trainBody [data-tr="on"]').click();
R.after_on = await page.evaluate(() => ({ on: TRAIN.on, teachOn: typeof teachOn !== 'undefined' ? teachOn : null }));

// 切到 L2 只给线索
await page.locator('#trainBody [data-tr="lv"][data-v="1"]').click();
R.level_L2 = await page.evaluate(() => TRAIN.level);
await page.click('#trainCloseBtn');

// 未作答：答案区应为线索卡，且不含推荐牌
R.before_answer = await page.evaluate(() => {
  const clue = document.querySelector('.tSecRec .trClue');
  const rec = document.querySelector('.tSecRec .tRecRow');
  return { clue: clue ? clue.innerText.slice(0, 80) : null, recVisible: !!rec };
});

// 点选一张手牌 = 作答，答案应揭晓
await page.locator('#hand .tile-photo').first().click();
await page.waitForTimeout(260);
R.after_answer = await page.evaluate(() => {
  const clue = document.querySelector('.tSecRec .trClue');
  const rec = document.querySelector('.tSecRec .tRecRow');
  return { clueStill: !!clue, revealed: !!rec, recText: rec ? rec.innerText.trim() : null,
           sel: G._sel ? G._sel.id : null };
});

// 出牌 → 成绩累计
R.dec_before = await page.evaluate(() => TRAIN.dec);
await page.evaluate(() => { const t = G._sel; if (t) humanRespond(t); });
await page.waitForTimeout(420);
R.train_stat = await page.evaluate(() => ({ dec: TRAIN.dec, good: TRAIN.good, cur: TRAIN.cur, byType: TRAIN.byType }));
R.conserve_after = await page.evaluate(() => {
  let n = 0; for (const pl of G.players) { n += pl.hand.length; for (const m of pl.melds) n += m.tiles.length; n += pl.discard.length; }
  return n + (G.tail - G.head + 1);
});
R.pool_tile_rect = await page.evaluate(() => {
  const t = document.querySelector('#discardPool .tp-sm');
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
});

// 屏次截图 + 几何测量：手机竖屏 / 手机横屏 / 桌面横屏
R.geometry = {};
for (const [name, w, h] of [['phone-port', 390, 844], ['phone-land', 844, 390], ['desktop', 1280, 720]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(520);
  R.geometry[name] = await page.evaluate(() => {
    const box = id => { const e = document.getElementById(id); if (!e) return null;
      const r = e.getBoundingClientRect();
      return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), clientH: e.clientHeight, scrollH: e.scrollHeight }; };
    const t = document.querySelector('#discardPool .tp-sm');
    const tr = t ? t.getBoundingClientRect() : null;
    return { pool: box('discardPool'), center: box('center'), hand: box('hand'), seat0: box('seat0'), dock: box('bottomDock'),
             poolTile: tr ? { w: Math.round(tr.width * 10) / 10, h: Math.round(tr.height * 10) / 10 } : null,
             doc: { sw: document.documentElement.scrollWidth, vw: innerWidth, sh: document.documentElement.scrollHeight, vh: innerHeight } };
  });
  await page.screenshot({ path: path.join(OUT, `${SHOT}-${name}.png`) });
}

R.pageerrors = errors;
R.PASS = errors.length === 0
  && R.conserve_start === 112 && R.conserve_after === 112
  && R.modal_has_switch && R.modal_has_levels
  && R.after_on.on === true && R.after_on.teachOn === true
  && R.level_L2 === 1
  && !!R.before_answer.clue && R.before_answer.recVisible === false
  && R.after_answer.revealed === true && R.after_answer.clueStill === false
  && R.train_stat.dec > R.dec_before;

console.log(JSON.stringify(R, null, 2));
await browser.close();
if (!R.PASS) process.exitCode = 1;
