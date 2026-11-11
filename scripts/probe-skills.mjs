// 技能层实战探针：托管 8 局，钩子统计郑太顺/雀学米高/实战篇教学链路真实触发 + 胜负关系
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const N_GAMES = 8;

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page.evaluate(() => {
  CFG.aiDelay = 0; CFG.thinkMin = 0; CFG.thinkMax = 0;
  CFG.diceMs = 40; CFG.diceGap = 20; CFG.diceAuto = 30; CFG.diceHold = 40;
  try { soundOn = false; } catch (e) {}
});
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(
  () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard',
  null, { timeout: 30000 }
);

// 注入技能探针
await page.evaluate(() => {
  window.__skill = {
    games: [], gameCount: 0,
    ztsDangerCalls: 0, dangerHits: 0,          // 郑太顺读牌：调用次数/命中危险张信号次数
    gateCalls: 0, gateBlocked: [],              // 碰牌五不碰：评估次数/拦截明细
    keep37: 0, keepPenalty: 0,                  // 金三银七：留 3/7 加分次数 / 罚 1/9、2/8 次数
    masterqx: 0,                                // 大师心法台词冒出次数
    deadMeld: 0,                                // 雀学米高死搭统计调用（等向听选拆死搭）
    dangerAvoid: [],                            // 危险张规避：AI 持有 danger>=2 的牌但最终没打出
    winBySeat: {},
  };
  const S = window.__skill;

  const _zd = ztsDanger;
  ztsDanger = function (pl) {
    const r = _zd(pl);
    S.ztsDangerCalls++;
    const hits = Object.keys(r.danger || {}).filter(k => (r.danger[k] || 0) >= 2);
    if (hits.length) { S.dangerHits += hits.length; S._lastDanger = r.danger; }
    return r;
  };
  const _gate = ztsClaimGate;
  ztsClaimGate = function (pl, id, after, before) {
    const ok = _gate(pl, id, after, before);
    S.gateCalls++;
    if (!ok) S.gateBlocked.push({ game: S.gameCount + 1, seat: pl.seat, name: pl.name, id });
    return ok;
  };
  const _keep = ztsKeepBonus;
  ztsKeepBonus = function (id) {
    const v = _keep(id);
    if (v > 0) S.keep37++;
    if (v < 0) S.keepPenalty++;
    return v;
  };
  const _chat = chatMaybe;
  chatMaybe = function (seat, cat, prob) {
    if (cat === 'masterqx') S.masterqx++;
    return _chat(seat, cat, prob);
  };
  const _dm = qxmgDeadMeldN;
  qxmgDeadMeldN = function (ah) { S.deadMeld++; return _dm(ah); };

  // 危险张规避统计：AI 出牌前，看手里是否有 danger>=2 的牌但选择打了别的
  const _disc = discardTile;
  discardTile = function (pl, t) {
    try {
      if (!pl.human && S._lastDanger) {
        const held = Object.keys(S._lastDanger).filter(k => (S._lastDanger[k] || 0) >= 2 && pl.hand.some(x => x.id === k));
        if (held.length && !held.includes(t.id)) S.dangerAvoid.push({ game: S.gameCount + 1, seat: pl.seat, held: held.length, played: t.id });
      }
    } catch (e) {}
    return _disc(pl, t);
  };

  const _sw = showWin;
  showWin = async function (seat, how, w, from) {
    const pl = p(seat);
    S.games.push({
      n: S.gameCount + 1, seat, name: pl.name, how,
      sevenPairs: !!(w && w.sevenPairs), allPong: !!(w && w.allPong), qingyise: !!(w && w.qingyise),
      zDiscard: pl.discard.filter(t => t.id === 'Z').length,
      gangScore: pl.gangScore,
      dealerWin: seat === G.dealer,
    });
    S.gameCount++;
    return _sw(seat, how, w, from);
  };
  const _sl = showLiuJu;
  showLiuJu = async function () { S.games.push({ n: S.gameCount + 1, liuju: true }); S.gameCount++; return _sl(); };
});

// 开托管自动连打 8 局（真实点击 #autoBtn 接管挂起的 waitHuman）
await page.click('#autoBtn');
try {
  await page.waitForFunction(
    n => window.__skill && window.__skill.gameCount >= n,
    N_GAMES,
    { timeout: 900000, polling: 2000 }
  );
} catch (e) { console.log('（达到时间上限）'); }

const report = await page.evaluate(() => {
  const S = window.__skill;
  const names = {};
  try { for (let i = 0; i < 4; i++) names[i] = p(i).name; } catch (e) {}
  const winBySeat = {};
  for (const g of S.games) if (g.seat != null) winBySeat[g.seat] = (winBySeat[g.seat] || 0) + 1;
  return {
    games: S.games, winBySeat, names,
    ztsDangerCalls: S.ztsDangerCalls, dangerHits: S.dangerHits,
    gateCalls: S.gateCalls, gateBlocked: S.gateBlocked,
    keep37: S.keep37, keepPenalty: S.keepPenalty,
    masterqx: S.masterqx, deadMeld: S.deadMeld,
    dangerAvoidN: S.dangerAvoid.length, dangerAvoid: S.dangerAvoid.slice(0, 8),
    errors: [],
  };
});
report.jsErrors = errors;
console.log(JSON.stringify(report, null, 1));
await browser.close();
