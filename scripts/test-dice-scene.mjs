// 2026-11-10 实测：掷骰阶段中间四卡缩小、四周座位铭牌放大、无遮挡重叠；进局后恢复正常
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
const browser = await chromium.launch({ executablePath: findBrowser() });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

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

// 等掷骰浮层出现
await page.waitForFunction(
  () => document.getElementById('diceOverlay')?.classList.contains('show'),
  null, { timeout: 20000 }
);
await page.waitForTimeout(800); // 等定东第一轮起滚

const dice = await page.evaluate(() => {
  const r = el => el ? el.getBoundingClientRect() : null;
  const q = s => document.querySelector(s);
  const av = s => { const el = q(s); return el ? Math.round(el.getBoundingClientRect().width) : 0; };
  return {
    diceAvatar: av('.diceSeat img'),
    seat2Avatar: av('#seat2 .whoAvatar'),
    seat0Avatar: av('#seat0 .whoAvatar'),
    seat1Avatar: av('#seat1 .whoAvatar'),
    seat3Avatar: av('#seat3 .whoAvatar'),
    dicePhase: document.getElementById('table').classList.contains('dicePhase'),
    // 交叠检测：掷骰卡行 vs 左右座位铭牌；标题/结果 vs 上下铭牌
    seatsRow: r(document.querySelector('.diceSeats')),
    seat1Who: r(document.querySelector('#seat1 .who')),
    seat3Who: r(document.querySelector('#seat3 .who')),
    note: r(document.getElementById('diceNote')),
    title: r(document.getElementById('diceTitle')),
    stageRow: r(document.querySelector('.diceStageRow')),
    result: r(document.getElementById('diceResult')),
    seat2Who: r(document.querySelector('#seat2 .who')),
    seat0Who: r(document.querySelector('#seat0 .who')),
    seatsRowH: Math.round(document.querySelector('.diceSeats').getBoundingClientRect().height),
    cardCount: document.querySelectorAll('.diceSeat').length,
  };
});
const inter = (a, b) => a && b && a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2;

console.log('掷骰阶段：中间卡头像', dice.diceAvatar, 'px | 四周：上', dice.seat2Avatar, '下', dice.seat0Avatar, '左', dice.seat1Avatar, '右', dice.seat3Avatar, 'px');
console.log('dicePhase 类 =', dice.dicePhase);
const overlapSeat1 = inter(dice.seatsRow, dice.seat1Who), overlapSeat3 = inter(dice.seatsRow, dice.seat3Who);
const noteOverlap1 = inter(dice.note, dice.seat1Who), noteOverlap3 = inter(dice.note, dice.seat3Who);
const titleOverlap = inter(dice.title, dice.seat2Who) || inter(dice.title, dice.seat0Who);
const resultOverlap = inter(dice.result, dice.seat0Who) || inter(dice.result, dice.seat2Who);
const stageOverlap = inter(dice.stageRow, dice.seat1Who) || inter(dice.stageRow, dice.seat3Who);
console.log('掷骰卡行 vs 左右铭牌交叠:', overlapSeat1 || overlapSeat3, '| 文字胶囊 vs 左右铭牌交叠:', noteOverlap1 || noteOverlap3);
console.log('标题 vs 上下铭牌交叠:', titleOverlap, '| 骰子行 vs 左右铭牌交叠:', stageOverlap, '| 结果 vs 上下铭牌交叠:', resultOverlap);
console.log('掷骰卡行高度', dice.seatsRowH, 'px（≤70 为一行四张）| 卡片数', dice.cardCount);

await page.screenshot({ path: path.join(ROOT, 'scripts', 'dice-phase.png') });

// 等进局（1s 停留 + 发牌），验证恢复正常座位
await page.waitForFunction(
  () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard',
  null, { timeout: 30000 }
);
await page.waitForTimeout(500);
const after = await page.evaluate(() => ({
  dicePhase: document.getElementById('table').classList.contains('dicePhase'),
  seat2Avatar: Math.round(document.querySelector('#seat2 .whoAvatar').getBoundingClientRect().width),
  hand14: p(0).hand.length,
}));
console.log('进局后：dicePhase =', after.dicePhase, '| 座位头像恢复', after.seat2Avatar, 'px | 手牌', after.hand14, '张');
await page.screenshot({ path: path.join(ROOT, 'scripts', 'game-phase.png') });

console.log('页面错误:', pageErrors.length, '条');
const pass = dice.diceAvatar <= 28
  && dice.seat2Avatar >= 50 && dice.seat0Avatar >= 50
  && dice.dicePhase === true
  && !overlapSeat1 && !overlapSeat3
  && !titleOverlap && !stageOverlap && !resultOverlap
  && dice.seatsRowH <= 70 && dice.cardCount === 4
  && after.dicePhase === false && after.hand14 === 14
  && pageErrors.length === 0;
console.log(pass ? 'PASS: 中间缩小四周放大、无遮挡、进局恢复' : 'FAIL: 需调整');
await browser.close();
process.exit(pass ? 0 : 1);
