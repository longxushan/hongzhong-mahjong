// 2026-11-11 用户质疑「打错提醒和教学模式里很多都是错的」→ 100 局教学引擎独立审计
// 独立尺子（不复用 teachPick 的排序）：玩家可见口径 visibleLeft 下，逐张穷举
//   ① 打出后向听数 calcShanten（最硬指标） ② 立即听牌宽度 ΣvisibleLeft(vt) ③ 一进听进张 ΣvisibleLeft(draws)
//   排序：sh 最小 → iw 最大 → dw 最大。与 teachPick（真实牌墙口径 + 姿态/role）对照。
// 采集：教学推荐 vs 独立最优 vs AI 实打；liveWarn 误报/漏报；kou 文案数字与局面自相矛盾。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const N = parseInt(process.env.ROUNDS || '100', 10);
const OUT = process.env.OUT || path.join(ROOT, 'scripts', 'audit-teaching.json');

function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  return candidates.find(p => fs.existsSync(p));
}

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: findBrowser(), args: ['--disable-gpu', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=4096'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror:', e.message));
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
await page.waitForFunction(
  () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard',
  null, { timeout: 30000 }
);

console.log(`目标 ${N} 局（教学建议独立审计）…`);
const t0 = Date.now();
await page.evaluate(() => {
  const origST = window.setTimeout.bind(window);
  window.setTimeout = function (fn, ms) {
    if (arguments.length <= 2) return origST(fn, Math.min(ms == null ? 0 : ms, 25));
    const rest = Array.prototype.slice.call(arguments, 2);
    return origST(fn, Math.min(ms == null ? 0 : ms, 25), ...rest);
  };
  window.__origST = origST;
  try { document.documentElement.style.visibility = 'hidden'; } catch (e) { }
  try { soundOn = false; } catch (e) { }
  try {
    const btn = [...document.querySelectorAll('button')].find(b => /音乐/.test(b.textContent || ''));
    if (btn && /开/.test(btn.textContent)) btn.click();
  } catch (e) { }

  window.__teach = { samples: [], rounds: [], gameN: 0, errors: [] };
  const T = window.__teach;

  // 独立尺子：玩家可见口径 + 真实墙口径（一次循环同时算两套权重）
  function objective(pl) {
    const seen = {}, cands = [];
    for (const t of pl.hand) {
      if (seen[t.id]) continue; seen[t.id] = 1;
      const ah = pl.hand.filter(x => x.uid !== t.uid);
      const sh = calcShanten(ah, pl.melds);
      const vt = validTingIds(ah, pl.melds);
      let iw = 0, iwReal = 0;
      for (const x of vt) { iw += visibleLeft(x); iwReal += tileRemaining(x); }
      cands.push({ id: t.id, sh, iw, iwReal, dw: 0, dwReal: 0, ah, vt });
    }
    let shMin = 99; for (const c of cands) shMin = Math.min(shMin, c.sh);
    // 只对最小向听候选做昂贵的进张枚举
    for (const c of cands) {
      if (c.sh !== shMin) continue;
      for (const x of allTileIds()) {
        const rv = visibleLeft(x), rr = tileRemaining(x);
        if (rv <= 0 && rr <= 0) continue;
        let ok; try { ok = canReachTenpai(c.ah.concat([tileFromId(x)]), pl.melds); } catch (e) { ok = false; }
        if (ok) { c.dw += rv; c.dwReal += rr; }
      }
    }
    const vis = cands.slice().sort((a, b) => a.sh - b.sh || b.iw - a.iw || b.dw - a.dw);
    const real = cands.slice().sort((a, b) => a.sh - b.sh || b.iwReal - a.iwReal || b.dwReal - a.dwReal);
    return { cands, shMin, visTop: vis[0], realTop: real[0], worst: vis[vis.length - 1], vis, real };
  }

  // liveWarn 判定复刻（2026-11-11 改为分级：同分/更快不再判打亏）
  function warnVerdict(d, pick, tileId, pl) {
    if (tileId === pick.id) return 'good';
    if (tileId !== 'Z' && typeof notWorse === 'function' && notWorse(discardQuality(pl, tileId), discardQuality(pl, pick.id))) return 'fair';
    if (pick.stance && tileId !== 'Z') { try { if (stanceFit(pick.stance, tileId, d) > 0) return 'stance'; } catch (e) { } }
    return 'bad';
  }

  // 文案自检：kou 里的数字/措辞与当前局面是否自洽
  function kouIssues(pick, d, obj, handIds) {
    const bad = [];
    const kou = pick.kou || '';
    const m = kou.match(/共\s*(\d+)\s*张有效进张/);
    if (m) {
      const c = obj.cands.find(x => x.id === pick.id);
      // teachPick 用真实牌墙口径，应与 dwReal 一致
      if (c && Math.abs(c.dwReal - parseInt(m[1], 10)) > 0) bad.push(`进张数文案 ${m[1]} vs 实算 ${c.dwReal}`);
    }
    if (/幺九孤张先出手/.test(kou) && !/1$|9$/.test(pick.id)) bad.push('文案称幺九孤张但推荐牌非1/9');
    if (/边张进张已绝/.test(kou) && d.edge.indexOf(pick.id) < 0) bad.push('文案称边搭但推荐牌不在边搭表');
    if (/嵌张搭进张较窄/.test(kou) && d.embedded.indexOf(pick.id) < 0) bad.push('文案称嵌张但推荐牌不在嵌张表');
    if (/必须先打出一只红中/.test(kou) && pick.id !== 'Z') bad.push('文案称必须先打红中但推荐非红中');
    if (/打掉的?红中|主动打掉这只红中/.test(kou) && pick.id !== 'Z') bad.push('文案称打红中但推荐非红中');
    if (/听牌不拆搭/.test(kou) && !pick.ting) bad.push('文案称听牌但 pick.ting 为空');
    return bad;
  }

  const origPR = window.presentResult;
  window.presentResult = function (r) {
    try { T.rounds.push({ how: r.pl ? (r.how || 'zimo') : 'liuju', winner: r.pl ? r.pl.seat : null, total: r.total || 0 }); } catch (e) { }
    return origPR.apply(this, arguments);
  };

  // 所有玩家回合（含托管）：在出牌前采集教学推荐与独立尺子
  const origDT = window.discardTile;
  window.discardTile = function (pl, t) {
    try {
      if (pl.seat === 0 && pl.hand && pl.hand.length >= 2 && typeof teachPick === 'function') {
        const d = handDiagnose(pl);
        const pick = teachPick(d);
        const obj = objective(pl);
        const visId = obj.visTop.id, realId = obj.realTop.id;
        const pickC = obj.cands.find(x => x.id === pick.id);
        const issues = kouIssues(pick, d, obj, pl.hand.map(x => x.id));
        T.samples.push({
          g: T.rounds.length + 1,
          hand: pl.hand.map(x => x.id).join(','),
          stage: d.stage,
          pick: pick.id,
          visTop: visId,
          realTop: realId,
          aiPlay: t.id,
          shMin: obj.shMin,
          pickSh: pickC ? pickC.sh : null,
          deltaSh: pickC ? pickC.sh - obj.shMin : null,
          pickVsVis: pick.id === visId,
          pickVsReal: pick.id === realId,
          visVsReal: visId === realId,
          pickVsAI: pick.id === t.id,
          stance: pick.stance ? pick.stance.name : null,
          // 误报：玩家打「可见口径最优」被判打亏；漏报：打最差牌被判选得对
          warnVis: warnVerdict(d, pick, visId, pl),
          warnWorst: warnVerdict(d, pick, obj.worst.id, pl),
          worstId: obj.worst.id,
          kou: (pick.kou || '').slice(0, 150),
          issues: issues,
          // 「净值正」断言：新文案只在向听不倒退时才说净值正；记录该断言是否诚实
          goodButSuboptimal: (pick.id === visId) ? 0 : 1,
          netHonest: (function () { try { const q = discardQuality(pl, pick.id); return q && q.sh <= shMinOf(pl) ? 1 : 0; } catch (e) { return -1; } })(),
        });
      }
    } catch (e) { T.errors.push(String(e && e.message || e)); }
    return origDT.apply(this, arguments);
  };

  setInterval(() => { try { const b = document.querySelector('#mNext'); if (b) b.click(); } catch (e) { } }, 150);
  document.getElementById('autoBtn').click();
});

