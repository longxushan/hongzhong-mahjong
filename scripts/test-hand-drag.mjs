// 2026-11-12 手牌按住拖动配牌 + 多模式布局最大化回归
// 断言：①鼠标/触摸长按均可拖动重排、uid 守恒、DOM 与数据同源 ②短按点选、双击出牌链路不被破坏
//       ③拆牌方式下按住即自动切回自由配牌 ④教学模式、竖屏两行跨行拖动可用
//       ⑤横/竖/大屏 × 教学开/关 × 拆牌开/关 12 组合：手牌、拆解条、出牌按钮完整不被 seat0 裁切
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1; // 禁云：测试数据不得写入真实云端
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

const checks = [];
const chk = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || '' });
const IDS = ['W1','W2','W3','W4','W5','T7','T7','B3','B5','B9','Z','T1','B1','W9'];

async function resetHand() {
  await page.evaluate(ids => {
    const me = p(0);
    me.hand = ids.map((id, i) => ({ id, uid: 100000 + i, suit: id === 'Z' ? 'Z' : id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) }));
    me.melds = []; me.discard = [];
    G._sel = null; __handSig = ''; render();
  }, IDS);
  await page.waitForTimeout(60); // 等一帧布局稳定，避免取到过渡中的 rect
}
const order = () => page.evaluate(() => ({
  uids: p(0).hand.map(t => t.uid), ids: p(0).hand.map(t => t.id),
  dom: [...document.querySelectorAll('#hand .tile-photo')].map(x => +x.dataset.uid),
  awaiting: G.awaiting, split: splitMode, teach: teachOn,
}));

// ---------- ① 默认态与鼠标拖动 ----------
await resetHand();
const def = await page.evaluate(() => ({
  split: splitMode, btnActive: document.getElementById('splitBtn').classList.contains('btnActive'),
  stored: localStorage.getItem('banshanSplitMode'),
}));
chk('默认仍是正常打牌（拆牌方式关闭、不留记忆）', !def.split && !def.btnActive && def.stored === null, JSON.stringify(def));

const before = await order();
chk('初始 DOM 顺序与 me.hand 完全一致', before.uids.join() === before.dom.join(), JSON.stringify(before));

async function mouseDrag(fromIdx, toIdx) {
  const pos = await page.evaluate(({ fromIdx, toIdx }) => {
    const tiles = [...document.querySelectorAll('#hand .tile-photo')];
    const a = tiles[fromIdx].getBoundingClientRect(), b = tiles[toIdx].getBoundingClientRect();
    return { x1: a.left + a.width / 2, y1: a.top + a.height / 2, x2: b.right + 3, y2: b.top + a.height / 2 };
  }, { fromIdx, toIdx });
  await page.mouse.move(pos.x1, pos.y1);
  await page.mouse.down();
  await page.mouse.move(pos.x1 + 12, pos.y1, { steps: 2 });
  await page.mouse.move(pos.x2, pos.y2, { steps: 6 });
  await page.mouse.up();
  return pos;
}
await mouseDrag(0, 5);
const afterMouse = await order();
chk('鼠标按住拖动：首张牌移到目标位置附近',
  afterMouse.uids.indexOf(before.uids[0]) >= 4 && afterMouse.uids.indexOf(before.uids[0]) <= 6,
  JSON.stringify({ at: afterMouse.uids.indexOf(before.uids[0]), uids: afterMouse.uids }));
chk('拖动后 uid 守恒、无重复、DOM 顺序与数据同源',
  afterMouse.uids.length === IDS.length && new Set(afterMouse.uids).size === IDS.length
  && afterMouse.uids.slice().sort((a, b) => a - b).join() === before.uids.slice().sort((a, b) => a - b).join()
  && afterMouse.uids.join() === afterMouse.dom.join(), JSON.stringify(afterMouse));
chk('拖动不会误出牌（仍在等出牌）', afterMouse.awaiting === 'discard', afterMouse.awaiting);
await page.waitForTimeout(380); // 等拖动手势的 click 抑制窗口过去
await page.locator('#hand .tile-photo').first().click();
const clicked = await page.evaluate(() => ({ sel: document.querySelectorAll('#hand .tile-photo.sel').length, picked: !!G._sel }));
chk('抑制窗口过后点选出牌链路正常', clicked.sel === 1 && clicked.picked, JSON.stringify(clicked));

