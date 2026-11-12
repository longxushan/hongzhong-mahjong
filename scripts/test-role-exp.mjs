// 2026-11-11 角色经验学习系统回归测试（V2：计数器 + 派生 + 云同步 pending 机制）
// 断言：①学习只累计数器且方向正确（赢大牌→bw、流局→lj、打红中赢→dw、输→lp）
//       ②派生参数方向与边界（bw↑→prAdj↑、g>30→nsMul<1、胜率过半→qxAdj>0）
//       ③pending/merged 合并无重复计数 ④V1 档案迁移 ⑤真实跑局学习发生、零报错
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
  window.__noCloudExp = 1; window.__noSplitBar = 1; // 禁云钩子：测试数据不得写入真实云端
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

// ===== ① 计数器方向测试（构造结算 r，直接调 learnFromRound；云不可达时 pending 保留） =====
const dir = await page.evaluate(() => {
  const names = G.players.map(pl => pl.name);
  const mkR = (winner, bigWin, dumpZ) => ({
    pl: winner != null ? { seat: winner, name: names[winner] } : null,
    handTypes: bigWin ? ['七对'] : [],
    fs: bigWin ? [{ n: '七对', v: 2 }] : dumpZ ? [{ n: '打出1只红中', v: 2 }] : [],
    d: [0, 1, 2, 3].map(s => ({ seat: s, hu: s === winner ? 1 : 0, pay: s === winner ? 0 : -12, gang: 0, net: s === winner ? 36 : -12 })),
  });
  localStorage.removeItem('banshanRoleExpSyncV2');
  localStorage.removeItem('banshanRoleExpV1');
  const nm1 = names[1], nm2 = names[2];
  for (let i = 0; i < 5; i++) learnFromRound(mkR(1, true, false));   // 席位1 赢大牌 5 局
  const afterBig = getRoleExp(nm1);
  for (let i = 0; i < 3; i++) learnFromRound(mkR(null, false, false)); // 流局 3 局
  const afterLj = getRoleExp(nm1);
  for (let i = 0; i < 4; i++) learnFromRound(mkR(2, false, true));   // 席位2 打红中赢 4 局
  const afterDump = getRoleExp(nm2);
  for (let i = 0; i < 6; i++) learnFromRound(mkR(0, false, false));  // 席位2 连输 6 局
  const afterLoss = getRoleExp(nm2);
  // 派生
  const dBig = deriveExpAdj(afterBig), dLj = deriveExpAdj(afterLj);
  const dDump = deriveExpAdj(afterDump), dLoss = deriveExpAdj(afterLoss);
  // 8 局胜率 8/8 → qxAdj>0
  localStorage.removeItem('banshanRoleExpSyncV2');
  for (let i = 0; i < 8; i++) learnFromRound(mkR(0, false, false));
  const afterQx = deriveExpAdj(getRoleExp(names[0]));
  // 45 局胜率>50% → nsMul<1
  localStorage.removeItem('banshanRoleExpSyncV2');
  for (let i = 0; i < 45; i++) learnFromRound(mkR(0, false, false));
  const afterNs = deriveExpAdj(getRoleExp(names[0]));
  // pending/merged 合并：手动把 pending 并入 merged 再看总数
  localStorage.removeItem('banshanRoleExpSyncV2');
  for (let i = 0; i < 4; i++) learnFromRound(mkR(1, false, false));
  const s0 = expSyncState();
  const mergedIn = { ...s0.pending };
  const s1 = expSyncState(); s1.merged = { ...mergedIn }; s1.pending = {}; expSaveSync(s1);
  const totalAfter = getRoleExp(names[1]);
  // V1 迁移
  localStorage.removeItem('banshanRoleExpSyncV2');
  localStorage.setItem('banshanRoleExpV1', JSON.stringify({ foo: { g: 10, w: 3, lp: 5, bw: 2, dw: 1, lj: 4, prAdj: 0.05, dzAdj: 0, qxAdj: 0, nsMul: 0.9 } }));
  const migrated = getRoleExp('foo');
  const v1Removed = localStorage.getItem('banshanRoleExpV1') == null;
  // expParams
  const params = expParams(G.players[1]);
  const baseQx = QXMG_LEVEL[styleOfName(names[1])];
  return { afterBig, afterLj, afterDump, afterLoss, dBig, dLj, dDump, dLoss, afterQx, afterNs, totalAfter, migrated, v1Removed, params, baseQx, names };
});

chk(dir.afterBig.g === 5 && dir.afterBig.w === 5 && dir.afterBig.bw === 5, '①赢大牌 5 局 → g/w/bw 计数=5/5/5');
chk(dir.afterLj.lj === 3 && dir.afterLj.g === 8, '①流局 3 局 → lj=3 累计 g=8');
chk(dir.afterDump.dw === 4 && dir.afterDump.g === 12, '①打红中赢 4 局 → dw=4（前置 8 局输+流局累计 g=12）');
chk(dir.afterLoss.lp === 14 && dir.afterLoss.g === 18, '①连输 6 局 → lp=14（含前置输 5+流局 3）、g=18');
chk(dir.dBig.prAdj > 0 && dir.dLj.prAdj < dir.dBig.prAdj, '②派生：大牌尝试率修正 随 bw↑ / 随 lj↓（' + dir.dBig.prAdj.toFixed(2) + '→' + dir.dLj.prAdj.toFixed(2) + '）');
chk(dir.dDump.dzAdj > 0 && dir.dLoss.dzAdj < dir.dDump.dzAdj, '②派生：冒险率修正 随 dw↑ / 随 lp↓');
chk(dir.afterQx.qxAdj > 0, '②派生：胜率 8/8 → 修炼修正 +' + dir.afterQx.qxAdj.toFixed(2));
chk(dir.afterNs.nsMul < 1, '②派生：45 局 → 熟练度倍率 ' + dir.afterNs.nsMul.toFixed(2) + ' <1（越打越稳）');
chk(dir.params.qxLv <= 1 && dir.params.qxLv >= Math.min(dir.baseQx, 0.5) && dir.params.planRate >= 0.05 && dir.params.dumpZRate >= 0, '②expParams 边界钳制有效');
chk(dir.totalAfter.g === 4, '③pending 并入 merged 后总数不变不重（g=4）');
chk(dir.migrated.g === 10 && dir.migrated.bw === 2 && dir.v1Removed, '④V1 档案一次性迁移（计数并入、旧键删除）');

// ===== ⑤ 真实跑局 4 局：pending 增长、零报错 =====
await page.evaluate(() => {
  localStorage.removeItem('banshanRoleExpSyncV2');
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
await page.waitForFunction(
  () => { try { const s = JSON.parse(localStorage.getItem('banshanRoleExpSyncV2') || '{}'); let g = 0; for (const k in (s.pending || {})) g += s.pending[k].g; return g >= 16; } catch (e) { return false; } },
  null, { timeout: 90000 }
);
chk(pageErrors.length === 0, '⑤真实跑局学习零 JS 报错（含云同步静默失败路径）');

console.log(pass ? 'PASS: 经验学习 V2（计数器+派生+pending 合并+V1 迁移）全过' : 'FAIL: 需调整');
await browser.close();
process.exit(pass ? 0 : 1);
