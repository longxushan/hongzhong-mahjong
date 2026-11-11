// 2026-11-11 云端跨设备经验同步验证：两个独立浏览器 context（各自 localStorage=两台设备）
// 设备 A 在应用域名写入经验 → 云端；设备 B 全新打开同域名 → 拉云端，应看到 A 攒的计数
import { chromium } from 'playwright-core';

const URL = 'https://hongzhong-mahjong-61408.app.workbuddy.host/?sharecode=L3V3A4Y345';
function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  return candidates.find(p => fs.existsSync(p));
}
import fs from 'node:fs';

let pass = true;
const chk = (cond, msg) => { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) pass = false; };

const browser = await chromium.launch({ executablePath: findBrowser() });

// ===== 设备 A：全新 context，打开应用域名，写入 3 局经验并上行云端 =====
const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
const pageA = await ctxA.newPage();
pageA.on('pageerror', e => console.log('A pageerror:', e.message));
await pageA.addInitScript(() => {
  HTMLMediaElement.prototype.play = function () { const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 30); return Promise.resolve(); };
});
await pageA.goto(URL, { waitUntil: 'load', timeout: 60000 });
await pageA.click('#startBtn');
await pageA.waitForSelector('#roleSelect.show .roleBtn', { timeout: 20000 });
await pageA.locator('.roleBtn').first().click();
await pageA.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
const aResult = await pageA.evaluate(async () => {
  const out = { cloudReady: !!__cloudDB };
  // 云端拉取完成（merged 与云端一致）——先等 pull
  await new Promise(r => setTimeout(r, 3000));
  const names = G.players.map(pl => pl.name);
  const nm = names[2];
  const mkR = (winner, bigWin) => ({
    pl: winner != null ? { seat: winner, name: names[winner] } : null,
    handTypes: bigWin ? ['七对'] : [],
    fs: bigWin ? [{ n: '七对', v: 2 }] : [],
    d: [0, 1, 2, 3].map(s => ({ seat: s, hu: s === winner ? 1 : 0, pay: 0, gang: 0, net: s === winner ? 36 : -12 })),
  });
  localStorage.removeItem('banshanRoleExpSyncV2');
  for (let i = 0; i < 3; i++) learnFromRound(mkR(2, true));
  // 等上行完成（pending 该角色清零）
  for (let t = 0; t < 40; t++) {
    await new Promise(r => setTimeout(r, 500));
    const s = expSyncState();
    const p = s.pending[nm];
    if (s.merged[nm] && (!p || !p.g)) break;
  }
  const s = expSyncState();
  out.pushed = s.merged[nm] || null;
  out.pendingLeft = s.pending[nm] || null;
  return out;
});
chk(aResult.cloudReady, '设备A：云客户端初始化成功（应用域名 Origin 匹配）');
chk(aResult.pushed && aResult.pushed.g === 3 && aResult.pushed.w === 3, '设备A：3 局经验上行云端（g=' + (aResult.pushed ? aResult.pushed.g : 'null') + '）');
chk(!aResult.pendingLeft || !aResult.pendingLeft.g, '设备A：pending 清空（上行成功）');

// ===== 设备 B：全新 context（不同 localStorage），打开同域名，应拉到 A 攒的经验 =====
const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
const pageB = await ctxB.newPage();
pageB.on('pageerror', e => console.log('B pageerror:', e.message));
await pageB.addInitScript(() => {
  HTMLMediaElement.prototype.play = function () { const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 30); return Promise.resolve(); };
});
await pageB.goto(URL, { waitUntil: 'load', timeout: 60000 });
await pageB.click('#startBtn');
await pageB.waitForSelector('#roleSelect.show .roleBtn', { timeout: 20000 });
await pageB.locator('.roleBtn').first().click();
await pageB.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
const bResult = await pageB.evaluate(async () => {
  const names = G.players.map(pl => pl.name);
  const out = { cloudReady: !!__cloudDB, names };
  // 等 cloudExpPull 完成（最多 20s）
  for (let t = 0; t < 40; t++) {
    await new Promise(r => setTimeout(r, 500));
    const s = expSyncState();
    if (Object.keys(s.merged).length) break;
  }
  const s = expSyncState();
  out.merged = s.merged;
  out.all = loadRoleExp();
  return out;
});
const nmA = (aResult.pushed ? null : null);
chk(bResult.cloudReady, '设备B：云客户端初始化成功');
chk(Object.keys(bResult.merged).length > 0, '设备B：拉到云端经验（角色数 ' + Object.keys(bResult.merged).length + '）');
const winnerRow = Object.entries(bResult.merged).find(([k, v]) => v.g >= 3 && v.w >= 3);
chk(!!winnerRow, '设备B：读到了设备A 玩的局数（' + (winnerRow ? winnerRow[0] + ' g=' + winnerRow[1].g + ' w=' + winnerRow[1].w : '未找到') + '）——跨设备累加成立');
const nmKey = Object.keys(bResult.merged)[0];
const rowB = bResult.merged[nmKey];
chk(bResult.all[nmKey] && bResult.all[nmKey].g === rowB.g, '设备B：生效档案=云端值（决策立即吃到 A 的经验）');

await ctxA.close();
await ctxB.close();
await browser.close();
console.log(pass ? 'PASS: 云端跨设备经验累加验证通过' : 'FAIL: 需调整');
process.exit(pass ? 0 : 1);
