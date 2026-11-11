// 2026-11-11 用户需求：快速自打 100 局 + 战报 + AI 决策自检审计
// 审计口径（独立于 AI 自身打分，避免"用同一把尺子量自己"）：
//   每次 AI 出牌前，穷举全部可打牌的向听数（calcShanten）→ shMin；
//   实际打出的牌的向听 shA；delta=shA-shMin 即"这一打离最优差几步"。
//   有大牌路线/姿态允许 delta≤2（安全闸设计），无姿态 delta≥1 即非最优、≥2 记疑似错误。
// 同时 hook presentResult 采集常规战报（胜负/番型/大牌率），与审计数据一起落盘。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const N = parseInt(process.env.ROUNDS || '100', 10);
const OUT = process.env.OUT || path.join(ROOT, 'scripts', 'audit-100.json');

function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  return candidates.find(p => fs.existsSync(p));
}

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: findBrowser(), args: ['--disable-gpu', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=4096'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror:', e.message));
await page.addInitScript(() => {
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

console.log(`目标 ${N} 局（战报 + AI 决策审计）…`);
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
  window.__rounds = [];
  window.__audit = [];
  const origPR = window.presentResult;
  window.presentResult = function (r) {
    try {
      window.__rounds.push({
        how: r.pl ? (r.how || 'zimo') : 'liuju',
        winner: r.pl ? r.pl.seat : null,
        handTypes: (r.handTypes || []).slice(),
        fs: (r.fs || []).map(f => ({ n: f.n, v: f.v })),
        total: r.total || 0, cap: !!r.cap,
        d: (r.d || []).map(x => ({ seat: x.seat, hu: x.hu, pay: x.pay, gang: x.gang, net: x.net })),
      });
    } catch (e) { }
    return origPR.apply(this, arguments);
  };
  // ===== AI 决策审计 hook：所有出牌走 discardTile =====
  const origDT = window.discardTile;
  window.discardTile = function (pl, t) {
    try {
      if (!pl.human && typeof calcShanten === 'function' && pl.hand && pl.hand.length >= 2) {
        const seen = {};
        let shMin = 99;
        for (const c of pl.hand) {
          if (seen[c.id]) continue; seen[c.id] = 1;
          const ah = pl.hand.filter(x => x.uid !== c.uid);
          const sh = calcShanten(ah, pl.melds);
          if (sh < shMin) shMin = sh;
        }
        const ah2 = pl.hand.filter(x => x.uid !== t.uid);
        const shA = calcShanten(ah2, pl.melds);
        window.__audit.push({
          s: pl.seat, st: pl.style || 'flexible', t: t.id,
          d: shA - shMin, shA, shMin,
          w: G.tail - G.head + 1,
          plan: pl._plan ? pl._plan.kind : null,
          zb: typeof blockedByZRule === 'function' ? blockedByZRule(pl) : false,
          hN: pl.hand.length,
        });
      }
    } catch (e) { }
    return origDT.apply(this, arguments);
  };
  setInterval(() => {
    try { const b = document.querySelector('#mNext'); if (b) b.click(); } catch (e) { }
  }, 150);
  document.getElementById('autoBtn').click();
});

let all = [];
let audits = [];
let names = [];
while (all.length < N) {
  const seg = await page.evaluate(async ({ startIdx, target, capMs, auditStart }) => {
    const poll = ms => new Promise(r => window.__origST(r, ms));
    const t = Date.now();
    while ((window.__rounds || []).length < target && Date.now() - t < capMs) await poll(300);
    if (!window.__names || !window.__names.length) {
      try { window.__names = G.players.map(pl => ({ seat: pl.seat, name: pl.name })); } catch (e) { }
    }
    return {
      rounds: (window.__rounds || []).slice(startIdx),
      audit: (window.__audit || []).slice(auditStart),
    };
  }, { startIdx: all.length, target: N, capMs: 90000, auditStart: audits.length });
  all = all.concat(seg.rounds);
  audits = audits.concat(seg.audit);
  if (!names.length) {
    try { names = await page.evaluate(() => window.__names || []); } catch (e) { }
  }
  fs.writeFileSync(OUT, JSON.stringify({ rounds: all, audit: audits, names: names.filter(x => x) }, null, 1), 'utf-8');
  console.log(`  进度 ${all.length}/${N} 局（${((Date.now() - t0) / 60000).toFixed(1)} 分钟，审计 ${audits.length} 打）`);
}
if (!names.length || !names[0]) {
  names = await page.evaluate(() => G.players.map(pl => ({ seat: pl.seat, name: pl.name })));
}
fs.writeFileSync(OUT, JSON.stringify({ rounds: all, audit: audits, names, stoppedAt: all.length }, null, 1), 'utf-8');
const dt = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`完成 ${all.length}/${N} 局用时 ${dt} 分钟；审计样本 ${audits.length} 打；明细已存 ${OUT}`);
await browser.close();
process.exit(0);
