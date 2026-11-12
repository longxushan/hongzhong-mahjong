// 2026-11-11 实测：竖屏手牌区上移 + 打错提醒钉在牌桌底缘空挡（教学模式不动）
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
await page.waitForFunction(
  () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard',
  null, { timeout: 30000 }
);
await page.waitForTimeout(500);

// 开打错提醒并点选一张手牌 → liveWarn 显示
const result = await page.evaluate(() => {
  mistakeWarnOn = true;
  const tile = document.querySelector('#hand .tile-photo');
  if (tile) tile.click();
  return new Promise(r => setTimeout(() => {
    const rect = el => el ? el.getBoundingClientRect() : null;
    const table = rect(document.getElementById('table'));
    const handWrap = rect(document.querySelector('#seat0 #handWrap'));
    const actions = rect(document.querySelector('#seat0 #actions'));
    const warn = rect(document.getElementById('liveWarn'));
    const dock = rect(document.getElementById('bottomDock'));
    const inter = (a, b) => a && b && a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2;
    r({
      handTopPct: handWrap ? +(((handWrap.top - table.top) / table.height) * 100).toFixed(1) : null,
      warnShown: !!warn && warn.height > 10,
      warnBottomGap: warn ? Math.round(table.bottom - warn.bottom) : null,
      gapBetween: warn && actions ? Math.round(warn.top - actions.bottom) : null,
      warnOverlapHand: inter(warn, handWrap) || inter(warn, actions),
      dockTop: dock ? Math.round(dock.top) : null,
      warnText: document.getElementById('liveWarn')?.textContent.slice(0, 24) || '',
      warnFull: document.getElementById('liveWarn')?.textContent || '',
      // 诊断明细
      dbg: {
        tableH: Math.round(table.height),
        handVar: getComputedStyle(document.documentElement).getPropertyValue('--hand').trim(),
        handWrapTop: handWrap ? Math.round(handWrap.top - table.top) : null,
        handWrapH: handWrap ? Math.round(handWrap.height) : null,
        actionsBottom: actions ? Math.round(actions.bottom - table.top) : null,
        warnTop: warn ? Math.round(warn.top - table.top) : null,
        warnH: warn ? Math.round(warn.height) : null,
      },
    });
  }, 300));
});

console.log(`手牌区顶部位置: 牌桌高度的 ${result.handTopPct}%（上移前约 70%，应 ≤62%）`);
console.log('诊断:', JSON.stringify(result.dbg));
console.log(`打错提醒显示: ${result.warnShown}（「${result.warnText}…」）`);
console.log(`提醒距牌桌底缘: ${result.warnBottomGap}px（≤12 为钉底）`);
console.log(`操作行与提醒之间空挡: ${result.gapBetween}px（应 ≥20 空挡存在）`);
console.log(`提醒与手牌/操作行交叠: ${result.warnOverlapHand}（应 false）`);
console.log(`页面错误: ${pageErrors.length} 条`);

const pass = result.handTopPct <= 62
  && result.warnShown === true
  && result.warnBottomGap <= 12
  && result.gapBetween >= 20
  && result.warnOverlapHand === false
  && /雀学米高|郑太顺/.test(result.warnFull) // 2026-11-11：双大师心法已入实时点评
  && pageErrors.length === 0;
console.log(pass ? 'PASS: 手牌上移+提醒钉底空挡' : 'FAIL: 需调整');
await browser.close();
process.exit(pass ? 0 : 1);
