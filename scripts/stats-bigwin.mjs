// 统计大牌型出现率：托管自动连开多局，钩子记录每局胡牌番型
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const N_GAMES = 12; // 目标局数

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

// 钩子：包装 showWin 收集每局胡牌番型；包装 discardTile 统计红中主动打出
await page.evaluate(() => {
  window.__stats = { games: [], zDumped: 0 };
  const _sw = showWin;
  window.showWin = async function (seat, how, w, from) {
    const pl = p(seat);
    window.__stats.games.push({
      seat, how,
      sevenPairs: !!(w && w.sevenPairs),
      deluxeSeven: !!(w && w.deluxeSeven),
      allPong: !!(w && w.allPong),
      qingyise: !!(w && w.qingyise),
      name: pl.name,
      zDiscard: pl.discard.filter(t => t.id === 'Z').length,
    });
    return _sw(seat, how, w, from);
  };
  const _dt = discardTile;
  window.discardTile = function (pl, t) {
    if (t.id === 'Z') window.__stats.zDumped++;
    return _dt(pl, t);
  };
});

// 开托管自动连开
await page.click('#autoBtn');

const t0 = Date.now();
let lastCount = -1, stable = 0;
try {
  await page.waitForFunction(
    n => (window.__stats && window.__stats.games.length >= n),
    N_GAMES,
    { timeout: 600000, polling: 1000 }
  );
} catch (e) {
  console.log('超时或达到限制');
}

const stats = await page.evaluate(() => window.__stats);
const games = stats.games;
console.log(`完成局数: ${games.length}/${N_GAMES}，用时 ${Math.round((Date.now() - t0) / 1000)}s，红中主动打出次数: ${stats.zDumped}`);
console.log('\n每局胡牌明细:');
games.forEach((g, i) => {
  const tags = [];
  if (g.sevenPairs) tags.push(g.deluxeSeven ? '豪华七对' : '七对');
  if (g.allPong) tags.push('全碰碰胡');
  if (g.qingyise) tags.push('清一色');
  if (g.how === 'ganghua') tags.push('杠上开花');
  if (g.how === 'tianhu') tags.push('天胡');
  if (g.how === 'dihu') tags.push('地胡');
  if (g.how === 'qiang') tags.push('抢杠胡');
  if (g.zDiscard > 0) tags.push('打出' + g.zDiscard + '红中');
  console.log(`  ${i + 1}. ${g.name} ${g.how} ${tags.length ? '【' + tags.join(' + ') + '】' : '(平胡)'}`);
});
const cnt = k => games.filter(g => g[k]).length;
console.log(`\n汇总（${games.length} 局）:`);
console.log(`  七对: ${cnt('sevenPairs')} 局（含豪华 ${cnt('deluxeSeven')}）`);
console.log(`  清一色: ${cnt('qingyise')} 局`);
console.log(`  全碰碰胡: ${cnt('allPong')} 局`);
console.log(`  带打出红中: ${games.filter(g => g.zDiscard > 0).length} 局`);
console.log(`  流局（未胡）: ${N_GAMES - games.length} 局`);
console.log('JS报错:', errors.length ? errors.slice(0, 3) : '0 条');
await browser.close();
