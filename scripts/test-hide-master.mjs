// 2026-11-12 专项回归：讲思路/复盘暂时隐藏（代码保留）+ 手指长按手牌不弹右键菜单、拖动可用
// 断言：①两个顶部按钮/底部讲思路面板/复盘弹窗/结算复盘入口全部不可见 ②功能函数与数据链仍在、强制点击不打开
//       ③其它顶栏按钮不受影响 ④手牌区 contextmenu / dragstart / selectstart 被拦、其它区域右键不受影响
//       ⑤CSS 长按保护（touch-callout / img pointer-events:none）⑥CDP 真实手指长按 650ms 后仍能拖动落位
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
function findBrowser() {
  return [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(p => fs.existsSync(p));
}
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: findBrowser() });
const checks = [], chk = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || '' });
const pageErrors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => pageErrors.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1;
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
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 30000 });

// ---------- ① 隐藏状态 ----------
const hide = await page.evaluate(() => {
  const disp = id => { const el = document.getElementById(id); return el ? getComputedStyle(el).display : 'missing'; };
  const width = id => { const el = document.getElementById(id); return el ? el.getBoundingClientRect().width : -1; };
  return {
    hiddenClass: document.documentElement.classList.contains('masterHidden'),
    flag: typeof MASTER_PANELS_HIDDEN !== 'undefined' ? MASTER_PANELS_HIDDEN : null,
    think: disp('thinkBtn'), review: disp('reviewBtn'), thinkW: width('thinkBtn'), reviewW: width('reviewBtn'),
    thinkContent: disp('thinkContent'), reviewModal: disp('reviewModal'),
    other: ['histBtn', 'teachBtn', 'splitBtn', 'warnBtn', 'autoBtn'].map(id => [id, disp(id)]),
  };
});
chk('顶部「讲思路」「复盘」按钮不可见', hide.think === 'none' && hide.review === 'none' && hide.thinkW === 0 && hide.reviewW === 0, JSON.stringify(hide));
chk('讲思路面板与复盘弹窗均隐藏', hide.thinkContent === 'none' && hide.reviewModal === 'none', JSON.stringify({ t: hide.thinkContent, r: hide.reviewModal }));
chk('由单一开关控制（改 false 即可恢复）', hide.hiddenClass === true && hide.flag === true, JSON.stringify({ cls: hide.hiddenClass, flag: hide.flag }));
chk('其它顶栏按钮不受影响', hide.other.every(([, d]) => d !== 'none'), JSON.stringify(hide.other));

// ---------- ② 功能代码保留 + 强制点击不打开 ----------
const keep = await page.evaluate(() => {
  const fns = ['toggleThink', 'buildThinkHTML', 'buildReviewHTML', 'liveWarn', 'toggleTeach'];
  const okFns = fns.every(k => typeof window[k] === 'function');
  let reviewHTML = '';
  try { reviewHTML = buildReviewHTML({ resultText: '测试', knowledge: REVIEW_KNOWLEDGE.basic, moves: [] }); } catch (e) { reviewHTML = 'ERR:' + e.message; }
  let thinkHTML = '';
  try { thinkHTML = buildThinkHTML(); } catch (e) { thinkHTML = 'ERR:' + e.message; }
  return { okFns, reviewLen: reviewHTML.length, thinkLen: thinkHTML.length, hasReviewData: typeof lastReview !== 'undefined' && typeof REVIEW_KNOWLEDGE === 'object' };
});
chk('讲思路/复盘函数体与数据链完整保留（未删除代码）',
  keep.okFns && keep.reviewLen > 50 && keep.thinkLen > 50 && keep.hasReviewData, JSON.stringify(keep));

const forced = await page.evaluate(() => {
  document.getElementById('thinkBtn').click();
  const afterThink = { on: thinkOn, disp: getComputedStyle(document.getElementById('thinkContent')).display };
  document.getElementById('reviewBtn').click();
  const afterReview = { disp: getComputedStyle(document.getElementById('reviewModal')).display };
  return { afterThink, afterReview };
});
chk('即使强制触发点击事件也不会打开面板/弹窗',
  forced.afterThink.on === false && forced.afterThink.disp === 'none' && forced.afterReview.disp === 'none', JSON.stringify(forced));

const modalBtn = await page.evaluate(() => {
  const b = document.createElement('button'); b.id = 'mReview'; b.textContent = '师傅复盘';
  document.body.appendChild(b);
  const d = getComputedStyle(b).display; b.remove(); return d;
});
chk('结算面板「师傅复盘」入口同步隐藏', modalBtn === 'none', modalBtn);

// 教学模式仍可独立使用（隐藏只作用于两个模块）
const teach = await page.evaluate(() => {
  if (!teachOn) document.getElementById('teachBtn').click();
  return { on: teachOn, cols: document.querySelectorAll('#teachPanel .tCol').length, adv: !!document.querySelector('.tColAdv') };
});
chk('教学模式仍可用（四栏 + 合并栏）', teach.on && teach.cols === 4 && teach.adv, JSON.stringify(teach));

