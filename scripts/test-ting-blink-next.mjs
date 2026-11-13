// 2026-11-13 用户需求专项：
// ① 听牌后头像左侧「听」自动变成红色字体闪烁（与教学「听牌一览」/听牌浮层同源 calcTing）
// ② 顶部菜单「重开」改「下一局」，并同步推进第 N/8 局计数（第 8 局后回到第 1/8 局起新一轮）
// 断言：源码口径、运行期听牌/未听牌/绝张态、动画与红字、结算清除、跑局钩子、局数推进与循环、零 JS 报错。
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
chk('源码：顶栏按钮文案为「下一局」且旧「重开」已移除',
  /<button id="restartBtn"[^>]*>下一局<\/button>/.test(HTML) && !/>重开<\/button>/.test(HTML));
chk('源码：结算弹窗按钮术语同步为「下一局」/「开始下一轮」',
  HTML.includes("(isFinal?'开始下一轮':'下一局')") && !HTML.includes("'再来一局'"));
chk('源码：nextRoundFromTop 推进局数并复用 8 局循环规则',
  HTML.includes('function nextRoundFromTop()') &&
  HTML.includes('document.getElementById(\'restartBtn\').onclick=nextRoundFromTop') &&
  HTML.includes('const wasFinal=roundNum>=ROUND_MAX') &&
  HTML.includes('resetCumForCurrent();roundNum=1;') &&
  HTML.includes('saveRound();updateRoundTag();'));
chk('源码：听牌红字闪烁动画 + isTing 状态类已就位',
  HTML.includes('@keyframes tingBlink') && HTML.includes('#tingBtn.isTing') &&
  HTML.includes('animation:tingBlink .9s ease-in-out infinite') &&
  HTML.includes("0%,100%{color:#ff5a45;"));
chk('源码：syncTingButton 与 calcTing 同源、带签名缓存与跑局钩子、render/结算都同步',
  HTML.includes('function syncTingButton()') && HTML.includes('__tingN=calcTing().length') &&
  HTML.includes('window.__noTingBlink||window.__noSplitBar') &&
  HTML.includes('updateTeachPanel();syncTingButton();') &&
  HTML.includes('try{syncTingButton();}catch(e){}'));

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
// 注意：本测试不能注入 __noSplitBar（会跳过听牌精算），只禁云端经验写入
await page.addInitScript(() => {
  window.__noCloudExp = 1;
  HTMLMediaElement.prototype.play = function () {
    const s = this;
    setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20);
    return Promise.resolve();
  };
});
await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });

const boot = await page.evaluate(() => ({
  restartText: document.getElementById('restartBtn').textContent.trim(),
  tingBtn: !!document.getElementById('tingBtn'),
  roundNum,
  roundTag: document.getElementById('roundTag').textContent.trim(),
  roundMax: ROUND_MAX,
}));
chk('运行期：顶栏显示「下一局」，头像左侧「听」按钮在位',
  boot.restartText === '下一局' && boot.tingBtn, JSON.stringify(boot));
chk('运行期：开局计数与顶栏标签一致（第 1/8 局）',
  boot.roundNum === 1 && boot.roundTag === '第 1/8 局' && boot.roundMax === 8,
  `roundNum=${boot.roundNum} tag=${boot.roundTag}`);

// ② 听牌态：直接把我的 13 张手牌设成「四面子 + 单吊将」，calcTing 必然非空
const tingState = await page.evaluate(() => {
  const ids = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'T1', 'T2', 'T3', 'T5'];
  let u = 90000;
  const me = p(0);
  me.hand = ids.map(id => ({ id, uid: ++u, suit: id[0], rank: parseInt(id[1], 10) }));
  me.melds = [];
  G._sel = null;
  const n = calcTing().length;
  render();
  const b = document.getElementById('tingBtn');
  const cs = getComputedStyle(b);
  return {
    n, on: b.classList.contains('isTing'), title: b.title,
    anim: cs.animationName, dur: cs.animationDuration,
    classes: b.className, sheet: (() => {
      let s = '';
      for (const sh of document.styleSheets) {
        try { for (const r of sh.cssRules) if (r.cssText.includes('tingBlink') || r.cssText.includes('#tingBtn.isTing')) s += r.cssText; } catch (e) { }
      }
      return s;
    })(),
  };
});
chk('运行期：构造听牌手牌后 calcTing 非空且与教学口径一致', tingState.n > 0, `calcTing=${tingState.n} 种`);
chk('运行期：听牌后「听」按钮挂上 isTing 类并播放闪烁动画',
  tingState.on && tingState.anim === 'tingBlink' && tingState.dur === '0.9s',
  `class=${tingState.classes} anim=${tingState.anim} dur=${tingState.dur}`);
