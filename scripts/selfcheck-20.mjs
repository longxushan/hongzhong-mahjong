// 2026-11-12 用户需求：自检 20 局，给出数据
// 一次托管跑满 20 局，同时采集：战报/得分/番型、AI 决策向听审计、112 张守恒、零和校验、
// JS 报错、技法层真实触发次数；跑局前后做静态链路自检（默认关闭拆牌、教学合并栏/牌河实况、拖动配牌）。
// 用法：node scripts/selfcheck-20.mjs  （ROUNDS / CAP_MS / OUT 可覆盖）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const N = parseInt(process.env.ROUNDS || '20', 10);
const CAP = parseInt(process.env.CAP_MS || '2', 10);
const OUT = process.env.OUT || path.join(ROOT, 'scripts', 'selfcheck-20.json');

function findBrowser() {
  return [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(p => fs.existsSync(p));
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
  window.__noCloudExp = 1;   // 跑局数据绝不写入真实云端经验
  window.__noSplitBar = 1;   // 快速跑局跳过拆解条精算
  try { localStorage.setItem('banshanSplitMode', '1'); } catch (e) { } // 故意预置旧记忆，验证载入时清理
  HTMLMediaElement.prototype.play = function () {
    const self = this;
    setTimeout(() => { if (typeof self.onended === 'function') self.onended(); }, 30);
    return Promise.resolve();
  };
});
await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });

// 2026-11-13：牌面已拆到 tiles.js 懒加载（掷骰阶段才加载），静态自检前先确保就绪
await page.evaluate(() => loadTiles().catch(() => {}));

// ===== 阶段 A：开局前静态链路自检 =====
const staticChecks = await page.evaluate(() => {
  const out = [], add = (name, pass, detail) => out.push({ name, pass: !!pass, detail: String(detail) });
  const ranksOK = CFG.suits.every(s => { for (let r = 1; r <= 9; r++) if (!TILES[s + r]) return false; return true; });
  add('全副 112 张 / 三门 27 种 + 红中 + 牌背',
    ranksOK && CFG.suits.length === 3 && !!TILES.Z && !!TILES.BACK
    && Object.keys(TILES).length === 29 && CFG.keepTiles === 6 && CFG.cap === 50,
    `牌面 ${Object.keys(TILES).length} 种（27 门子 + 红中 + 牌背），留底 ${CFG.keepTiles}，封顶 ${CFG.cap}`);
  add('拆牌方式默认恒关闭 + 清理旧 localStorage 记忆',
    splitMode === false && !document.getElementById('splitBtn').classList.contains('btnActive')
    && !document.getElementById('table').classList.contains('splitMode')
    && localStorage.getItem('banshanSplitMode') === null,
    `splitMode=${splitMode}, stored=${localStorage.getItem('banshanSplitMode')}`);
  add('拆牌 / 拖动配牌 / 牌理核心函数齐备',
    ['handBreakdown', 'calcShanten', 'hdDropIndex', 'hdEnd', 'poolScan', 'poolStageText', 'liveWarn', 'blockedByZRule']
      .every(k => typeof window[k] === 'function'), 'handBreakdown/calcShanten/hdDropIndex/hdEnd/poolScan/poolStageText/liveWarn/blockedByZRule');
  add('顶部按钮含「拆牌方式」「教学模式」',
    document.getElementById('splitBtn') && document.getElementById('splitBtn').textContent.includes('拆牌方式')
    && document.getElementById('teachBtn'), 'splitBtn / teachBtn');
  return out;
});

await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 30000 });

// ===== 阶段 B：开局后 UI 实况自检（教学合并栏 + 手牌默认平铺）=====
const runtimeChecks = await page.evaluate(() => {
  const out = [], add = (name, pass, detail) => out.push({ name, pass: !!pass, detail: String(detail) });
  const me = p(0);
  add('开局手牌 14 张、uid 不重复、默认不分组',
    me.hand.length === 14 && new Set(me.hand.map(t => t.uid)).size === 14
    && document.querySelectorAll('#hand .hGrp').length === 0,
    `手牌 ${me.hand.length} 张，分组框 ${document.querySelectorAll('#hand .hGrp').length}`);
  try {
    if (!teachOn) toggleTeach(); else updateTeachPanel();
    const cols = document.querySelectorAll('#teachPanel .tCol').length;
    const adv = document.querySelector('#teachPanel .tColAdv');
    const txt = adv ? adv.textContent : '';
    add('教学面板四栏 + 推荐/建议合并栏 + 废牌区实况',
      cols === 4 && !!adv && txt.includes('废牌区实况') && txt.includes('打牌建议'),
      `栏数 ${cols}，实况 ${txt.includes('废牌区实况')}，合并标题 ${txt.includes('打牌建议')}`);
    const fact = typeof poolScan === 'function' ? poolScan('W1') : null;
    add('牌河实况层输出真实可见数字', fact && typeof fact.total === 'number' && typeof fact.wall === 'number',
      fact ? `废牌区 ${fact.total} 张 / 牌墙 ${fact.wall} 张` : 'poolScan 无返回');
    if (teachOn) toggleTeach();
  } catch (e) { add('教学面板实况自检', false, e.message); }
  return out;
});

