// 玩家视角专项验证：上家（座位3）打出牌 → 无人碰/杠 → 我（座位0）的牌才出现（drawTile）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');

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
});
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(
  () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard' && p(0).hand.length === 14,
  null, { timeout: 30000 }
);

// 钩子：记录事件序列 + 玩家手牌长度的每次变化时刻
await page.evaluate(() => {
  window.__evts = [];
  const _draw = drawTile;
  drawTile = function (pl, g) {
    const before = p(0).hand.length;
    const r = _draw(pl, g);
    window.__evts.push(['draw', pl.seat, !!g, before, p(0).hand.length]);
    return r;
  };
  const _disc = discardTile;
  discardTile = function (pl, t) { window.__evts.push(['discard', pl.seat, t.id]); return _disc(pl, t); };
  const _peng = doPeng;
  doPeng = function (pl, id) { window.__evts.push(['peng', pl.seat, id]); return _peng(pl, id); };
  const _mg = settleMingGang;
  settleMingGang = function (a, b, id) { window.__evts.push(['gang', a, id]); return _mg(a, b, id); };
  const _ag = doGang;
  doGang = function (a, b, c, d) { window.__evts.push(['selfgang', a.seat, b]); return _ag(a, b, c, d); };
});

await page.click('#autoBtn'); // 开托管全自动连打
await page.waitForFunction(
  () => window.__evts && window.__evts.length >= 80,
  null, { timeout: 180000 }
);

const result = await page.evaluate(() => {
  const evts = window.__evts;
  const meDraws = [];
  const bad = [];
  for (let i = 0; i < evts.length; i++) {
    const e = evts[i];
    if (e[0] !== 'draw' || e[1] !== 0 || e[2] === true) continue; // 玩家座位0的普通抓牌
    meDraws.push(i);
    // 前一个事件必须是上家（座位3）的出牌
    const prev = evts[i - 1];
    if (!prev || prev[0] !== 'discard' || prev[1] !== 3) {
      bad.push({ i, e, prev, why: '玩家抓牌的前一事件不是上家(座位3)的出牌' });
    }
  }
  return {
    total: evts.length,
    meDraws: meDraws.length,
    bad,
    chains: meDraws.slice(0, 12).map(i => ({
      prev: evts[i - 1] ? evts[i - 1][0] + '@座位' + evts[i - 1][1] + ' ' + (evts[i - 1][2] || '') : '无',
      me: 'draw@座位0 手牌 ' + evts[i][3] + '→' + evts[i][4],
    })),
  };
});

console.log('事件总数:', result.total, '| 玩家(座位0)普通抓牌次数:', result.meDraws, '| 违规:', result.bad.length);
if (result.bad.length) {
  result.bad.slice(0, 5).forEach(b => console.log('  ✗ #', b.i, JSON.stringify(b.e), '前一事件:', JSON.stringify(b.prev), b.why));
} else {
  console.log('✅ 玩家每一次抓牌：前一事件 100% 是上家(座位3)的出牌，中间无任何碰/杠');
}
console.log('时序链示例（前12次玩家抓牌）:');
result.chains.forEach((c, i) => console.log('  ' + (i + 1) + '.', c.prev, '→', c.me));
console.log('JS报错:', errors.length ? errors : '0 条');
await browser.close();
process.exit(result.bad.length ? 1 : 0);