chk('运行期：闪烁颜色为红色（#ff5a45 关键帧与静态回退）',
  HTML.includes('color:#ff5a45') && tingState.sheet.includes('@keyframes tingBlink') &&
  /rgb\(255,\s*90,\s*69\)/.test(tingState.sheet),
  tingState.sheet.slice(0, 100));
chk('运行期：听牌按钮 title 给出真实听牌种数',
  /已听牌/.test(tingState.title) && tingState.title.includes(String(tingState.n)), tingState.title);

// ③ 听牌浮层同源：点「听」能列出可胡的牌，且与 calcTing 种数一致
await page.click('#tingBtn');
const modal = await page.evaluate(() => {
  const m = document.getElementById('tingModal');
  return {
    shown: getComputedStyle(m).display !== 'none',
    text: document.getElementById('tingBody').textContent,
    items: document.querySelectorAll('#tingBody .tingItem').length,
    head: document.querySelector('#tingModal .tingHead h3').textContent,
  };
});
chk('运行期：点「听」弹出「我胡哪些牌」浮层且条目数与 calcTing 一致',
  modal.shown && /我胡哪些牌/.test(modal.head) && /当前听/.test(modal.text) &&
  modal.items === tingState.n, `items=${modal.items} calcTing=${tingState.n}`);
await page.click('#tingCloseBtn');

// ④ 未听牌态：找一组确认未听的手牌，按钮必须恢复常态
const noTing = await page.evaluate(() => {
  const sets = [
    ['W1', 'W4', 'W7', 'T1', 'T4', 'T7', 'B1', 'B4', 'B7', 'W9', 'T9', 'B9', 'B3'],
    ['W1', 'W3', 'W5', 'W7', 'W9', 'T1', 'T3', 'T5', 'T7', 'T9', 'B1', 'B3', 'B5'],
    ['W1', 'W2', 'W4', 'W5', 'W7', 'W8', 'T1', 'T2', 'T4', 'T5', 'B1', 'B2', 'B4'],
  ];
  let u = 91000, picked = -1, n = -1;
  for (let i = 0; i < sets.length; i++) {
    p(0).hand = sets[i].map(id => ({ id, uid: ++u, suit: id[0], rank: parseInt(id[1], 10) }));
    p(0).melds = [];
    n = calcTing().length;
    if (n === 0) { picked = i; break; }
  }
  G._sel = null;
  render();
  const b = document.getElementById('tingBtn');
  return { picked, n, on: b.classList.contains('isTing'), anim: getComputedStyle(b).animationName, title: b.title };
});
chk('运行期：未听牌时按钮不闪、恢复常态提示',
  noTing.picked >= 0 && noTing.n === 0 && !noTing.on && noTing.anim === 'none' && /未听牌/.test(noTing.title),
  JSON.stringify(noTing));

// ⑤ 结算与跑局钩子：G.over / __noSplitBar 下不残留闪烁，也不做无谓精算
const guard = await page.evaluate(() => {
  const ids = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'T1', 'T2', 'T3', 'T5'];
  let u = 93000;
  p(0).hand = ids.map(id => ({ id, uid: ++u, suit: id[0], rank: parseInt(id[1], 10) }));
  p(0).melds = []; G._sel = null; render();
  const before = document.getElementById('tingBtn').classList.contains('isTing');
  G.over = true; syncTingButton();
  const afterOver = document.getElementById('tingBtn').classList.contains('isTing');
  G.over = false;
  window.__noSplitBar = 1; render();
  const afterHook = document.getElementById('tingBtn').classList.contains('isTing');
  delete window.__noSplitBar; render();
  const afterRestore = document.getElementById('tingBtn').classList.contains('isTing');
  return { before, afterOver, afterHook, afterRestore };
});
chk('运行期：结算 (G.over) 与跑局钩子下清除闪烁，恢复后可重新亮起',
  guard.before && !guard.afterOver && !guard.afterHook && guard.afterRestore, JSON.stringify(guard));

