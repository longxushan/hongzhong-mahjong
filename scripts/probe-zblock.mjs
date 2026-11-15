// 临时探针：复现「手里2只红中时听牌提示为空」——区分规则正确封锁与 wouldWin 丢 discard 的误封锁
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
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.addInitScript(() => { window.__noCloudExp = 1; window.__noSplitBar = 1;
  HTMLMediaElement.prototype.play = function () { const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20); return Promise.resolve(); }; });
await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
await page.waitForTimeout(400);

const out = await page.evaluate(() => {
  window.__mk = (id, uid) => ({ id, uid, suit: id === 'Z' ? 'Z' : id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) });
  const me = p(0);
  const mkHand = ids => ids.map((x, i) => window.__mk(x, 930000 + i));
  // 手牌：二万二万三万 + 一条一条 + 五筒五筒 + 红中红中 = 8... 凑 13 张：2万2万3万 1条1条 5筒5筒 + 红中×2 + 9条 + 4筒 = 12...
  // 简单可靠：清一色筒听牌型基础 + 2 红中：1筒2筒3筒 4筒5筒(待) ... 直接用「2万3万+搭子+红中×2」不必真听，只要验证封锁逻辑
  // 手牌：B123 B456 B789 + W2W2 对 + 红中×2 —— 摸任意牌（红中可配第三张成刻）即胡，真·全听
  me.hand = mkHand(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'W2', 'W2', 'Z', 'Z']);
  me.melds = []; me.discard = [window.__mk('W1', 940000)];
  const a = {
    zBlocked: blockedByZRule(me),
    tingN: calcTing().length,
    shanten: (() => { try { return calcShanten(me.hand, me.melds); } catch (e) { return 'err'; } })(),
    wouldWinB4: (() => { const f = wouldWin(me, 'B4'); return { win: f.win, needDiscardZ: !!f.needDiscardZ }; })(),
  };
  // 手B：同样手牌但 discard 里已打过红中（摸3打1剩2场景；规则应放行 → 全听；wouldWin 若丢 discard 会误封锁）
  me.discard = [window.__mk('Z', 940001)];
  const b = {
    zBlocked: blockedByZRule(me),
    tingN: calcTing().length,
    wouldWinB4: (() => { const f = wouldWin(me, 'B4'); return { win: f.win, needDiscardZ: !!f.needDiscardZ }; })(),
  };
  // 提示文案：A 场景听牌浮层应给出红中规则原因
  me.discard = [window.__mk('W1', 940000)];
  const htmlTxt = buildTingHTML();
  return { A_未打红中: a, B_已打红中: b, A_浮层文案含红中规则: htmlTxt.includes('红中规则') && htmlTxt.includes('先打出一只红中'), A_浮层文案: htmlTxt.slice(0, 160) };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
