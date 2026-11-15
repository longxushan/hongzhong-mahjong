// 2026-11-15 回归：红中封锁与听牌计算（用户反馈「2只红中时听牌提示没有听牌、且没说原因」）
// 断言：
//  ① 手里≥2红中且未打过红中 → 听牌为空（规则正确封锁）+ 浮层/教学面板给出红中规则原因
//  ② 手里≥2红中但本局已打过红中（摸3打1剩2）→ 规则放行，听牌正常计算
//    （回归 bug：wouldWin 的 fake 丢 discard，导致已打红中仍被误封锁、听牌恒空）
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const EXE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.addInitScript(() => { window.__noCloudExp = 1; window.__noSplitBar = 1;
  HTMLMediaElement.prototype.play = function () { const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20); return Promise.resolve(); }; });
await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
await page.waitForTimeout(400);

let pass = 0, fail = 0;
const chk = (name, ok, info) => { if (ok) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info ? ' — ' + info : '')); } };

const out = await page.evaluate(() => {
  window.__mk = (id, uid) => ({ id, uid, suit: id === 'Z' ? 'Z' : id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) });
  const me = p(0);
  // B123 B456 B789 + W2W2 + 红中×2：红中可配第三张成刻，规则放行时全听
  me.hand = ['B1','B2','B3','B4','B5','B6','B7','B8','B9','W2','W2','Z','Z'].map((x, i) => window.__mk(x, 930000 + i));
  me.melds = [];
  me.discard = [window.__mk('W1', 940000)];
  const A = {
    zBlocked: blockedByZRule(me), tingN: calcTing().length,
    overlay: buildTingHTML(),
    teachReason: (() => { const d = handDiagnose(me); return d.zBlocked; })(),
  };
  me.discard = [window.__mk('Z', 940001)];
  const B = {
    zBlocked: blockedByZRule(me), tingN: calcTing().length,
    winB4: wouldWin(me, 'B4').win, needDiscardZ: !!wouldWin(me, 'B4').needDiscardZ,
  };
  return { A, B };
});

chk('①A 未打红中：规则封锁生效（blockedByZRule=true）', out.A.zBlocked === true, JSON.stringify(out.A));
chk('①A 听牌为空（按规则不能胡，非 bug）', out.A.tingN === 0, 'tingN=' + out.A.tingN);
chk('①A 听牌浮层给出红中规则原因', out.A.overlay.includes('红中规则') && out.A.overlay.includes('先打出一只红中'), out.A.overlay.slice(0, 120));
chk('①A 牌型诊断同步标记 zBlocked', out.A.teachReason === true);
chk('②B 已打红中：规则放行（blockedByZRule=false）', out.B.zBlocked === false);
chk('②B 听牌恢复正常计算（全听 28 种）', out.B.tingN === 28, 'tingN=' + out.B.tingN);
chk('②B wouldWin 带 discard（摸B4 可胡、不再误报 needDiscardZ）', out.B.winB4 === true && out.B.needDiscardZ === false, JSON.stringify(out.B));

chk('运行期零 JS 报错', errs.length === 0, errs.join(';'));
await browser.close();
console.log('红中封锁与听牌计算专项：' + pass + '/' + (pass + fail) + ' 通过');
process.exit(fail ? 1 : 0);