// ⑥ 局数计数：点顶栏「下一局」推进第 N/8 局，且写入 localStorage
const beforeRound = await page.evaluate(() => ({ n: roundNum, t: document.getElementById('roundTag').textContent.trim(), token: G.token }));
await page.click('#restartBtn');
await page.waitForFunction(t => typeof G !== 'undefined' && !!G && G.token !== t && G.awaiting === 'discard',
  beforeRound.token, { timeout: 60000 });
const afterRound = await page.evaluate(() => ({
  n: roundNum, t: document.getElementById('roundTag').textContent.trim(),
  stored: localStorage.getItem('banshanRound'), over: !!(G && G.over),
}));
chk('运行期：顶栏「下一局」点击后局数 +1，顶栏标签同步、持久化',
  afterRound.n === beforeRound.n + 1 && afterRound.t === `第 ${afterRound.n}/8 局` &&
  afterRound.stored === String(afterRound.n) && !afterRound.over,
  `${beforeRound.n}→${afterRound.n} tag=${afterRound.t} stored=${afterRound.stored}`);

// ⑦ 第 8 局边界：点「下一局」回到第 1/8 局，累计分与战绩重置
const finalRound = await page.evaluate(() => {
  roundNum = 8; saveRound(); updateRoundTag();
  cumScore[p(0).name] = 137;
  hist.push({ r: 8, t: 'x', ht: '胡牌', d: [], hand: [], melds: [] });
  return { n: roundNum, t: document.getElementById('roundTag').textContent.trim(), cum: cumScore[p(0).name], hist: hist.length, token: G.token };
});
await page.click('#restartBtn');
await page.waitForFunction(t => typeof G !== 'undefined' && !!G && G.token !== t && G.awaiting === 'discard',
  finalRound.token, { timeout: 60000 });
const newCycle = await page.evaluate(() => ({
  n: roundNum, t: document.getElementById('roundTag').textContent.trim(),
  stored: localStorage.getItem('banshanRound'),
  cum: cumScore[p(0).name], cumAll: Object.values(cumScore).every(v => v === 100),
  hist: hist.length, restartText: document.getElementById('restartBtn').textContent.trim(),
}));
chk('运行期：第 8/8 局点「下一局」回到第 1/8 局并起新一轮（累计分 100 起底、战绩清零）',
  finalRound.n === 8 && finalRound.t === '第 8/8 局' &&
  newCycle.n === 1 && newCycle.t === '第 1/8 局' && newCycle.stored === '1' &&
  newCycle.cum === 100 && newCycle.cumAll && newCycle.hist === 0 && newCycle.restartText === '下一局',
  JSON.stringify(newCycle));

// ⑧ 顶栏宽度：文案由 2 字变 3 字，需确认手机竖屏/iPad 竖屏/横屏都不裁切（横屏允许顶栏横滑）
for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [844, 390]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(320);
  const g = await page.evaluate(() => {
    const b = document.getElementById('restartBtn'), r = b.getBoundingClientRect(), tb = document.getElementById('topbar');
    return {
      text: b.textContent.trim(),
      inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
      scrollable: tb.scrollWidth > tb.clientWidth,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
    };
  });
  chk(`布局：${w}×${h} 顶栏「下一局」完整可见（横屏顶栏可横滑）`,
    g.text === '下一局' && (g.inView || g.scrollable), JSON.stringify(g));
}

chk('零 JS 运行时异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
const pass = results.filter(r => r.ok).length;
console.log(`\n结果：${pass}/${results.length} PASS`);
if (pass !== results.length) {
  console.log('失败项：\n' + results.filter(r => !r.ok).map(r => ' - ' + r.name + ' ' + r.extra).join('\n'));
  process.exit(1);
}