console.log(`目标 ${N} 局实战自检…`);
const t0 = Date.now();
await page.evaluate((CAP) => {
  const origST = window.setTimeout.bind(window);
  window.setTimeout = function (fn, ms) {
    if (arguments.length <= 2) return origST(fn, Math.min(ms == null ? 0 : ms, CAP));
    return origST(fn, Math.min(ms == null ? 0 : ms, CAP), ...Array.prototype.slice.call(arguments, 2));
  };
  window.__origST = origST;
  try { document.documentElement.style.visibility = 'hidden'; } catch (e) { }
  try { soundOn = false; } catch (e) { }
  try {
    const btn = [...document.querySelectorAll('button')].find(b => /音乐/.test(b.textContent || ''));
    if (btn && /开/.test(btn.textContent)) btn.click();
  } catch (e) { }

  const blank = () => ({
    moves: 0, zDiscard: 0, zDanger: 0, zHits: 0, gateCalls: 0, gateBlock: 0,
    deadMeld: 0, stanceCalls: 0, stanceLock: 0, buRiskCalls: 0, buRiskBlock: 0,
    anGang: 0, buGang: 0, mingGang: 0, qiangTry: 0, qiangWin: 0, dangerAvoid: 0,
  });
  const A = window.__S = { rounds: [], audit: [], errors: [], names: [], cnt: blank(), cur: blank(), lastDanger: {} };
  const bump = (k, n) => { A.cnt[k] += (n || 1); A.cur[k] += (n || 1); };

  // ---- 技法层钩子（O(1) 计数）----
  const _zd = ztsDanger;
  ztsDanger = function (pl) { const r = _zd(pl); bump('zDanger'); const h = Object.keys(r.danger || {}).filter(k => (r.danger[k] || 0) >= 2); if (h.length) bump('zHits', h.length); try { A.lastDanger[pl.seat] = r.danger; } catch (e) { } return r; };
  let _gate = ztsClaimGate;
  ztsClaimGate = function (pl, id, after, before) { const ok = _gate(pl, id, after, before); bump('gateCalls'); if (!ok) bump('gateBlock'); return ok; };
  let _dead = qxmgDeadMeldN;
  qxmgDeadMeldN = function (ah) { bump('deadMeld'); return _dead(ah); };
  let _stance = bigHandStance;
  bigHandStance = function (pl, d, c, vis) { const r = _stance(pl, d, c, vis); bump('stanceCalls'); if (r) bump('stanceLock'); return r; };
  let _risk = buGangRiskOK;
  buGangRiskOK = function (pl) { const r = _risk(pl); bump('buRiskCalls'); if (!r) bump('buRiskBlock'); return r; };
  let _gang = doGang;
  doGang = function (pl, kind, id) { if (kind === 'angang') bump('anGang'); else if (kind === 'minggang') bump('mingGang'); else bump('buGang'); return _gang(pl, kind, id); };
  let _qg = checkQiangGang;
  checkQiangGang = async function (gs, id) { bump('qiangTry'); const r = await _qg(gs, id); if (r) bump('qiangWin'); return r; };

  // ---- 出牌钩子：决策向听审计（独立口径，穷举全部可打牌）----
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
      if (!pl.human && typeof calcShanten === 'function' && pl.hand && pl.hand.length >= 2) {
        const seen = {}; let shMin = 99;
        for (const c of pl.hand) {
          if (seen[c.id]) continue; seen[c.id] = 1;
          const sh = calcShanten(pl.hand.filter(x => x.uid !== c.uid), pl.melds);
          if (sh < shMin) shMin = sh;
        }
        const shA = calcShanten(pl.hand.filter(x => x.uid !== t.uid), pl.melds);
        A.audit.push({ s: pl.seat, st: pl.style || 'flexible', t: t.id, d: shA - shMin, shA, shMin,
          w: G.tail - G.head + 1, plan: pl._plan ? pl._plan.kind : null,
          zb: typeof blockedByZRule === 'function' ? blockedByZRule(pl) : false });
      }
    } catch (e) { A.errors.push('audit: ' + String(e && e.message || e)); }
    return _disc(pl, t);
  };

  // ---- 结算钩子：战报 + 守恒 + 零和 ----
  const origPR = presentResult;
  presentResult = function (r) {
    try {
      let handN = 0, discN = 0, meldN = 0, idOver = 0, uidDup = 0;
      const idCnt = {}, uidSet = new Set();
      for (const pl of G.players) {
        handN += pl.hand.length; discN += pl.discard.length;
        for (const m of pl.melds) meldN += (m.tiles ? m.tiles.length : 0);
        for (const t of [...pl.hand, ...pl.discard, ...pl.melds.flatMap(m => m.tiles || [])]) {
          idCnt[t.id] = (idCnt[t.id] || 0) + 1;
          if (uidSet.has(t.uid)) uidDup++; else uidSet.add(t.uid);
        }
      }
      for (let i = G.head; i <= G.tail; i++) { const t = G.wall[i]; if (t) idCnt[t.id] = (idCnt[t.id] || 0) + 1; }
      for (const k in idCnt) if (idCnt[k] > 4) idOver++;
      const wall = G.tail - G.head + 1;
      const rec = {
        n: A.rounds.length + 1,
        how: r.pl ? (r.how || 'zimo') : 'liuju',
        winner: r.pl ? r.pl.seat : null, winnerName: r.pl ? r.pl.name : null,
        dealer: G.dealer, isDealerWin: !!(r.pl && r.pl.seat === G.dealer),
        handTypes: (r.handTypes || []).slice(),
        fs: (r.fs || []).map(f => ({ n: f.n, v: f.v })),
        total: r.total || 0, cap: !!r.cap, base: r.base || 0,
        maHit: r.ma ? r.ma.hit : null, maHasZ: r.ma ? !!r.ma.hasZ : null,
        maZTiles: r.ma ? (r.ma.tiles || []).filter(t => t.id === 'Z').length : 0,
        d: (r.d || []).map(x => ({ seat: x.seat, hu: x.hu, pay: x.pay, gang: x.gang, net: x.net })),
        wallRemain: wall,
        cons: { handN, discN, meldN, wall, total: handN + discN + meldN + wall,
          kinds: Object.keys(idCnt).length, idSum: Object.values(idCnt).reduce((a, b) => a + b, 0),
          idOver, uidDup, zeroSum: (r.d || []).reduce((a, x) => a + x.net, 0) },
        cur: Object.assign({}, A.cur),
      };
      A.rounds.push(rec);
      A.cur = blank();
    } catch (e) { A.errors.push('result: ' + String(e && e.message || e)); }
    return origPR.apply(this, arguments);
  };

  setInterval(() => { try { const b = document.querySelector('#mNext'); if (b) b.click(); } catch (e) { } }, 30);
  document.getElementById('autoBtn').click();
}, CAP);