// ---------- ② 触摸长按 / 短滑 ----------
async function touchDrag(fromIdx, toIdx, hold) {
  return await page.evaluate(async ({ fromIdx, toIdx, hold }) => {
    const el = document.getElementById('hand');
    const tiles = [...el.querySelectorAll('.tile-photo')];
    const a = tiles[fromIdx].getBoundingClientRect(), b = tiles[toIdx].getBoundingClientRect();
    const x1 = a.left + a.width / 2, y1 = a.top + a.height / 2;
    const x2 = b.right + 3, y2 = b.top + a.height / 2;
    const t = tiles[fromIdx];
    const fire = (type, x, y) => t.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: y, button: 0,
    }));
    fire('pointerdown', x1, y1);
    if (hold) { await new Promise(r => setTimeout(r, 240)); fire('pointermove', x2, y2); }
    else fire('pointermove', x1 + 40, y1);
    fire('pointerup', hold ? x2 : x1 + 40, hold ? y2 : y1);
    return { x1, y1, x2, y2 };
  }, { fromIdx, toIdx, hold });
}
await resetHand();
const beforeTouch = await order();
await touchDrag(0, 4, true);
const afterTouch = await order();
chk('手指按住 200ms 后拖动可配牌', afterTouch.uids.indexOf(beforeTouch.uids[0]) >= 3,
  JSON.stringify({ at: afterTouch.uids.indexOf(beforeTouch.uids[0]) }));
chk('触摸拖动同样 uid 守恒且 DOM 同源',
  afterTouch.uids.length === IDS.length && new Set(afterTouch.uids).size === IDS.length
  && afterTouch.uids.join() === afterTouch.dom.join(), JSON.stringify(afterTouch.uids));
await resetHand();
const beforeShort = await order();
await touchDrag(0, 4, false);
const afterShort = await order();
chk('未按住就滑动不触发配牌（短按/横滑仍归原手势）', afterShort.uids.join() === beforeShort.uids.join(), JSON.stringify(afterShort.uids));

// ---------- ③ 竖屏两行：跨行配牌 ----------
await page.setViewportSize({ width: 390, height: 844 });
// 390px 下 14 张小牌能排成一行，这里收窄手牌容器强制换行，专门验证多行的跨行配牌
await page.evaluate(() => {
  const st = document.createElement('style'); st.id = 'forceWrap';
  st.textContent = '#hand{max-width:170px!important;width:170px!important;margin:0 auto!important;}';
  document.head.appendChild(st); render();
});
await resetHand();
const beforeCross = await order();
const crossPos = await page.evaluate(() => {
  const t = [...document.querySelectorAll('#hand .tile-photo')];
  const rows = t.map(x => Math.round(x.getBoundingClientRect().top));
  const h = document.getElementById('hand'), cs = getComputedStyle(h);
  return { firstRowTop: rows[0], secondRowTop: rows.find(r => r > rows[0] + 4) || null,
    n: t.length, handW: Math.round(h.getBoundingClientRect().width), wrap: cs.flexWrap, maxW: cs.maxWidth };
});
chk('竖屏手牌确实排成两行', crossPos.secondRowTop !== null, JSON.stringify(crossPos));
await touchDrag(0, 9, true);
const afterCross = await order();
chk('竖屏可把第一行的牌拖到后面几行（跨行配牌）',
  afterCross.uids.indexOf(beforeCross.uids[0]) >= 7,
  JSON.stringify({ at: afterCross.uids.indexOf(beforeCross.uids[0]), uids: afterCross.uids }));
await page.evaluate(() => { const st = document.getElementById('forceWrap'); if (st) st.remove(); render(); });

