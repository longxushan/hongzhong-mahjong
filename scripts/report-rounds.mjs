// 2026-11-11 100 局战报采集：托管全自动跑满 N 局（默认 100），采集每局结算明细
// 提速：sleep 封顶 25ms + think 直通 + 250ms 轮询自动点「再来一局」（含每轮终局）
// 输出：每人胡牌/流局/净分/杠分/大牌牌型分布/红中策略指标（供风格符合度分析）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const N = parseInt(process.env.ROUNDS || '100', 10);
const OUT = process.env.OUT || path.join(ROOT, 'scripts', 'report-rounds.json');

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

const browser = await chromium.launch({ executablePath: findBrowser(), args: ['--disable-gpu', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=4096'] });
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

console.log(`目标 ${N} 局，开始托管全自动采集…`);
const t0 = Date.now();
// 段一：初始化（封顶 setTimeout、包装 presentResult、开托管）
await page.evaluate(() => {
  // 提速：override setTimeout——所有延时封顶 25ms（sleep/结算连开/动画节奏全走 setTimeout；
  // 游戏逻辑是 async/await 串行，不依赖真实时长，缩时只影响展示节奏）
  const origST = window.setTimeout.bind(window);
  window.setTimeout = function (fn, ms) {
    if (arguments.length <= 2) return origST(fn, Math.min(ms == null ? 0 : ms, 25));
    const rest = Array.prototype.slice.call(arguments, 2);
    return origST(fn, Math.min(ms == null ? 0 : ms, 25), ...rest);
  };
  window.__origST = origST;
  // 减负：整页 visibility:hidden（布局测量保留、只跳过绘制）+ 关音效/BGM
  // （crash 定位：9 分钟页面寿命疑似 WebAudio 节点泄漏——sndDraw/sndDiscard 每手创建节点 + BGM 循环 scheduler）
  try { document.documentElement.style.visibility = 'hidden'; } catch (e) { }
  try { soundOn = false; } catch (e) { }
  try {
    const btn = [...document.querySelectorAll('button')].find(b => /音乐/.test(b.textContent || ''));
    if (btn && /开/.test(btn.textContent)) btn.click();
  } catch (e) { }
  window.__rounds = [];
  const origPR = window.presentResult;
  window.presentResult = function (r) {
    try {
      window.__rounds.push({
        how: r.pl ? (r.how || 'zimo') : 'liuju',
        winner: r.pl ? r.pl.seat : null,
        winnerName: r.pl ? r.pl.name : null,
        handTypes: (r.handTypes || []).slice(),
        fs: (r.fs || []).map(f => ({ n: f.n, v: f.v })),
        total: r.total || 0,
        cap: !!r.cap,
        d: (r.d || []).map(x => ({ seat: x.seat, hu: x.hu, pay: x.pay, gang: x.gang, net: x.net })),
      });
    } catch (e) { }
    return origPR.apply(this, arguments);
  };
  // 自动点「再来一局」（普通局 2.6s 自动连开已被封顶成 25ms；每轮终局无自动——轮询点击兜底）
  setInterval(() => {
    try { const b = document.querySelector('#mNext'); if (b) b.click(); } catch (e) { }
  }, 150);
  document.getElementById('autoBtn').click();
});
// 段二：分段收数（每段 ≤90s，段间落盘防超时丢数据）
let all = [];
let names = [];
while (all.length < N) {
  const seg = await page.evaluate(async ({ startIdx, target, capMs }) => {
    const poll = ms => new Promise(r => window.__origST(r, ms));
    const t = Date.now();
    while ((window.__rounds || []).length < target && Date.now() - t < capMs) await poll(300);
    if (!window.__names || !window.__names.length) {
      try { window.__names = G.players.map(pl => ({ seat: pl.seat, name: pl.name })); } catch (e) { }
    }
    return (window.__rounds || []).slice(startIdx);
  }, { startIdx: all.length, target: N, capMs: 90000 });
  all = all.concat(seg);
  if (!names.length) {
    try { names = await page.evaluate(() => window.__names || []); } catch (e) { }
  }
  fs.writeFileSync(OUT, JSON.stringify({ rounds: all, names: names.filter(x => x) }, null, 1), 'utf-8');
  console.log(`  进度 ${all.length}/${N} 局（${((Date.now() - t0) / 60000).toFixed(1)} 分钟）`);
}
// 取名字（若段内未采到）
if (!names.length || !names[0]) {
  names = await page.evaluate(() => G.players.map(pl => ({ seat: pl.seat, name: pl.name })));
}
const result = { rounds: all, names, stoppedAt: all.length };

const dt = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`完成 ${result.stoppedAt}/${N} 局，用时 ${dt} 分钟`);
fs.writeFileSync(OUT, JSON.stringify(result, null, 1), 'utf-8');
console.log(`明细已存 ${OUT}`);

// ===== 汇总分析 =====
const R = result.rounds;
const nameMap = {};
for (const x of result.names) nameMap[x.seat] = x.name;
const seatName = s => nameMap[s] || ('座位' + s);
const aggr = {};
for (let s = 0; s < 4; s++) {
  aggr[s] = { name: seatName(s), wins: 0, liuju: 0, net: 0, gangPts: 0, gangRounds: 0, bigWins: 0, bigTypes: {}, dumpZWins: 0, capHits: 0, huTotal: 0 };
}
const typeTotal = {};
let liuju = 0, totalMultSum = 0, huRounds = 0;
const bigRounds = [];
for (const r of R) {
  if (r.how === 'liuju') { liuju++; for (const x of r.d) { aggr[x.seat].liuju++; aggr[x.seat].net += x.net; aggr[x.seat].gangPts += x.gang; if (x.gang !== 0) aggr[x.seat].gangRounds++; } continue; }
  huRounds++;
  let mult = 1; for (const f of r.fs) mult *= f.v;
  totalMultSum += mult;
  const isBig = r.handTypes.length > 0 || mult >= 2;
  const dumpZ = r.fs.some(f => /^打出\d+只红中$/.test(f.n));
  if (isBig) { aggr[r.winner].bigWins++; for (const t of r.handTypes) { aggr[r.winner].bigTypes[t] = (aggr[r.winner].bigTypes[t] || 0) + 1; typeTotal[t] = (typeTotal[t] || 0) + 1; } }
  if (dumpZ) aggr[r.winner].dumpZWins++;
  if (r.cap) aggr[r.winner].capHits++;
  aggr[r.winner].huTotal += r.total;
  if (mult >= 4) bigRounds.push({ no: R.indexOf(r) + 1, winner: seatName(r.winner), types: r.handTypes.join('、') || '基本胡', fs: r.fs.map(f => f.n + '×' + f.v).join(' '), mult, total: r.total });
  for (const x of r.d) { aggr[x.seat].net += x.net; aggr[x.seat].gangPts += x.gang; if (x.gang !== 0) aggr[x.seat].gangRounds++; if (x.hu > 0) aggr[x.seat].wins++; }
}
console.log('\n===== 100 局战报汇总 =====');
console.log(`总局数 ${R.length}，胡牌局 ${huRounds}，流局 ${liuju}（流局率 ${(liuju / R.length * 100).toFixed(0)}%）`);
const rank = Object.values(aggr).sort((a, b) => b.net - a.net);
console.log('\n最终累计排行（净分含杠分）：');
for (const a of rank) {
  console.log(`${a.name}: 净分 ${a.net >= 0 ? '+' : ''}${a.net} | 胡 ${a.wins} 局（${(a.wins / R.length * 100).toFixed(0)}%）| 胡牌总分 ${a.huTotal} | 杠分 ${a.gangPts}（${a.gangRounds} 局有杠）| 大牌胡 ${a.bigWins} 局 | 打红中翻倍胡 ${a.dumpZWins} 局 | 封顶 ${a.capHits} 次`);
}
console.log('\n全桌牌型分布（胡牌局中出现）：');
for (const t of Object.keys(typeTotal).sort((a, b) => typeTotal[b] - typeTotal[a])) console.log(`  ${t}: ${typeTotal[t]} 次`);
console.log(`胡牌局平均番数倍率：${(totalMultSum / huRounds).toFixed(2)}×`);
if (bigRounds.length) {
  console.log(`\n≥4 倍大胡局（共 ${bigRounds.length} 局）：`);
  for (const b of bigRounds.slice(0, 20)) console.log(`  第${b.no}局 ${b.winner} ${b.types} ${b.fs} = ${b.mult}× ${b.total}分`);
  if (bigRounds.length > 20) console.log(`  …另有 ${bigRounds.length - 20} 局`);
}
await browser.close();
process.exit(0);
