// 2026-11-13 用户需求专项：我的牌太小 —— 按「一行 16 张牌」的尺度最大化显示。
// 断言：①源码口径（16 槽位、--hand2 由实测宽度反推、竖屏列间距、模式切换同步重算、旧尺寸下限）
//       ②8 种视口（手机/iPad/桌面/短横屏）牌面放大、单行、比例、零裁切、16 张确实排得进一行
//       ③教学 × 拆牌 × 4 视口组合零裁切、布局类正确 ④点选后点评框不遮挡手牌 ⑤零 JS 报错
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const HTML = fs.readFileSync(FILE, 'utf8');
const EXE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));

const results = [];
const chk = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

// ① 源码口径
chk('源码：手牌按 16 张/行定尺度，--hand2 由手牌区实测宽度反推',
  HTML.includes('const HAND_SLOTS=16;') && HTML.includes('usable/HAND_SLOTS/0.75') &&
  HTML.includes("rs.setProperty('--hand2',hand2+'px')") && !HTML.includes("rs.setProperty('--hand2',(hand*0.8)"));
chk('源码：竖屏列间距收紧到 3px，把宽度让给牌面', HTML.includes('column-gap:3px'));
chk('源码：旧尺寸作下限 + 竖向预算/上限兜底 + 宽度硬上限，不会把牌压得更小或裁切',
  HTML.includes('Math.min(byW,Math.max(hand*0.8,Math.min(byH,cap2)))') && HTML.includes('warnReserve=pp?'));
chk('源码：教学模式 / 拆牌方式切换后立即重算牌面（同步 fit）',
  (HTML.match(/fit\(\); \/\/ 2026-11-13/g) || []).length >= 2);
chk('源码：16 张留有 2px 舍入余量，保证一行排得下', HTML.includes("-2; // 留 2px 舍入余量"));

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1; window.__noSplitBar = 1;
  HTMLMediaElement.prototype.play = function () {
    const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20);
    return Promise.resolve();
  };
});
await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
await page.evaluate(() => { const b = document.getElementById('teachBtn'); if (b && !b.classList.contains('btnActive')) b.click(); });
await page.waitForTimeout(400);

const snap = () => page.evaluate(() => {
  const h = document.getElementById('hand'), seat = document.getElementById('seat0');
  const cs = getComputedStyle(h), rs = getComputedStyle(document.documentElement);
  const gx = parseFloat(cs.columnGap) || 0;
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const usable = h.clientWidth - padX - gx * 15 - 2;
  const tiles = [...h.querySelectorAll('.tile-photo')].map(e => e.getBoundingClientRect());
  const sr = seat.getBoundingClientRect(), hr = h.getBoundingClientRect();
  const rows = new Set(tiles.map(r => Math.round(r.top))).size;
  return {
    count: tiles.length, rows,
    tileW: +(tiles[0]?.width || 0).toFixed(2), tileH: +(tiles[0]?.height || 0).toFixed(2),
    hand2: parseFloat(rs.getPropertyValue('--hand2')), handVar: parseFloat(rs.getPropertyValue('--hand')),
    usable, gx, ratio: tiles[0] ? +(tiles[0].width / tiles[0].height).toFixed(3) : 0,
    clipped: tiles.filter(r => r.top < sr.top - 2 || r.bottom > sr.bottom + 2 || r.left < sr.left - 2 || r.right > sr.right + 2).length,
    handInside: hr.top >= sr.top - 2 && hr.bottom <= sr.bottom + 2,
    rightMost: Math.max(...tiles.map(r => r.right)), handRight: hr.right,
  };
});

// ② 视口矩阵：牌面放大 + 单行 + 16 张排得下 + 零裁切
const VPS = [
  ['小屏手机竖放', 360, 640], ['手机竖放', 390, 844], ['大屏手机竖放', 412, 915],
  ['iPad 竖放', 768, 1024], ['iPad Pro 竖放', 834, 1194],
  ['iPad 横放', 1024, 768], ['桌面横屏', 1280, 720], ['手机短横屏', 844, 390],
];
for (const [name, w, hgt] of VPS) {
  await page.setViewportSize({ width: w, height: hgt });
  await page.waitForTimeout(320);
  const s = await snap();
  const oldH = s.handVar * 0.8;                 // 旧版 --hand2 = hand×0.8
  const fit16 = s.tileW * 16 + s.gx * 15;      // 16 张牌 + 15 个间隙
  const room = s.usable + s.gx * 15;           // 手牌区可容纳整行的净宽
  const ok = s.count >= 13 && s.rows === 1 && s.clipped === 0 && s.handInside &&
    s.tileH > oldH + 0.5 && Math.abs(s.ratio - 0.75) < 0.05 && fit16 <= room + 3;
  chk(`${name} ${w}×${hgt}：牌面 ${s.tileW}×${s.tileH}px（旧 ${(oldH * 0.75).toFixed(1)}×${oldH.toFixed(1)}）单行零裁切`,
    ok, JSON.stringify({ rows: s.rows, clipped: s.clipped, fit16: Math.round(fit16), room: Math.round(room), ratio: s.ratio }));

  // 真的塞进 16 张牌：仍在同一行、最右不越出手牌区
  const full16 = await page.evaluate(() => {
    const h = document.getElementById('hand');
    const src = [...h.querySelectorAll('.tile-photo')];
    const clone = [];
    while (src.length + clone.length < 16) {
      const c = src[clone.length % src.length].cloneNode(true);
      c.classList.remove('sel'); c.dataset.probe = '1'; h.appendChild(c); clone.push(c);
    }
    const ts = [...h.querySelectorAll('.tile-photo')].map(e => e.getBoundingClientRect());
    const rows = new Set(ts.map(r => Math.round(r.top))).size;
    const hr = h.getBoundingClientRect();
    const out = { n: ts.length, rows, right: Math.round(Math.max(...ts.map(r => r.right))), handRight: Math.round(hr.right) };
    clone.forEach(c => c.remove());
    return out;
  });
  chk(`${name}：16 张牌仍排成一行且不越界`, full16.n === 16 && full16.rows === 1 && full16.right <= full16.handRight + 3,
    JSON.stringify(full16));
}

