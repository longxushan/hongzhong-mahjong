// 2026-11-15 摊牌模式（上帝视角）回归测试
// 断言：
//  ① 源码：按钮/面板/日志/决策理由链路齐备，masterClaim 返回 {ok,why}
//  ② 开启后：对手分析栏顶部出现摊牌面板，三家暗牌行与真实手牌数一致
//  ③ 托管跑局：AI 出牌/碰杠思路日志持续产生并渲染（含"打 "条目）
//  ④ 关闭后：面板消失、日志停止；再次开启幂等恢复
//  ⑤ 红中多打口径：手里 3 只红中但本局已打过 1 只 → 规则放行、听牌正常
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const EXE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1; window.__noSplitBar = 1;
  HTMLMediaElement.prototype.play = function () { const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20); return Promise.resolve(); };
});

let pass = 0, fail = 0;
const chk = (name, ok, info) => { if (ok) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info ? ' — ' + info : '')); } };

// ① 源码断言
chk('源码：摊牌按钮 + 开关函数 + 面板 + 日志链路齐备',
  HTML.includes('id="revealBtn"') && HTML.includes('function toggleReveal') && HTML.includes('function revealPanelHTML') &&
  HTML.includes('function pushReveal') && HTML.includes('function revealLogDiscard') && HTML.includes('function whyMasterText'));
chk('源码：masterClaim 返回 {ok,why} 决策理由（W 包装）', /const W=\(ok,why\)=>\(\{ok,why\}\)/.test(HTML));
chk('源码：摊牌默认关且不持久化（无 localStorage 记忆 revealOn）', !/localStorage[^\n]*[Rr]eveal/.test(HTML));
chk('源码：出牌/碰杠双路直播（revealLogDiscard 与 aiWantClaim 包装）', /revealOn&&\(!cur\.human\|\|cur\.auto\)\)revealLogDiscard/.test(HTML) && /function aiWantClaim\(pl,id,kind\)\{\s*const r=masterClaim/.test(HTML.replace(/\r/g, '')));

// ②③④ 运行时断言
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });

// 确保教学抽屉开着（摊牌面板挂对手分析栏）
await page.evaluate(() => { if (!teachOn) toggleTeach(); });
await page.click('#revealBtn');
await page.waitForTimeout(300);

const panel = await page.evaluate(() => {
  const box = document.querySelector('.revealBox');
  if (!box) return { has: false };
  const rows = [...box.querySelectorAll('.rvRow')];
  return {
    has: true, head: box.querySelector('.rvHead') ? box.querySelector('.rvHead').textContent : '',
    rows: rows.length,
    tilesMatch: rows.every((r, k) => r.querySelectorAll('.tp-sm').length === p(k + 1).hand.length),
    tileCount: rows.map(r => r.querySelectorAll('.tp-sm').length),
    hands: [1, 2, 3].map(i => p(i).hand.length),
    logN: box.querySelectorAll('.rvLine').length,
  };
});
chk('② 开启后摊牌面板出现（头部标识上帝视角）', panel.has && panel.head.includes('上帝视角'), JSON.stringify(panel).slice(0, 120));
chk('② 三家暗牌行数=3 且张数与真实手牌一致', panel.rows === 3 && panel.tilesMatch, JSON.stringify({ tile: panel.tileCount, hand: panel.hands }));

// ③ 托管跑局，让 AI 决策涌出日志
await page.click('#autoBtn');
await page.waitForFunction(() => G && G.revealLog && G.revealLog.length >= 6, null, { timeout: 90000 }).catch(() => {});
const logState = await page.evaluate(() => {
  const lines = [...document.querySelectorAll('.rvLine')].map(x => x.textContent);
  return { n: G.revealLog ? G.revealLog.length : 0, rendered: lines.length, hasDiscard: lines.some(x => x.includes('打 ')), sample: (G.revealLog || []).slice(0, 3) };
});
chk('③ 托管跑局：AI 思路日志 ≥6 条且渲染到面板', logState.n >= 6 && logState.rendered >= 6, JSON.stringify(logState).slice(0, 200));
chk('③ 日志含出牌条目（摸 X，打 Y —— 理由）', logState.hasDiscard, logState.sample.join(' | ').slice(0, 160));
chk('③ 决策理由非空（每条都有"："后的原因）', logState.sample.every(x => x.includes('：')), logState.sample.join(' | ').slice(0, 160));

// 关托管前先关掉可能出现的结算弹窗（托管跑局期间 AI 可能已胡牌弹窗）
async function closeAnyModal() {
  for (let k = 0; k < 6; k++) {
    const closed = await page.evaluate(() => {
      const btn = document.getElementById('mNext');
      if (btn && btn.offsetParent !== null) { btn.click(); return true; }
      const mask = [...document.querySelectorAll('.mask')].find(m => m.offsetParent !== null);
      if (mask) { const b = mask.querySelector('button'); if (b) { b.click(); return true; } }
      return false;
    });
    if (!closed) return;
    await page.waitForTimeout(500);
  }
}
await closeAnyModal();
await page.click('#autoBtn'); // 关托管，玩家重新接管
await page.waitForTimeout(300);

// ④ 关闭摊牌：面板消失、日志停
await page.click('#revealBtn');
await page.waitForTimeout(200);
const n0 = await page.evaluate(() => (G && G.revealLog) ? G.revealLog.length : -1);
await page.waitForTimeout(1200);
const closed = await page.evaluate((n0) => ({
  off: revealOn === false,
  boxGone: !document.querySelector('.revealBox'),
  n: (G && G.revealLog) ? G.revealLog.length : -1, n0,
}), n0);
chk('④ 关闭后摊牌面板消失且开关复位', closed.off && closed.boxGone, JSON.stringify(closed));
chk('④ 关闭后日志停止增长（1.2s 无新增）', closed.n <= closed.n0 || closed.n === -1, JSON.stringify(closed));
await page.click('#revealBtn');
await page.waitForTimeout(300);
const reopened = await page.evaluate(() => !!document.querySelector('.revealBox') && revealOn === true);
chk('④ 再次开启幂等恢复', reopened);
await page.click('#revealBtn');
await page.waitForTimeout(200);

// ⑤ 红中多打口径：手里 3 只红中、本局已打过 1 只 → 放行、听牌正常（用户规则：打 1 只即解锁，可多打）
const z3 = await page.evaluate(() => {
  window.__mk = (id, uid) => ({ id, uid, suit: id === 'Z' ? 'Z' : id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) });
  const me = p(0);
  me.hand = ['B1','B2','B3','B4','B5','B6','B7','B8','B9','Z','Z','Z','W2'].map((x, i) => window.__mk(x, 960000 + i));
  me.melds = [];
  me.discard = [window.__mk('Z', 960100)]; // 本局已打过 1 只红中
  return { blocked: blockedByZRule(me), ting: calcTing(), whyFormat: aiChooseDiscard(me) ? (me._whyDisc || '') : '' };
});
chk('⑤ 手里 3 红中+已打 1 → 规则放行（blockedByZRule=false）', z3.blocked === false, JSON.stringify(z3.blocked));
chk('⑤ 听牌正常计算（含 W2 将搭）', z3.ting.includes('W2'), JSON.stringify(z3.ting));

chk('运行期零 JS 报错', errs.length === 0, errs.join(';').slice(0, 200));
await browser.close();
console.log('摊牌模式专项：' + pass + '/' + (pass + fail) + ' 通过');
process.exit(fail ? 1 : 0);
