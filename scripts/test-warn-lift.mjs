// 2026-11-12 用户需求：竖屏「师傅点评」内容往上一些
// 覆盖：多机型尺寸 / 教学模式 / 拆牌模式 / 横屏，验证上抬、自适应高度、可上滑看全、不遮挡手牌与出牌按钮、轻点收起
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const EXE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1; window.__noSplitBar = 1;
  HTMLMediaElement.prototype.play = function () {
    const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 30);
    return Promise.resolve();
  };
});
await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 40000 });
await page.waitForTimeout(400);

const checks = [];
const chk = (name, ok, extra = '') => { checks.push([name, !!ok]); if (!ok) console.log('  ✗', name, extra); };

// 在页面内点选一张牌触发点评，量取真实几何与滚动信息
async function probe() {
  return page.evaluate(() => {
    mistakeWarnOn = true;
    const el = document.getElementById('liveWarn');
    const t = document.querySelector('#hand .tile-photo');
    if (t) t.click();
    const w = el.getBoundingClientRect();
    const tb = document.getElementById('table').getBoundingClientRect();
    const hw = document.querySelector('#seat0 #handWrap').getBoundingClientRect();
    const act = document.getElementById('hand').getBoundingClientRect(); // 2026-11-13：基准与 fitLiveWarnBox 一致（手牌自身下沿）
    const dock = document.getElementById('bottomDock').getBoundingClientRect();
    const inter = (a, b) => a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2;
    const before = { hidden: el.scrollHeight - el.clientHeight, over: getComputedStyle(el).overflowY, more: el.classList.contains('warnMore') };
    el.scrollTop = 9999;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    el.dispatchEvent(new Event('scroll'));
    const after = { scrollTop: el.scrollTop, atEnd, more: el.classList.contains('warnMore') };
    el.scrollTop = 0; el.dispatchEvent(new Event('scroll'));
    return {
      pport: document.getElementById('stage').classList.contains('pport'),
      shown: getComputedStyle(el).display !== 'none' && w.height > 10,
      warnTop: Math.round(w.top - tb.top), warnH: Math.round(w.height),
      bottomGap: Math.round(tb.bottom - w.bottom), gapActions: Math.round(w.top - act.bottom),
      overlap: inter(w, hw) || inter(w, act), dockGap: Math.round(dock.top - w.bottom),
      inlineTop: el.style.top, inlineBottom: el.style.bottom, inlineMaxH: el.style.maxHeight,
      hasMaster: el.textContent.includes('雀学米高'),
      text: el.textContent.slice(0, 20), before, after,
    };
  });
}

async function viewport(w, h, label) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  const r = await probe();
  console.log(`${label} ${w}x${h}:`, JSON.stringify({ warnTop: r.warnTop, warnH: r.warnH, bottomGap: r.bottomGap, gapActions: r.gapActions, hidden: r.before.hidden, overlap: r.overlap, dockGap: r.dockGap }));
  chk(`${label} 点评框顶贴手牌下沿（gap 0~12px、底边不超出牌桌）`, r.gapActions >= 0 && r.gapActions <= 12 && r.bottomGap >= 0, JSON.stringify(r));
  chk(`${label} 不遮挡手牌与出牌按钮`, !r.overlap && r.gapActions >= 0, JSON.stringify(r));
  chk(`${label} 框内长文案可滚动看全`, r.before.over === 'auto' && r.after.atEnd && r.hasMaster, JSON.stringify({ before: r.before, after: r.after }));
  chk(`${label} 上滑到底后取消渐隐`, r.before.hidden <= 2 || (r.before.more && !r.after.more), JSON.stringify({ before: r.before, after: r.after }));
  return r;
}

