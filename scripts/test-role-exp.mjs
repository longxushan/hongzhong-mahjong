// 2026-11-11 角色经验学习系统回归测试
// 断言：①学习方向正确（赢大牌→更敢做、流局→更收敛、打红中赢→更敢冒险、输→收敛）
//       ②参数边界钳制 ③档案持久化 ④真实跑局学习发生且零报错 ⑤修炼等级晋升
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
await page.waitForFunction(
  () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard',
  null, { timeout: 30000 }
);

let pass = true;
const chk = (cond, msg) => { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) pass = false; };

// ===== ① 学习方向测试（构造结算结果 r，直接调 learnFromRound） =====
const dir = await page.evaluate(() => {
  const names = G.players.map(pl => pl.name);
  const mkR = (winner, bigWin, dumpZ, netOverride) => ({
    pl: winner != null ? { seat: winner, name: names[winner] } : null,
    handTypes: bigWin ? ['七对'] : [],
    fs: bigWin ? [{ n: '七对', v: 2 }] : dumpZ ? [{ n: '打出1只红中', v: 2 }] : [],
    d: [0, 1, 2, 3].map(s => ({ seat: s, hu: s === winner ? 1 : 0, pay: s === winner ? 0 : -12, gang: 0, net: s === winner ? 36 : -12 })),
  });
  const out = {};
  // 清档案
  localStorage.removeItem('banshanRoleExpV1');
  const nm1 = names[1], nm2 = names[2];
  // 赢大牌 5 局
  for (let i = 0; i < 5; i++) learnFromRound(mkR(1, true, false));
  out.afterBigWins = getRoleExp(nm1);
  // 流局 5 局
  for (let i = 0; i < 5; i++) learnFromRound(mkR(null, false, false));
  out.afterLiuju = getRoleExp(nm1);
  // 打红中赢 4 局（席位2）
  for (let i = 0; i < 4; i++) learnFromRound(mkR(2, false, true));
  out.afterDumpWin = getRoleExp(nm2);
  // 席位2 连输 10 局（不含 dump）
  for (let i = 0; i < 10; i++) learnFromRound(mkR(0, false, false));
  out.afterLoss = getRoleExp(nm2);
  // 8 的倍数局：胜率>0.5 → qxAdj +0.02（席位0 连赢 8 局）
  localStorage.removeItem('banshanRoleExpV1');
  for (let i = 0; i < 8; i++) learnFromRound(mkR(0, false, false));
  out.afterQx = getRoleExp(names[0]);
  // 持久化
  out.persisted = JSON.parse(localStorage.getItem('banshanRoleExpV1'));
  // expParams 边界
  const p0 = G.players[0];
  out.params = expParams(p0);
  out.qxPct = qxCarePct(names[0]);
  out.baseQx = QXMG_LEVEL[styleOfName(names[0])];
  return out;
});

chk(dir.afterBigWins.bw === 5 && dir.afterBigWins.prAdj > 0, '①赢大牌 5 局 → 大牌数+5、大牌尝试率修正上升（+' + dir.afterBigWins.prAdj.toFixed(2) + '）');
chk(dir.afterLiuju.prAdj < dir.afterBigWins.prAdj, '①流局 5 局 → 尝试率修正回落（' + dir.afterLiuju.prAdj.toFixed(2) + '）');
chk(dir.afterDumpWin.dzAdj > 0, '①打红中赢 4 局 → 冒险率修正上升（+' + dir.afterDumpWin.dzAdj.toFixed(2) + '）');
chk(dir.afterLoss.dzAdj < dir.afterDumpWin.dzAdj, '①连输 10 局 → 冒险率修正收敛（' + dir.afterLoss.dzAdj.toFixed(2) + '）');
chk(dir.afterQx.g === 8 && dir.afterQx.w === 8 && dir.afterQx.qxAdj > 0, '①胜率 8/8 → 修炼等级修正晋升（+' + dir.afterQx.qxAdj.toFixed(2) + '）');
chk(dir.persisted && dir.persisted[dir.afterQx ? Object.keys(dir.persisted)[0] : ''] != null, '②档案持久化到 localStorage');
chk(dir.params.planRate >= 0.05 && dir.params.planRate <= 0.9 && dir.params.dumpZRate >= 0 && dir.params.dumpZRate <= 1, '②参数边界钳制有效');
chk(dir.params.qxLv <= 1 && dir.params.qxLv >= 0.5, '②修炼等级上限 1.0、下限 0.5 内');
chk(dir.qxPct >= 50 && dir.qxPct <= 100, '⑤修炼等级展示 ' + dir.qxPct + '%（基础 ' + Math.round(dir.baseQx * 100) + '%）');

// ===== ③ 真实跑局：托管连打 4 局，档案累计、零报错 =====
await page.evaluate(() => {
  const origST = window.setTimeout.bind(window);
  window.setTimeout = function (fn, ms) {
    if (arguments.length <= 2) return origST(fn, Math.min(ms == null ? 0 : ms, 25));
    const rest = Array.prototype.slice.call(arguments, 2);
    return origST(fn, Math.min(ms == null ? 0 : ms, 25), ...rest);
  };
  try { soundOn = false; } catch (e) { }
  try { const btn = [...document.querySelectorAll('button')].find(b => /音乐/.test(b.textContent || '')); if (btn && /开/.test(btn.textContent)) btn.click(); } catch (e) { }
  setInterval(() => { try { const b = document.querySelector('#mNext'); if (b) b.click(); } catch (e) { } }, 150);
  if (!humanAuto) document.getElementById('autoBtn').click();
});
await page.evaluate(() => { localStorage.removeItem('banshanRoleExpV1'); window.__n = 0; });
await page.waitForFunction(
  () => { try { const x = JSON.parse(localStorage.getItem('banshanRoleExpV1') || '{}'); let g = 0; for (const k in x) g += x[k].g; return g >= 16; } catch (e) { return false; } },
  null, { timeout: 90000 }
);
const live = await page.evaluate(() => {
  const x = JSON.parse(localStorage.getItem('banshanRoleExpV1') || '{}');
  return { roles: Object.keys(x).length, totalG: Object.values(x).reduce((s, e) => s + e.g, 0) };
});
chk(live.roles === 4 && live.totalG >= 16, '③真实跑局学习发生：4 角色共 ' + live.totalG + ' 局经验入档');
chk(pageErrors.length === 0, '③学习系统运行零 JS 报错');

console.log(pass ? 'PASS: 角色经验学习系统方向正确、边界有效、持久化、实战跑通' : 'FAIL: 需调整');
await browser.close();
process.exit(pass ? 0 : 1);