// ---------- ④ 拆牌方式：按住即切回自由配牌 ----------
await resetHand();
await page.click('#splitBtn');
const splitBefore = await page.evaluate(() => ({ split: splitMode, cls: document.getElementById('table').classList.contains('splitMode'), grp: document.querySelectorAll('#hand > .hGrp').length }));
chk('拆牌方式可正常开启（分组框在位）', splitBefore.split && splitBefore.cls && splitBefore.grp > 0, JSON.stringify(splitBefore));
const beforeFromSplit = await order();
await touchDrag(0, 4, true);
const afterFromSplit = await order();
const clsAfterSplit = await page.evaluate(() => document.getElementById('table').classList.contains('splitMode'));
chk('拆牌方式下按住拖动 → 自动切回正常打牌', !afterFromSplit.split && !clsAfterSplit, JSON.stringify(afterFromSplit));
chk('切回后本次手势仍然完成配牌', afterFromSplit.uids.join() !== beforeFromSplit.uids.join()
  && afterFromSplit.uids.join() === afterFromSplit.dom.join(), JSON.stringify({ before: beforeFromSplit.uids, after: afterFromSplit.uids }));

// ---------- ⑤ 教学模式下拖动 ----------
await page.evaluate(() => { if (!teachOn) toggleTeach(); });
await resetHand();
const beforeTeach = await order();
await touchDrag(0, 5, true);
const afterTeach = await order();
chk('教学模式开启时照样能按住配牌', afterTeach.uids.join() !== beforeTeach.uids.join() && afterTeach.teach,
  JSON.stringify({ teach: afterTeach.teach, changed: afterTeach.uids.join() !== beforeTeach.uids.join() }));

// ---------- ⑥ 12 种组合的布局最大化 ----------
async function layoutProbe() {
  return await page.evaluate(() => {
    const box = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, h: b.height }; };
    const seat = box('#seat0'), hand = box('#hand'), act = box('#actions button'), sb = box('#splitBar'), dock = box('#bottomDock');
    const sbEl = document.getElementById('splitBar');
    const tiles = [...document.querySelectorAll('#hand .tile-photo')];
    const clipped = tiles.filter(t => { const b = t.getBoundingClientRect(); return seat && (b.top < seat.t - 2 || b.bottom > seat.b + 2 || b.left < seat.l - 2 || b.right > seat.r + 2); }).length;
    const dockEl = document.getElementById('bottomDock');
    const tbl = document.getElementById('table');
    return {
      tiles: tiles.length, clipped,
      handInside: !!(hand && seat && hand.t >= seat.t - 2 && hand.b <= seat.b + 2),
      actInside: !!(act && seat && act.t >= seat.t - 2 && act.b <= seat.b + 2),
      sbInside: !sbEl || getComputedStyle(sbEl).display === 'none' || !!(sb && seat && sb.t >= seat.t - 2 && sb.b <= seat.b + 2),
      dockScrollable: !dockEl || getComputedStyle(dockEl).display === 'none' || (dockEl.scrollHeight > dockEl.clientHeight ? dockEl.clientHeight > 20 : true),
      cls: { split: tbl.classList.contains('splitMode'), teach: tbl.classList.contains('teachMode'), both: tbl.classList.contains('teachSplit') },
      vw: innerWidth, vh: innerHeight,
    };
  });
}
let layoutBad = [];
for (const vp of [{ w: 390, h: 844, n: '竖屏' }, { w: 844, h: 390, n: '横屏' }, { w: 1280, h: 720, n: '大屏' }]) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  for (const teach of [false, true]) for (const split of [false, true]) {
    await page.evaluate(({ teach, split }) => {
      if (teachOn !== teach) toggleTeach();
      if (splitMode !== split) toggleSplitMode();
      render();
    }, { teach, split });
    const r = await layoutProbe();
    const ok = r.clipped === 0 && r.handInside && r.actInside && r.sbInside && r.dockScrollable
      && r.cls.split === split && r.cls.teach === teach && r.cls.both === (teach && split);
    if (!ok) layoutBad.push(`${vp.n}/教学${teach ? '开' : '关'}/拆牌${split ? '开' : '关'}: ${JSON.stringify(r)}`);
  }
}
chk('12 种模式组合（3 视口 × 教学 × 拆牌）手牌/拆解条/出牌按钮完整不裁、面板可滚动、布局类正确',
  layoutBad.length === 0, layoutBad.join(' | '));