// ---------- ③ 长按右键菜单拦截 ----------
const guard = await page.evaluate(() => {
  const span = document.querySelector('#hand .tile-photo');
  const img = span && span.querySelector('img');
  const fire = (el, type, Ctor) => { const ev = new Ctor(type, { bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev.defaultPrevented; };
  const out = {
    spanMenu: span ? fire(span, 'contextmenu', MouseEvent) : null,
    imgMenu: img ? fire(img, 'contextmenu', MouseEvent) : null,
    outsideMenu: fire(document.getElementById('topbar'), 'contextmenu', MouseEvent),
    dragStart: img ? fire(img, 'dragstart', Event) : null,
    selectStart: span ? fire(span, 'selectstart', Event) : null,
    callout: img ? getComputedStyle(img).webkitTouchCallout : '',
    imgPointer: img ? getComputedStyle(img).pointerEvents : '',
    tileTouchAction: span ? getComputedStyle(span).touchAction : '',
    imgDraggable: img ? img.getAttribute('draggable') : '',
  };
  return out;
});
chk('手牌上（含牌图 img）的右键菜单被阻止', guard.spanMenu === true && guard.imgMenu === true, JSON.stringify(guard));
chk('其它区域右键菜单不受影响', guard.outsideMenu === false, JSON.stringify({ outside: guard.outsideMenu }));
chk('原生拖图/长按选中被阻止', guard.dragStart === true && guard.selectStart === true, JSON.stringify({ d: guard.dragStart, s: guard.selectStart }));
chk('CSS 长按保护：callout:none + img 不接收事件 + 牌 touch-action:none',
  guard.imgPointer === 'none' && guard.tileTouchAction === 'none' && guard.imgDraggable === 'false',
  JSON.stringify({ callout: guard.callout, imgPointer: guard.imgPointer, touchAction: guard.tileTouchAction, draggable: guard.imgDraggable }));

// ---------- ④ 真实手指长按 650ms 后仍能拖动 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const tp = await ctx.newPage();
  const tErrs = []; tp.on('pageerror', e => tErrs.push(e.message));
  await tp.addInitScript(() => {
    window.__noCloudExp = 1;
    window.__cmCount = 0; window.__cmPrevented = null;
    document.addEventListener('DOMContentLoaded', () => {
      document.addEventListener('contextmenu', e => {
        if (e.target && e.target.closest && e.target.closest('#hand')) { window.__cmCount++; window.__cmPrevented = e.defaultPrevented; }
      }, false);
    });
  });
  await tp.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
  await tp.click('#startBtn');
  await tp.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
  await tp.locator('.roleBtn').first().click();
  await tp.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
  const u0 = await tp.evaluate(() => p(0).hand.map(t => t.uid));
  const pt = await tp.evaluate(() => {
    const t = [...document.querySelectorAll('#hand .tile-photo')];
    const a = t[0].getBoundingClientRect(), c = t[5].getBoundingClientRect();
    return { x1: a.left + a.width / 2, y1: a.top + a.height / 2, x2: c.right + 4, y2: c.top + a.height / 2 };
  });
  const cdp = await ctx.newCDPSession(tp);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x1, y: pt.y1, id: 1 }] });
  await tp.waitForTimeout(650); // 明显超过长按阈值，旧版本此刻弹菜单并 pointercancel
  const longPress = await tp.evaluate(() => ({
    dragging: !!document.querySelector('#hand .hDragging'),
    hdAlive: !!__hd, cm: window.__cmCount, cmPrevented: window.__cmPrevented,
  }));
  chk('手指长按 650ms 未被菜单中断（拖动状态仍在）', longPress.dragging && longPress.hdAlive, JSON.stringify(longPress));
  chk('若浏览器派发 contextmenu，均已被阻止', longPress.cm === 0 || longPress.cmPrevented === true, JSON.stringify(longPress));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pt.x1 + 10, y: pt.y1, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pt.x2, y: pt.y2, id: 1 }] });
  const mid = await tp.evaluate(() => ({
    dragging: !!document.querySelector('#hand .hDragging'),
    mark: !!document.querySelector('#hand .hDropBefore,#hand .hDropAfter'),
  }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const u1 = await tp.evaluate(() => p(0).hand.map(t => t.uid));
  chk('长按照常拖动落位、插入线可见、牌序改变',
    mid.dragging && mid.mark && u1.indexOf(u0[0]) >= 3 && tErrs.length === 0,
    JSON.stringify({ mid, at: u1.indexOf(u0[0]), errs: tErrs }));
  await ctx.close();
}

chk('全程无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
let fail = 0;
for (const c of checks) { console.log((c.ok ? '✓ ' : '✗ ') + c.name + (c.ok ? '' : '  → ' + c.detail)); if (!c.ok) fail++; }
console.log(fail ? `FAIL ${fail}/${checks.length}` : `PASS ${checks.length}/${checks.length}`);
process.exit(fail ? 1 : 0);