// ③ 教学 × 拆牌 × 视口组合零裁切
const comboBad = [];
for (const [name, w, hgt] of [['手机竖屏', 390, 844], ['手机短横屏', 844, 390], ['iPad 竖屏', 768, 1024], ['桌面横屏', 1280, 720]]) {
  await page.setViewportSize({ width: w, height: hgt });
  await page.waitForTimeout(500); // 等 resize 的即时 + 120ms/320ms 兜底重排全部落地（竖屏会强制开启教学）
  for (const teach of [false, true]) for (const split of [false, true]) {
    await page.evaluate(({ teach, split }) => {
      if (teachOn !== teach) toggleTeach();
      if (splitMode !== split) toggleSplitMode();
      render();
    }, { teach, split });
    const r = await page.evaluate(() => {
      const box = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      const seat = box('#seat0'), hand = box('#hand'), act = box('#playBtn'), sb = box('#splitBar'), tbl = document.getElementById('table');
      const sbEl = document.getElementById('splitBar');
      const tiles = [...document.querySelectorAll('#hand .tile-photo')].map(e => e.getBoundingClientRect());
      const dockEl = document.getElementById('bottomDock');
      return {
        clipped: tiles.filter(t => t.top < seat.top - 2 || t.bottom > seat.bottom + 2 || t.left < seat.left - 2 || t.right > seat.right + 2).length,
        handInside: hand.top >= seat.top - 2 && hand.bottom <= seat.bottom + 2,
        actInside: act.top >= seat.top - 2 && act.bottom <= seat.bottom + 2,
        sbInside: !sbEl || getComputedStyle(sbEl).display === 'none' || (sb.top >= seat.top - 2 && sb.bottom <= seat.bottom + 2),
        dockOK: !dockEl || getComputedStyle(dockEl).display === 'none' || (dockEl.scrollHeight <= dockEl.clientHeight || dockEl.clientHeight > 20),
        cls: [tbl.classList.contains('splitMode'), tbl.classList.contains('teachMode'), tbl.classList.contains('teachSplit')],
      };
    });
    const ok = r.clipped === 0 && r.handInside && r.actInside && r.sbInside && r.dockOK &&
      r.cls[0] === split && r.cls[1] === teach && r.cls[2] === (teach && split);
    if (!ok) comboBad.push(`${name}/教学${teach}/拆牌${split}: ${JSON.stringify(r)}`);
  }
}
chk('16 种组合（4 视口 × 教学 × 拆牌）手牌/拆解条/出牌按钮完整不裁、布局类正确',
  comboBad.length === 0, comboBad.join(' | '));

// ④ 点选后点评框不遮挡放大后的手牌
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => { if (teachOn !== true) toggleTeach(); if (splitMode !== false) toggleSplitMode(); render(); });
await page.waitForTimeout(250);
await page.locator('#hand .tile-photo').first().click();
await page.waitForTimeout(250);
const warnGeom = await page.evaluate(() => {
  const el = document.getElementById('liveWarn');
  const w = el.getBoundingClientRect(), hw = document.getElementById('handWrap').getBoundingClientRect();
  const t = document.getElementById('table').getBoundingClientRect();
  return { shown: getComputedStyle(el).display !== 'none', top: Math.round(w.top), bottom: Math.round(w.bottom),
    handBottom: Math.round(hw.bottom), tableBottom: Math.round(t.bottom), maxH: el.style.maxHeight };
});
chk('点选手牌后师傅点评框不遮挡放大后的手牌',
  warnGeom.shown && warnGeom.top >= warnGeom.handBottom - 1 && warnGeom.bottom <= warnGeom.tableBottom + 2,
  JSON.stringify(warnGeom));

chk('全程零 JS 报错', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
const pass = results.filter(r => r.ok).length;
console.log(`\n一行 16 张牌最大化专项：${pass}/${results.length} 通过`);
process.exit(pass === results.length ? 0 : 1);
