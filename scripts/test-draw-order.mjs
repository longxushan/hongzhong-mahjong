// 专项验证：抓牌时序——「上家打牌 → 无人碰/杠 → 我才抓牌」
// 原理：钩子记录 drawTile/discardTile/doPeng/settleMingGang 事件序列，
// 断言每个普通抓牌（非杠补牌）的上一个出牌者必为抓牌者的上家，且两者之间无碰/杠声明。
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
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
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

// 注入事件钩子：包装全局函数
await page.evaluate(() => {
  window.__evts = [];
  const _draw = drawTile;
  drawTile = function (pl, g) { window.__evts.push(['draw', pl.seat, !!g]); return _draw(pl, g); };
  const _disc = discardTile;
  discardTile = function (pl, t) { window.__evts.push(['discard', pl.seat, t.id]); return _disc(pl, t); };
  const _peng = doPeng;
  doPeng = function (pl, id) { window.__evts.push(['peng', pl.seat, id]); return _peng(pl, id); };
  const _mg = settleMingGang;
  settleMingGang = function (a, b, id) { window.__evts.push(['gang', a, id]); return _mg(a, b, id); };
});

// 开托管：AI 全自动连打，收集约 60 个事件
await page.click('#autoBtn');
await page.waitForFunction(
  () => window.__evts && window.__evts.length >= 60,
  null, { timeout: 120000 }
);

const result = await page.evaluate(() => {
  const evts = window.__evts;
  const bad = [];
  // 遍历每个普通抓牌事件（g=false）：检查它之前的最近 discard
  for (let i = 0; i < evts.length; i++) {
    const e = evts[i];
    if (e[0] !== 'draw' || e[2] === true) continue; // 只查普通抓牌（杠补牌除外）
    const seat = e[1];
    // 向前找最近的 discard 事件
    let j = i - 1, disc = null;
    while (j >= 0) {
      if (evts[j][0] === 'discard') { disc = evts[j]; break; }
      j--;
    }
    if (!disc) { bad.push({ i, e, why: '前面无出牌事件(开局发牌)' }); continue; }
    // 两者之间不允许有碰/杠声明发生（碰/杠后走 skipDraw，不该出现普通抓牌）
    for (let k = j + 1; k < i; k++) {
      if (evts[k][0] === 'peng' || evts[k][0] === 'gang') {
        bad.push({ i, e, why: '出牌与抓牌之间出现碰/杠声明：' + evts[k][0] + '@' + evts[k][1] });
      }
    }
    // 最近出牌者必须是抓牌者的上家
    if ((disc[1] + 1) % 4 !== seat) {
      bad.push({ i, e, disc, why: '抓牌者座位' + seat + ' 的上家应是' + ((seat + 3) % 4) + '，实际出牌者是' + disc[1] });
    }
  }
  return { total: evts.length, draws: evts.filter(e => e[0] === 'draw' && !e[2]).length, bad, sample: evts.slice(0, 40) };
});

console.log('事件总数:', result.total, '| 普通抓牌数:', result.draws, '| 违规:', result.bad.length);
if (result.bad.length) {
  console.log('违规明细:');
  result.bad.slice(0, 10).forEach(b => console.log('  #', b.i, b.e, '→', b.why));
} else {
  console.log('✅ 全部普通抓牌均满足：上家打出 → 无碰/杠声明 → 我才抓牌');
}
console.log('样本序列(前40):');
result.sample.forEach(e => console.log('  ', e[0], '座位' + e[1], e[0] === 'draw' ? (e[2] ? '(杠补牌)' : '(普通抓牌)') : e[2]));
console.log('JS报错:', errors.length ? errors : '0 条');
await browser.close();
process.exit(result.bad.length ? 1 : 0);