let samples = [], rounds = [], errs = [];
while (rounds.length < N) {
  const seg = await page.evaluate(async ({ startS, startR, target, capMs }) => {
    const poll = ms => new Promise(r => window.__origST(r, ms));
    const t = Date.now();
    while ((window.__teach.rounds || []).length < target && Date.now() - t < capMs) await poll(300);
    return {
      rounds: (window.__teach.rounds || []).slice(startR),
      samples: (window.__teach.samples || []).slice(startS),
      errors: (window.__teach.errors || []).slice(),
    };
  }, { startS: samples.length, startR: rounds.length, target: N, capMs: 90000 });
  samples = samples.concat(seg.samples);
  rounds = rounds.concat(seg.rounds);
  errs = seg.errors;
  fs.writeFileSync(OUT, JSON.stringify({ rounds, samples, errors: errs }, null, 1), 'utf-8');
  console.log(`  进度 ${rounds.length}/${N} 局，教学决策样本 ${samples.length} 个（${((Date.now() - t0) / 60000).toFixed(1)} 分钟）`);
  if (!seg.rounds.length) { console.log('（无进展，提前结束）'); break; }
}
fs.writeFileSync(OUT, JSON.stringify({ rounds, samples, errors: errs }, null, 1), 'utf-8');
console.log(`完成 ${rounds.length}/${N} 局，用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟；明细 ${OUT}`);
await browser.close();
process.exit(0);
