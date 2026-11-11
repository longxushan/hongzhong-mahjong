// 2026-11-11 AI 角色牌技升级（雀学米高技巧层）实测：
// ①静态：QXMG_LEVEL 七风格修炼等级 + CHAT_SAY.masterqx 七风格大师心法台词
// ②函数：qxmgDeadMeldN 死搭计数（手工局面：死卡张/活卡张/两面搭口径正确）
// ③行为：等向听局面（死搭 T2T4 vs 活搭 B6B8）masterDiscard 应优先拆死搭腿（止损要早）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');

function findBrowser() {
  if (process.env.BROWSER_PATH && fs.existsSync(process.env.BROWSER_PATH)) return process.env.BROWSER_PATH;
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/local/bin/chromium',
  ];
  return candidates.find(p => fs.existsSync(p));
}

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('缺少 playwright-core，请先执行 npm install');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: findBrowser() });
const page = await browser.newPage();

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

const result = await page.evaluate(() => {
  const out = {};
  // ① 静态断言
  out.levelKeys = Object.keys(QXMG_LEVEL).sort().join(',');
  out.levelOK = ['academic','aggressive','conservative','flexible','grand','learning','steady']
    .every(k => typeof QXMG_LEVEL[k] === 'number' && QXMG_LEVEL[k] > 0 && QXMG_LEVEL[k] <= 1);
  out.learningLtGrand = QXMG_LEVEL.learning < QXMG_LEVEL.grand; // 成长线：学习型 < 豪腕型
  out.chatStyles = Object.keys(CHAT_SAY).filter(s => CHAT_SAY[s].masterqx && CHAT_SAY[s].masterqx.length >= 2).length;
  const fns = ['qxmgDeadMeldN', 'ztsKeepBonus', 'ztsDanger', 'ztsClaimGate'];
  out.fnsOK = fns.every(f => typeof window[f] === 'function');

  // ② 函数级：构造三张牌的迷你局面，直接验证死搭口径
  const mk = (id, i) => ({ id, uid: 910000 + i, suit: id[0], rank: parseInt(id[1], 10) });
  // 把牌墙 T3 扣到 ≤1 张（死卡张判据）、B7 补足 ≥3 张（活卡张判据，防随机局被各家摸走）；记录以便恢复
  const mutated = [];
  let t3 = 0;
  for (let i = G.head; i <= G.tail; i++) if (G.wall[i].id === 'T3') t3++;
  for (let i = G.head; i <= G.tail && t3 > 1; i++) {
    if (G.wall[i].id === 'T3') { mutated.push([i, 'T3']); G.wall[i].id = 'W9'; t3--; }
  }
  let b7 = 0;
  for (let i = G.head; i <= G.tail; i++) if (G.wall[i].id === 'B7') b7++;
  for (let i = G.head; i <= G.tail && b7 < 3; i++) {
    if (G.wall[i].id !== 'B7' && G.wall[i].id !== 'T3') { mutated.push([i, G.wall[i].id]); G.wall[i].id = 'B7'; b7++; }
  }
  const t3Left = tileRemaining('T3');
  const b7Left = tileRemaining('B7');
  out.t3Left = t3Left; out.b7Left = b7Left;
  // 死卡张 T2T4（进张 T3 存量 ≤1）应计 1
  out.deadGap = qxmgDeadMeldN([mk('T2', 1), mk('T4', 2)]);
  // 活卡张 B6B8（进张 B7 存量 >1）应计 0
  out.liveGap = qxmgDeadMeldN([mk('B6', 1), mk('B8', 2)]);
  // 死两面 W1W2：进张只有 W3（W0 不存在）→ 若 W3 存量 ≤1 也算死搭（口径正确性交给存量）
  out.twoSideType = typeof qxmgDeadMeldN([mk('W1', 1), mk('W2', 2)]) === 'number';

  // ③ 行为级：给 AI（座位 1）重造等向听局面——3 面子 + 死搭 T2T4 + 活搭 B6B8
  const pl = p(1);
  const keep = { hand: pl.hand.slice(), melds: pl.melds.slice(), plan: pl._plan, human: pl.human };
  pl.hand = ['W1','W2','W3','T7','T8','T9','B1','B2','B3','T2','T4','B6','B8']
    .map((id, i) => mk(id, i));
  pl.melds = []; pl._plan = null; pl.human = true; // human=true 只为跳过宣言副作用，决策逻辑一致
  const picks = [];
  for (let k = 0; k < 8; k++) { // 多次采样防噪声
    const t = masterDiscard(pl);
    picks.push(t ? t.id : null);
  }
  pl.hand = keep.hand; pl.melds = keep.melds; pl._plan = keep.plan; pl.human = keep.human; // 恢复
  out.picks = picks.join(',');
  out.deadPicks = picks.filter(id => id === 'T2' || id === 'T4').length; // 拆死搭腿
  out.livePicks = picks.filter(id => id === 'B6' || id === 'B8').length; // 误拆活搭腿
  // 恢复被篡改的牌墙
  for (const [i, id] of mutated) G.wall[i].id = id;
  return out;
});

console.log(`① 修炼等级七风格: ${result.levelKeys} 有效=${result.levelOK} 学习型<豪腕型=${result.learningLtGrand}`);
console.log(`① masterqx 台词风格数: ${result.chatStyles}/7  函数齐备=${result.fnsOK}`);
console.log(`② T3 剩余=${result.t3Left}(≤1 为死) B7 剩余=${result.b7Left}(>1 为活)`);
console.log(`② 死卡张计数=${result.deadGap}(应1)  活卡张计数=${result.liveGap}(应0)  两面口径=${result.twoSideType}`);
console.log(`③ 8 次采样出牌: ${result.picks}`);
console.log(`③ 拆死搭腿=${result.deadPicks}/8  误拆活搭腿=${result.livePicks}/8`);

let pass = true;
if (!result.levelOK || !result.learningLtGrand) { pass = false; console.log('FAIL: 修炼等级表不完整'); }
if (result.chatStyles !== 7) { pass = false; console.log('FAIL: masterqx 台词未覆盖七风格'); }
if (!result.fnsOK) { pass = false; console.log('FAIL: 技巧层函数缺失'); }
if (result.t3Left > 1) { pass = false; console.log('FAIL: 牌墙篡改未生效，死搭条件不成立'); }
if (result.deadGap !== 1 || result.liveGap !== 0) { pass = false; console.log('FAIL: qxmgDeadMeldN 死搭口径错误'); }
if (result.deadPicks < 6 || result.livePicks > 2) { pass = false; console.log('FAIL: AI 未优先拆死搭（止损要早）'); }
console.log(pass ? 'PASS: AI 牌技升级（雀学米高技巧层）行为达标' : 'FAIL: 需人工检查');

await browser.close();
process.exit(pass ? 0 : 1);
