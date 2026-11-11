// 2026-11-11 AI 智能水平评估：托管全自动多局实战，采集决策质量数据
// ①向听收敛轨迹（AI 从起手到听牌的巡数）②死搭止损触发率（saved>0 决策占比）
// ③胜负分布与流局率 ④各家吃碰杠活跃度。输出原始统计供评估报告引用
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const RUN_MS = parseInt(process.env.EVAL_MS || '300000', 10); // 默认跑 5 分钟

function findBrowser() {
  if (process.env.BROWSER_PATH && fs.existsSync(process.env.BROWSER_PATH)) return process.env.BROWSER_PATH;
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  return candidates.find(p => fs.existsSync(p));
}

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('缺少 playwright-core，请先执行 npm install');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: findBrowser() });
const page = await browser.newPage();
await page.addInitScript(() => {
  window.__noCloudExp = 1; // 禁云钩子：测试跑局数据不得写入真实云端
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
await page.waitForFunction(
  () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard',
  null, { timeout: 30000 }
);

const result = await page.evaluate(async (runMs) => {
  const out = {};
  // ① 决策探针：包装 masterDiscard（AI 统一精算出口），记录向听轨迹与死搭止损触发
  window.__aiCalls = [];
  const origMD = window.masterDiscard;
  window.masterDiscard = function (pl) {
    let before = 0, saved = 0, id = null;
    try {
      before = qxmgDeadMeldN(pl.hand);
    } catch (e) { }
    const r = origMD.apply(this, arguments);
    try {
      id = r ? r.id : null;
      if (r) saved = before - qxmgDeadMeldN(pl.hand.filter(t => t.uid !== r.uid));
    } catch (e) { }
    window.__aiCalls.push({
      seat: pl.seat, name: pl.name, tour: (pl.discard || []).length,
      sh: calcShanten(pl.hand, pl.melds), id, saved
    });
    return r;
  };
  // ② 结算探针：包装 presentResult 记录每局结果
  window.__rounds = [];
  const origPR = window.presentResult;
  window.presentResult = function () {
    try {
      window.__rounds.push(JSON.stringify({ args: [...arguments].map(a => (a && a.id != null) ? a.id : a), over: !!G.over, winner: G.winnerSeat != null ? G.winnerSeat : (G.lastWin ? G.lastWin.seat : null) }));
    } catch (e) { }
    return origPR.apply(this, arguments);
  };
  // ③ 全托管
  document.getElementById('autoBtn').click();
  await new Promise(r => setTimeout(r, runMs));
  // ④ 收集
  const calls = window.__aiCalls;
  const bySeat = {};
  for (const c of calls) {
    if (!bySeat[c.seat]) bySeat[c.seat] = { name: c.name, tours: [] };
    if (c.sh != null) bySeat[c.seat].tours.push({ tour: c.tour, sh: c.sh, saved: c.saved || 0 });
  }
  // 每座位：向听收敛（起手 sh、首次到 0 的巡数、平均每巡降 sh）、死搭止损触发率
  const seats = [];
  for (const s of Object.keys(bySeat)) {
    const b = bySeat[s];
    const firstSh = b.tours.length ? b.tours[0].sh : null;
    const reach0 = b.tours.find(t => t.sh === 0);
    const savedN = b.tours.filter(t => t.saved > 0).length;
    // 分局统计巡到 0：按 tour 重置（tour 变小 = 新局）
    let rounds = [], cur = null;
    for (const t of b.tours) {
      if (!cur || t.tour <= (cur.lastTour || -1)) { cur = { startSh: t.sh, reach0: null, n: 0, lastTour: -1 }; rounds.push(cur); }
      cur.n++; cur.lastTour = t.tour;
      if (t.sh === 0 && cur.reach0 == null) cur.reach0 = t.tour;
      if (t.tour === 0) cur.startSh = t.sh;
    }
    const okRounds = rounds.filter(r => r.reach0 != null);
    seats.push({
      seat: +s, name: b.name, firstSh,
      avgReach0: okRounds.length ? +(okRounds.reduce((a, r) => a + r.reach0, 0) / okRounds.length).toFixed(1) : null,
      reachRate: rounds.length ? +(okRounds.length / rounds.length).toFixed(2) : 0,
      rounds: rounds.length, savedN, savedRate: calls.length ? +(savedN / b.tours.length).toFixed(2) : 0,
    });
  }
  out.seats = seats;
  out.decisions = calls.length;
  out.savedTotal = calls.filter(c => c.saved > 0).length;
  // 副露与战绩（从游戏状态直读）
  try {
    out.scores = G.players.map(pl => ({ seat: pl.seat, name: pl.name, score: pl.score, melds: pl.melds.length }));
    out.roundNo = G.handNo != null ? G.handNo : (G.roundNo != null ? G.roundNo : null);
  } catch (e) { }
  out.presentN = window.__rounds.length;
  return out;
}, RUN_MS);

console.log('=== AI 智能水平实测（托管全自动对局）===');
console.log(`采样决策数: ${result.decisions}（masterDiscard 调用）`);
console.log(`对局结算次数: ${result.presentN}`);
for (const s of result.seats || []) {
  console.log(`座位${s.seat} ${s.name}: 起手向听=${s.firstSh} 听牌巡数均值=${s.avgReach0} 局内听牌率=${s.reachRate}（${s.rounds}局） 死搭止损触发=${s.savedN}次(${(s.savedRate * 100).toFixed(0)}%)`);
}
if (result.scores) console.log('当前积分/副露: ' + result.scores.map(s => `${s.name} ${s.score}分/${s.melds}副露`).join('，'));
console.log(`全桌死搭止损决策占比: ${((result.savedTotal / Math.max(1, result.decisions)) * 100).toFixed(1)}%`);
await browser.close();
process.exit(0);