// ---------- ⑦ 拖动激活态在组合布局下不被裁 ----------
async function dragVisual(vp, teach) {
  await page.setViewportSize(vp);
  await page.evaluate(t => {
    if (splitMode) toggleSplitMode();
    if (teachOn !== t) toggleTeach();
    render();
  }, teach);
  await resetHand();
  return await page.evaluate(async () => {
    const el = document.getElementById('hand');
    const t = el.querySelector('.tile-photo');
    const a = t.getBoundingClientRect();
    const fire = (type, x, y) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0 }));
    fire('pointerdown', a.left + a.width / 2, a.top + a.height / 2);
    await new Promise(r => setTimeout(r, 240));
    const drag = document.querySelector('#hand .hDragging');
    const handBox = el.getBoundingClientRect();
    const seatBox = document.getElementById('seat0').getBoundingClientRect();
    let out = { active: !!drag };
    if (drag) {
      const b = drag.getBoundingClientRect();
      out.inHand = b.top >= handBox.top - 4 && b.bottom <= handBox.bottom + 4;
      out.inSeat = b.top >= seatBox.top - 2 && b.bottom <= seatBox.bottom + 2;
      fire('pointermove', a.left + a.width / 2 + 90, a.top + a.height / 2);
      out.mark = !!document.querySelector('#hand .hDropBefore,#hand .hDropAfter');
    }
    fire('pointerup', a.left + a.width / 2, a.top + a.height / 2);
    return out;
  });
}
const vis1 = await dragVisual({ width: 390, height: 844 }, true);
chk('竖屏+教学：拖动牌与插入线完整可见、不被 overflow 裁切',
  vis1.active && vis1.inHand && vis1.inSeat && vis1.mark, JSON.stringify(vis1));
const vis2 = await dragVisual({ width: 844, height: 390 }, true);
chk('短横屏+教学：拖动牌与插入线完整可见、不被 overflow 裁切',
  vis2.active && vis2.inHand && vis2.inSeat && vis2.mark, JSON.stringify(vis2));

// ---------- ⑧ 真实手指触摸（CDP 注入 touch 事件，验证无 pointercancel）----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const tp = await ctx.newPage();
  const tErrs = []; tp.on('pageerror', e => tErrs.push(e.message));
  await tp.addInitScript(() => { window.__noCloudExp = 1; });
  await tp.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
  await tp.click('#startBtn');
  await tp.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
  await tp.locator('.roleBtn').first().click();
  try {
    await tp.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
  } catch (err) {
    const st = await tp.evaluate(() => ({ hasG: typeof G !== 'undefined', awaiting: (typeof G !== 'undefined' && G) ? G.awaiting : null, role: !!document.querySelector('#roleSelect.show'), startBtn: !!document.getElementById('startBtn') }));
    console.log('触摸页开局诊断:', JSON.stringify(st));
    throw err;
  }
  const u0 = await tp.evaluate(() => p(0).hand.map(t => t.uid));
  const pt = await tp.evaluate(() => {
    const t = [...document.querySelectorAll('#hand .tile-photo')];
    const a = t[0].getBoundingClientRect(), c = t[5].getBoundingClientRect();
    return { x1: a.left + a.width / 2, y1: a.top + a.height / 2, x2: c.right + 4, y2: c.top + a.height / 2 };
  });
  const cdp = await ctx.newCDPSession(tp);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x1, y: pt.y1, id: 1 }] });
  await tp.waitForTimeout(280);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pt.x1 + 10, y: pt.y1, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pt.x2, y: pt.y2, id: 1 }] });
  const mid = await tp.evaluate(() => ({
    dragging: !!document.querySelector('#hand .hDragging'),
    mark: !!document.querySelector('#hand .hDropBefore,#hand .hDropAfter'),
  }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const u1 = await tp.evaluate(() => p(0).hand.map(t => t.uid));
  chk('真实手指长按拖动：牌抬起、插入线、松手落位且无 pointercancel',
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
