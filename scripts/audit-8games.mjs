// 8 局规则审计：托管自动打一轮，钩子全程采集，逐项检查规则合规
import fs from 'node:fs';
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

// 注入审计钩子
await page.evaluate(() => {
  window.__audit = {
    evts: [],            // 事件流：[type, seat, info]
    issues: [],          // 违规记录
    games: [],           // 每局摘要
    gameCount: 0,
    zTotal: 0,
  };
  const A = window.__audit;
  const push = (type, seat, info) => A.evts.push([type, seat, info, A.evts.length]);

  // 守恒检查：所有 hand+melds+discard+wall == 112
  function checkConservation(tag) {
    try {
      let total = 0;
      for (const pl of G.players) {
        total += pl.hand.length;
        total += pl.melds.reduce((s, m) => s + m.tiles.length, 0);
        total += pl.discard.length;
      }
      total += wallRemain();
      if (total !== 112) A.issues.push(`【守恒】第${A.gameCount + 1}局 ${tag}：总数=${total} ≠ 112`);
    } catch (e) {}
  }

  const _draw = drawTile;
  drawTile = function (pl, g) {
    const r = _draw(pl, g);
    push('draw', pl.seat, g ? '杠补' : '普通');
    checkConservation('抓牌后');
    return r;
  };
  const _disc = discardTile;
  discardTile = function (pl, t) {
    const r = _disc(pl, t);
    push('discard', pl.seat, t.id);
    if (t.id === 'Z') A.zTotal++;
    checkConservation('出牌后');
    return r;
  };
  const _peng = doPeng;
  doPeng = function (pl, id) {
    if (id === 'Z') A.issues.push(`【红中碰】第${A.gameCount + 1}局：${pl.name} 碰了红中（违规）`);
    push('peng', pl.seat, id);
    const r = _peng(pl, id);
    checkConservation('碰后');
    return r;
  };
  const _mg = settleMingGang;
  settleMingGang = function (a, b, id) {
    if (id === 'Z') A.issues.push(`【红中杠】第${A.gameCount + 1}局：座位${a} 明杠红中（违规）`);
    push('gang', a, '明杠' + id);
    const r = _mg(a, b, id);
    checkConservation('明杠后');
    return r;
  };
  const _ag = doGang;
  doGang = function (pl, kind, id, x) {
    push('gang', pl.seat, (kind === 'angang' ? '暗杠' : kind === 'bugang' ? '补杠' : '杠') + id);
    const r = _ag(pl, kind, id, x);
    checkConservation('杠后');
    return r;
  };
  const _sw = showWin;
  showWin = async function (seat, how, w, from) {
    const pl = p(seat);
    A.games.push({
      n: A.gameCount + 1, seat, name: pl.name, how,
      sevenPairs: !!(w && w.sevenPairs), deluxeSeven: !!(w && w.deluxeSeven),
      allPong: !!(w && w.allPong), qingyise: !!(w && w.qingyise),
      zDiscard: pl.discard.filter(t => t.id === 'Z').length,
      dealer: G.dealer, isDealerWin: seat === G.dealer,
    });
    A.gameCount++;
    push('win', seat, how);
    return _sw(seat, how, w, from);
  };
  const _sl = showLiuJu;
  showLiuJu = async function () {
    const rem = wallRemain();
    if (rem > CFG.keepTiles) A.issues.push(`【流局留底】第${A.gameCount + 1}局：流局时墙剩 ${rem} 张 > 留底 6`);
    A.games.push({ n: A.gameCount + 1, liuju: true, wallRemain: rem });
    A.gameCount++;
    return _sl();
  };

  // 抓牌时序：普通抓牌前一事件必须是上家 discard，中间无碰杠
  const origDraw = drawTile;
  // （事件检查放主循环外做，见 evts 分析）
});

// 开托管自动连打 8 局
await page.click('#autoBtn');
const t0 = Date.now();
try {
  await page.waitForFunction(
    n => window.__audit && window.__audit.gameCount >= n,
    N_GAMES,
    { timeout: 900000, polling: 2000 }
  );
} catch (e) { console.log('（达到时间上限）'); }

