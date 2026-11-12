// 2026-11-11 用户需求实测：掷骰中间头像列表移除——得分直接标四周座位头像旁
// 座位方位（grid：seat3=左、seat1=右）：下方(seat0)分数在头像上面、上方(seat2)在头像下面、左(seat3)在头像右面、右(seat1)在头像左面（均朝牌桌中央）；
// 进局后座位分数清理干净；无遮挡重叠
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
  window.__noCloudExp = 1; window.__noSplitBar = 1; // 禁云钩子：测试跑局数据不得写入真实云端
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
await page.waitForTimeout(800);

const dice = await page.evaluate(() => {
  const r = el => el ? el.getBoundingClientRect() : null;
  const q = s => document.querySelector(s);
  const seatDice = i => r(q('#seat' + i + ' .who .seatDice'));
  const avatar = i => r(q('#seat' + i + ' .who .whoAvatar'));
  const who = i => r(q('#seat' + i + ' .who'));
  return {
    midCardCount: document.querySelectorAll('.diceSeat').length,
    diceCount: document.querySelectorAll('.seatDice').length,
    dicePhase: document.getElementById('table').classList.contains('dicePhase'),
    s0: seatDice(0), a0: avatar(0), w0: who(0),
    s2: seatDice(2), a2: avatar(2), w2: who(2),
    s1: seatDice(1), a1: avatar(1), w1: who(1),
    s3: seatDice(3), a3: avatar(3), w3: who(3),
    note: r(document.getElementById('diceNote')),
    title: r(document.getElementById('diceTitle')),
    stageRow: r(document.querySelector('.diceStageRow')),
    result: r(document.getElementById('diceResult')),
  };
});
const inter = (a, b) => a && b && a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2;

// 方位断言：分数与头像不交叠且方向正确
const pos0 = dice.s0 && dice.a0 && dice.s0.bottom <= dice.a0.top + 2;         // 下：分数在头像上面
const pos2 = dice.s2 && dice.a2 && dice.s2.top >= dice.a2.bottom - 2;         // 上：分数在头像下面
const pos3 = dice.s3 && dice.w3 && dice.s3.left >= dice.w3.right - 4;         // 左座位(seat3)：分数在 .who 右面（朝中央）
const pos1 = dice.s1 && dice.w1 && dice.s1.right <= dice.w1.left + 4;         // 右座位(seat1)：分数在 .who 左面（朝中央）
console.log('中间卡数量 =', dice.midCardCount, '（应 0）| 座位分数元素 =', dice.diceCount, '（应 4）');
console.log('方位：下头像上=' + pos0, '上头像下=' + pos2, '左座位(seat3)头像右=' + pos3, '右座位(seat1)头像左=' + pos1);

// 交叠：中央面板文字/骰子行 vs 座位铭牌
const noteOv = inter(dice.note, dice.w1) || inter(dice.note, dice.w3);
const titleOv = inter(dice.title, dice.w2) || inter(dice.title, dice.w0);
const stageOv = inter(dice.stageRow, dice.w1) || inter(dice.stageRow, dice.w3);
const resultOv = inter(dice.result, dice.w0) || inter(dice.result, dice.w2);
console.log('胶囊 vs 左右铭牌交叠:', noteOv, '| 标题 vs 上下:', titleOv, '| 骰子行 vs 左右:', stageOv, '| 结果 vs 上下:', resultOv);

await page.screenshot({ path: path.join(ROOT, 'scripts', 'dice-phase.png') });

// 等进局，验证座位恢复（分数/角标清理干净）
await page.waitForFunction(
  () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard',
  null, { timeout: 30000 }
);
await page.waitForTimeout(500);
const after = await page.evaluate(() => ({
  dicePhase: document.getElementById('table').classList.contains('dicePhase'),
  seatDiceLeft: document.querySelectorAll('.seatDice').length,
  badgeLeft: document.querySelectorAll('.whoAvatar .dsBadge').length,
  hand14: p(0).hand.length,
}));
console.log('进局后：dicePhase =', after.dicePhase, '| 残留分数 =', after.seatDiceLeft, '| 残留角标 =', after.badgeLeft, '| 手牌', after.hand14, '张');
await page.screenshot({ path: path.join(ROOT, 'scripts', 'game-phase.png') });

console.log('页面错误:', pageErrors.length, '条');
const pass = dice.midCardCount === 0
  && dice.diceCount === 4
  && dice.dicePhase === true
  && pos0 && pos2 && pos1 && pos3
  && !noteOv && !titleOv && !stageOv && !resultOv
  && after.dicePhase === false && after.seatDiceLeft === 0 && after.badgeLeft === 0
  && after.hand14 === 14
  && pageErrors.length === 0;
console.log(pass ? 'PASS: 中间列表已移除、四方位分数正确、进局清理干净' : 'FAIL: 需调整');
await browser.close();
process.exit(pass ? 0 : 1);
