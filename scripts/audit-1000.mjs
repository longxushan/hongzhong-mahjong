// 2026-11-11 千局实战全面审计：托管 1000 局，采集战报/排行榜/胜率/大牌/杠型/红中/技法层触发
// 提速沿用 report-rounds.mjs：setTimeout 封顶 25ms、隐藏绘制、关声音/BGM、轮询点「再来一局」、禁云经验写入
// 所有钩子只做 O(1) 计数，不在出牌点做重计算；每 100 局落盘一次防中途丢失。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const N = parseInt(process.env.ROUNDS || '1000', 10);
const CAP = parseInt(process.env.CAP_MS || '2', 10); // 定时器封顶（默认 2ms；25ms 太慢，千局需 80 分钟）
const OUT = process.env.OUT || path.join(ROOT, 'scripts', 'audit-1000.json');

function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  return candidates.find(p => fs.existsSync(p));
}

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({
  executablePath: findBrowser(),
  args: ['--disable-gpu', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=4096'],
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1; // 千局跑局数据绝不写入真实云端经验
  window.__noSplitBar = 1; // 千局高速跑局跳过手牌拆解条精算（UI 渲染每打一次的开销）
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

console.log(`目标 ${N} 局（千局全面审计）…`);
const t0 = Date.now();
await page.evaluate((CAP) => {
  const origST = window.setTimeout.bind(window);
  window.setTimeout = function (fn, ms) {
    if (arguments.length <= 2) return origST(fn, Math.min(ms == null ? 0 : ms, CAP));
    const rest = Array.prototype.slice.call(arguments, 2);
    return origST(fn, Math.min(ms == null ? 0 : ms, CAP), ...rest);
  };
  window.__origST = origST;
  try { document.documentElement.style.visibility = 'hidden'; } catch (e) { }
  try { soundOn = false; } catch (e) { }
  try {
    const btn = [...document.querySelectorAll('button')].find(b => /音乐/.test(b.textContent || ''));
    if (btn && /开/.test(btn.textContent)) btn.click();
  } catch (e) { }

  const blank = () => ({
    zDanger: 0, zHits: 0, gateCalls: 0, gateBlock: 0, keep37: 0, keepPen: 0,
    deadMeld: 0, masterqx: 0, guard: 0, dangerAvoid: 0,
    stanceCalls: 0, stanceLock: 0, buRiskCalls: 0, buRiskBlock: 0,
    anGang: 0, buGang: 0, mingGang: 0, noBuBlock: 0, qiangTry: 0, qiangWin: 0,
    zDiscard: 0, flipZ: 0, flipMaCalls: 0, maHit: 0, moves: 0,
  });
  const A = window.__A = { rounds: [], names: [], cnt: blank(), cur: blank(), lastDanger: {}, errors: [] };
  const bump = (k, n) => { A.cnt[k] += (n || 1); A.cur[k] += (n || 1); };

  // ---- 技法层钩子（全部 O(1) 计数）----
  const _zd = ztsDanger;
  ztsDanger = function (pl) {
    const r = _zd(pl); bump('zDanger');
    const hits = Object.keys(r.danger || {}).filter(k => (r.danger[k] || 0) >= 2);
    if (hits.length) bump('zHits', hits.length);
    try { A.lastDanger[pl.seat] = r.danger; } catch (e) { }
    return r;
  };
  const _gate = ztsClaimGate;
  ztsClaimGate = function (pl, id, after, before) {
    const ok = _gate(pl, id, after, before); bump('gateCalls');
    if (!ok) bump('gateBlock'); return ok;
  };
  const _keep = ztsKeepBonus;
  ztsKeepBonus = function (id) { const v = _keep(id); if (v > 0) bump('keep37'); if (v < 0) bump('keepPen'); return v; };
  const _dead = qxmgDeadMeldN;
  qxmgDeadMeldN = function (ah) { bump('deadMeld'); return _dead(ah); };
  const _chat = chatMaybe;
  chatMaybe = function (seat, cat, prob) { if (cat === 'masterqx') bump('masterqx'); if (cat === 'guard') bump('guard'); return _chat(seat, cat, prob); };
  const _stance = bigHandStance;
  bigHandStance = function (pl, d, c, vis) { const r = _stance(pl, d, c, vis); bump('stanceCalls'); if (r) bump('stanceLock'); return r; };
  const _risk = buGangRiskOK;
  buGangRiskOK = function (pl) { const r = _risk(pl); bump('buRiskCalls'); if (!r) bump('buRiskBlock'); return r; };
  const _flip = flipMa;
  flipMa = function (pl) {
    const r = _flip(pl); bump('flipMaCalls'); bump('maHit', r.hit || 0);
    try { bump('flipZ', r.tiles.filter(t => t.id === 'Z').length); } catch (e) { }
    return r;
  };
  const _gang = doGang;
  doGang = function (pl, kind, id) {
    if (kind === 'angang') bump('anGang');
    else if (kind === 'minggang') bump('mingGang');
    else {
      const m = pl.melds.find(x => x.base === id && x.type === 'peng');
      if (!m || m.noBugang) { bump('noBuBlock'); return; } // 碰后不补杠拦截
      bump('buGang');
    }
    return _gang(pl, kind, id);
  };
  const _qg = checkQiangGang;
  checkQiangGang = async function (gs, id) { bump('qiangTry'); const r = await _qg(gs, id); if (r) bump('qiangWin'); return r; };
  const _disc = discardTile;
  discardTile = function (pl, t) {
    bump('moves');
    if (t.id === 'Z') bump('zDiscard');
    try {
      if (!pl.human && A.lastDanger[pl.seat]) {
        const dg = A.lastDanger[pl.seat];
        const held = Object.keys(dg).filter(k => dg[k] >= 2 && pl.hand.some(x => x.id === k));
        if (held.length && !held.includes(t.id)) bump('dangerAvoid');
      }
    } catch (e) { }
    return _disc(pl, t);
  };

  // ---- 战报钩子：每局结算为边界 ----
  const origPR = window.presentResult;
  window.presentResult = function (r) {
    try {
      const rec = {
        n: A.rounds.length + 1,
        how: r.pl ? (r.how || 'zimo') : 'liuju',
        winner: r.pl ? r.pl.seat : null,
        winnerName: r.pl ? r.pl.name : null,
        dealer: G.dealer,
        isDealerWin: !!(r.pl && r.pl.seat === G.dealer),
        handTypes: (r.handTypes || []).slice(),
        fs: (r.fs || []).map(f => ({ n: f.n, v: f.v })),
        total: r.total || 0,
        cap: !!r.cap,
        base: r.base || 0,
        maHit: r.ma ? r.ma.hit : null,
        maHasZ: r.ma ? !!r.ma.hasZ : null,
        maZTiles: r.ma ? r.ma.tiles.filter(t => t.id === 'Z').length : 0,
        d: (r.d || []).map(x => ({ seat: x.seat, hu: x.hu, pay: x.pay, gang: x.gang, net: x.net })),
        wallRemain: typeof wallRemain === 'function' ? wallRemain() : null,
        cur: Object.assign({}, A.cur),
      };
      A.rounds.push(rec);
      A.cur = blank();
    } catch (e) { A.errors.push(String(e && e.message || e)); }
    return origPR.apply(this, arguments);
  };

  setInterval(() => { try { const b = document.querySelector('#mNext'); if (b) b.click(); } catch (e) { } }, 30);
  document.getElementById('autoBtn').click();
}, CAP);

let rounds = [], names = [], errs = [], stall = 0;
while (rounds.length < N) {
  const before = rounds.length;
  const seg = await page.evaluate(async ({ startR, target, capMs }) => {
    const poll = ms => new Promise(r => window.__origST(r, ms));
    const t = Date.now();
    while ((window.__A.rounds || []).length < target && Date.now() - t < capMs) await poll(50);
    if (!window.__A.names || !window.__A.names.length) {
      try { window.__A.names = G.players.map(pl => ({ seat: pl.seat, name: pl.name, style: pl.style || 'flexible' })); } catch (e) { }
    }
    return {
      rounds: (window.__A.rounds || []).slice(startR),
      names: window.__A.names || [],
      cnt: window.__A.cnt,
      errors: window.__A.errors || [],
    };
  }, { startR: rounds.length, target: N, capMs: 90000 });
  rounds = rounds.concat(seg.rounds);
  if (!names.length) names = seg.names;
  errs = seg.errors;
  fs.writeFileSync(OUT, JSON.stringify({ rounds, names, cnt: seg.cnt, errors: errs, pageErrors }, null, 1), 'utf-8');
  console.log(`  进度 ${rounds.length}/${N} 局（${((Date.now() - t0) / 60000).toFixed(1)} 分钟，累计出牌 ${seg.cnt.moves} 次）`);
  if (rounds.length === before) {
    stall++;
    console.log(`  （本段无进展，第 ${stall} 次；尝试重新点托管/下一局）`);
    await page.evaluate(() => { try { const b = document.querySelector('#mNext'); if (b) b.click(); } catch (e) { } try { if (!humanAuto) document.getElementById('autoBtn').click(); } catch (e) { } });
    if (stall >= 3) { console.log('（连续 3 段无进展，提前结束）'); break; }
  } else stall = 0;
}
const finalCnt = await page.evaluate(() => window.__A ? window.__A.cnt : null).catch(() => null);
fs.writeFileSync(OUT, JSON.stringify({ rounds, names, cnt: finalCnt || {}, errors: errs, pageErrors, elapsedMin: (Date.now() - t0) / 60000, stoppedAt: rounds.length }, null, 1), 'utf-8');
console.log(`完成 ${rounds.length}/${N} 局，用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟；明细 ${OUT}`);
await browser.close();
process.exit(0);