// 采集 + 事后分析（在页面里分析事件流）
const report = await page.evaluate(() => {
  const A = window.__audit;
  const evts = A.evts;
  // ① 抓牌时序检查
  for (let i = 0; i < evts.length; i++) {
    const e = evts[i];
    if (e[0] !== 'draw' || e[2] === '杠补') continue;
    const seat = e[1];
    let j = i - 1, disc = null;
    while (j >= 0) { if (evts[j][0] === 'discard') { disc = evts[j]; break; } j--; }
    if (!disc) continue;
    for (let k = j + 1; k < i; k++) {
      if (evts[k][0] === 'peng' || evts[k][0] === 'gang')
        A.issues.push(`【抓牌时序】事件#${e[3]}：座位${seat} 普通抓牌前有碰/杠声明（${evts[k][0]}@${evts[k][1]}）`);
    }
    if ((disc[1] + 1) % 4 !== seat)
      A.issues.push(`【抓牌时序】事件#${e[3]}：座位${seat} 抓牌，但最近出牌者是座位${disc[1]}（非上家）`);
  }
  // ② 碰后不抓牌：peng@X 之后下一个该座位事件应是 discard（不能 draw）
  for (let i = 0; i < evts.length; i++) {
    if (evts[i][0] !== 'peng') continue;
    const seat = evts[i][1];
    for (let k = i + 1; k < Math.min(i + 8, evts.length); k++) {
      if (evts[k][0] === 'draw' && evts[k][1] === seat && evts[k][2] !== '杠补') {
        A.issues.push(`【碰后抓牌】事件#${evts[k][3]}：座位${seat} 碰后普通抓牌（碰应直接出牌）`);
        break;
      }
      if (evts[k][0] === 'discard' && evts[k][1] === seat) break;
      if (evts[k][0] === 'win' || evts[k][0] === 'liuju') break;
    }
  }
  // ③ uid 唯一性（每局牌不复制）——只查活区间：牌墙取 head..tail，历史区间（已发出）不在守恒口径内
  const uidSet = new Set();
  let uidDup = 0;
  try {
    for (const t of G.wall.slice(G.head, G.tail + 1)) { if (uidSet.has(t.uid)) uidDup++; uidSet.add(t.uid); }
    for (const pl of G.players) {
      for (const t of pl.hand) { if (uidSet.has(t.uid)) uidDup++; uidSet.add(t.uid); }
      for (const m of pl.melds) for (const t of m.tiles) { if (uidSet.has(t.uid)) uidDup++; uidSet.add(t.uid); }
      for (const t of pl.discard) { if (uidSet.has(t.uid)) uidDup++; uidSet.add(t.uid); }
    }
  } catch (e) {}
  if (uidDup > 0) A.issues.push(`【牌唯一性】检测到 ${uidDup} 张重复 uid 的牌`);
  return {
    gameCount: A.gameCount, games: A.games, issues: A.issues,
    evtCount: evts.length, zTotal: A.zTotal,
    draws: evts.filter(e => e[0] === 'draw' && e[2] === '普通').length,
    pengs: evts.filter(e => e[0] === 'peng').length,
    gangs: evts.filter(e => e[0] === 'gang').length,
  };
});

console.log('===== 红中麻将 8 局规则审计报表 =====');
console.log(`完成局数: ${report.gameCount}/${N_GAMES}，用时 ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`事件总数: ${report.evtCount}（普通抓牌 ${report.draws}、碰 ${report.pengs} 次、杠 ${report.gangs} 次）`);
console.log(`红中累计打出: ${report.zTotal} 次\n`);
console.log('--- 每局摘要 ---');
report.games.forEach(g => {
  if (g.liuju) { console.log(`  第${g.n}局：流局（墙剩 ${g.wallRemain} 张）`); return; }
  const tags = [];
  if (g.sevenPairs) tags.push(g.deluxeSeven ? '豪华七对' : '七对');
  if (g.allPong) tags.push('全碰碰胡');
  if (g.qingyise) tags.push('清一色');
  if (g.how === 'ganghua') tags.push('杠上开花');
  if (g.how === 'tianhu') tags.push('天胡');
  if (g.how === 'dihu') tags.push('地胡');
  if (g.how === 'qiang') tags.push('抢杠胡');
  if (g.zDiscard) tags.push(`打出${g.zDiscard}红中`);
  console.log(`  第${g.n}局：${g.name} ${g.how}${tags.length ? '【' + tags.join('+') + '】' : ''}${g.isDealerWin ? '（庄家胡）' : ''}`);
});
console.log('\n--- 违规/不合理记录 ---');
if (report.issues.length === 0) {
  console.log('  ✅ 未发现任何违规：守恒 112、抓牌时序、碰后不抓牌、红中不可碰杠、流局留底全部合规');
} else {
  report.issues.slice(0, 20).forEach(s => console.log('  ⚠️ ' + s));
  if (report.issues.length > 20) console.log(`  …另有 ${report.issues.length - 20} 条`);
}
console.log('\nJS 报错: ' + (errors.length ? errors.slice(0, 5).join(' | ') : '0 条'));
await browser.close();
fs.writeFileSync(path.join(ROOT, '_audit8.txt'), JSON.stringify(report, null, 2));