let rounds = [], audit = [], names = [], cnt = {}, errors = [], stall = 0;
while (rounds.length < N) {
  const before = rounds.length;
  const seg = await page.evaluate(async ({ startR, startA, target, capMs }) => {
    const poll = ms => new Promise(r => window.__origST(r, ms));
    const t = Date.now();
    while ((window.__S.rounds || []).length < target && Date.now() - t < capMs) await poll(50);
    if (!window.__S.names.length) {
      try { window.__S.names = G.players.map(pl => ({ seat: pl.seat, name: pl.name, style: pl.style || 'flexible' })); } catch (e) { }
    }
    return { rounds: window.__S.rounds.slice(startR), audit: window.__S.audit.slice(startA),
      names: window.__S.names, cnt: window.__S.cnt, errors: window.__S.errors };
  }, { startR: rounds.length, startA: audit.length, target: N, capMs: 90000 });
  rounds = rounds.concat(seg.rounds);
  audit = audit.concat(seg.audit);
  if (!names.length) names = seg.names;
  cnt = seg.cnt; errors = seg.errors;
  fs.writeFileSync(OUT, JSON.stringify({ rounds, audit, names, cnt, errors, pageErrors, staticChecks, runtimeChecks }, null, 1), 'utf-8');
  console.log(`  进度 ${rounds.length}/${N} 局（${((Date.now() - t0) / 60000).toFixed(1)} 分钟，出牌 ${cnt.moves} 次，审计 ${audit.length} 打）`);
  if (rounds.length === before) {
    stall++;
    await page.evaluate(() => { try { const b = document.querySelector('#mNext'); if (b) b.click(); } catch (e) { } try { if (!humanAuto) document.getElementById('autoBtn').click(); } catch (e) { } });
    if (stall >= 3) { console.log('（连续 3 段无进展，提前结束）'); break; }
  } else stall = 0;
}
const final = await page.evaluate(() => window.__S ? { cnt: window.__S.cnt, errors: window.__S.errors } : null).catch(() => null);
const result = { rounds, audit, names, cnt: (final && final.cnt) || cnt, errors: (final && final.errors) || errors,
  pageErrors, staticChecks, runtimeChecks, elapsedMin: (Date.now() - t0) / 60000, stoppedAt: rounds.length };
fs.writeFileSync(OUT, JSON.stringify(result, null, 1), 'utf-8');
console.log(`完成 ${rounds.length}/${N} 局，用时 ${result.elapsedMin.toFixed(1)} 分钟；决策审计 ${audit.length} 打；明细 ${OUT}`);
await browser.close();
process.exit(0);
