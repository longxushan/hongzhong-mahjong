// 2026-11-10 实测：手机竖屏（390×844）拖动教学区时顶部牌桌自适应，无遮挡无重叠
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

// 等进入牌局
await page.waitForFunction(
  () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard',
  null, { timeout: 30000 }
);
// 竖屏教学区默认开启，掷骰面板应已收起
await page.waitForTimeout(800);

// 采集布局：手牌区不越出牌桌、不压中央弃牌区、内容不溢出
const snap = () => page.evaluate(() => {
  const r = el => el ? el.getBoundingClientRect() : null;
  const table = r(document.getElementById('table'));
  const handWrap = r(document.querySelector('#seat0 #handWrap'));
  const hand = document.querySelector('#seat0 #hand');
  const center = r(document.getElementById('center'));
  const dock = r(document.getElementById('bottomDock'));
  return {
    tableH: table ? Math.round(table.height) : 0,
    handVar: getComputedStyle(document.documentElement).getPropertyValue('--hand').trim(),
    handWrapTop: handWrap ? Math.round(handWrap.top) : 0,
    handWrapBottom: handWrap ? Math.round(handWrap.bottom) : 0,
    tableBottom: table ? Math.round(table.bottom) : 0,
    centerBottom: center ? Math.round(center.bottom) : 0,
    handOverflow: hand ? Math.round(hand.scrollHeight - hand.clientHeight) : 0,
    dockH: dock ? Math.round(dock.height) : 0,
  };
});

const check = (s, label) => {
  const issues = [];
  if (s.handWrapBottom > s.tableBottom + 1) issues.push(`手牌区越出牌桌底 ${s.handWrapBottom - s.tableBottom}px`);
  if (s.handWrapTop < s.centerBottom - 1) issues.push(`手牌区上压弃牌区 ${s.centerBottom - s.handWrapTop}px`);
  if (s.handOverflow > 2) issues.push(`手牌内容纵向溢出 ${s.handOverflow}px`);
  console.log(`[${label}] 桌高${s.tableH}px dock${s.dockH}px 牌面${s.handVar} | ${issues.length === 0 ? 'OK 无遮挡无重叠' : 'ISSUES: ' + issues.join('；')}`);
  return issues.length === 0;
};

const results = [];
const s0 = await snap();
results.push(check(s0, '默认贴手牌'));
const base = { handVar: s0.handVar, top: s0.handWrapTop, bottom: s0.handWrapBottom, tableH: s0.tableH };

// 2026-11-13：教学模块改抽屉浮层——拖动目标是 #dockGrip（#hSplitter 竖屏已隐藏）；
// 浮层改高度不挤压牌桌，手牌位置与牌面应始终不变（往下拖收起、往上拖展开）
const drag = async (dy) => {
  const box = await page.locator('#dockGrip').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(cx, cy + (dy * k / 10), { steps: 1 });
  await page.mouse.up();
  await page.waitForTimeout(350); // 等 RAF fit 与渲染稳定
};

await drag(150); const s1 = await snap(); results.push(check(s1, '下拖收起 150px'));
await drag(-200); const s2 = await snap(); results.push(check(s2, '上拖展开 200px'));

// 浮层不挤压牌桌：拖动前后手牌位置与牌面尺寸保持不变
const unchanged = [s1, s2].every(s => s.handVar === base.handVar && s.tableH === base.tableH
  && Math.abs(s.handWrapTop - base.top) <= 1 && Math.abs(s.handWrapBottom - base.bottom) <= 1);
console.log(`\n页面错误: ${pageErrors.length} 条`);

const pass = results.every(Boolean) && pageErrors.length === 0 && unchanged;
console.log(pass ? 'PASS: 教学抽屉拖动不影响牌桌、手牌不越界不重叠' : 'FAIL: 需修复');
await browser.close();
process.exit(pass ? 0 : 1);