// ---------- ① 多机型竖屏 ----------
const r390 = await viewport(390, 844, '竖屏A');
chk('竖屏A 可用高度比旧版 88px 更大（内容往上长）', parseInt(r390.inlineMaxH, 10) > 100, `maxH=${r390.inlineMaxH}`);
chk('竖屏A 框顶已锚定手牌下沿（写入 top 自适应值）', parseInt(r390.inlineTop, 10) > 0, `top=${r390.inlineTop}`);
await viewport(430, 932, '竖屏B');
await viewport(360, 780, '竖屏C');
await viewport(390, 1140, '竖屏D');

// ---------- ② 组合模式：教学 / 拆牌 ----------
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.evaluate(() => { if (!document.getElementById('teachBtn').classList.contains('btnActive')) document.getElementById('teachBtn').click(); });
await page.waitForTimeout(400);
const rTeach = await probe();
console.log('教学模式:', JSON.stringify({ warnH: rTeach.warnH, bottomGap: rTeach.bottomGap, gapActions: rTeach.gapActions, overlap: rTeach.overlap }));
chk('教学模式下点评仍贴手牌下沿且不遮挡按钮', rTeach.gapActions >= 0 && rTeach.gapActions <= 12 && !rTeach.overlap, JSON.stringify(rTeach));
chk('教学模式下点评仍可上滑看全', rTeach.after.atEnd && rTeach.hasMaster, JSON.stringify(rTeach.after));

await page.evaluate(() => { document.getElementById('teachBtn').click(); document.getElementById('splitBtn').click(); });
await page.waitForTimeout(400);
const rSplit = await probe();
console.log('拆牌模式:', JSON.stringify({ warnH: rSplit.warnH, bottomGap: rSplit.bottomGap, gapActions: rSplit.gapActions, overlap: rSplit.overlap }));
chk('拆牌模式下点评仍贴手牌下沿且不遮挡按钮', rSplit.gapActions >= 0 && rSplit.gapActions <= 12 && !rSplit.overlap, JSON.stringify(rSplit));
chk('拆牌模式下点评仍可上滑看全', rSplit.after.atEnd && rSplit.hasMaster, JSON.stringify(rSplit.after));
await page.evaluate(() => document.getElementById('splitBtn').click());

// ---------- ③ 轻点收起 / 滑动不误关 ----------
const clickBehaviour = await page.evaluate(() => {
  const el = document.getElementById('liveWarn');
  const fire = (x, y) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  };
  // 先滑动：位移 >8px 不应关闭
  el.style.display = 'block'; el.innerHTML = '<b>师傅点评</b>测试'; el.onpointerdown({ clientX: 10, clientY: 10 });
  el.onclick({ clientX: 60, clientY: 60 });
  const afterSwipe = getComputedStyle(el).display !== 'none';
  // 再轻点：同坐标应关闭
  el.onpointerdown({ clientX: 10, clientY: 10 }); el.onclick({ clientX: 10, clientY: 10 });
  const afterTap = getComputedStyle(el).display === 'none';
  return { afterSwipe, afterTap };
});
chk('框内上滑不会误关提醒', clickBehaviour.afterSwipe, JSON.stringify(clickBehaviour));
chk('轻点仍可收起提醒', clickBehaviour.afterTap, JSON.stringify(clickBehaviour));

// ---------- ④ 横屏回退：不套竖屏上抬样式 ----------
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(500);
const rLand = await probe();
console.log('横屏:', JSON.stringify({ pport: rLand.pport, inlineBottom: rLand.inlineBottom, inlineMaxH: rLand.inlineMaxH, shown: rLand.shown, warnH: rLand.warnH }));
chk('横屏不套竖屏上抬内联样式', !rLand.pport && !rLand.inlineTop && !rLand.inlineBottom && !rLand.inlineMaxH, JSON.stringify(rLand));
chk('横屏点评仍正常显示', rLand.shown && rLand.hasMaster, JSON.stringify(rLand));

chk('全程无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));

const pass = checks.every(c => c[1]);
console.log(pass ? `\nPASS: ${checks.length}/${checks.length} 师傅点评上抬与自适应` : `\nFAIL: ${checks.filter(c => !c[1]).length} 项`);
await browser.close();
process.exit(pass ? 0 : 1);
