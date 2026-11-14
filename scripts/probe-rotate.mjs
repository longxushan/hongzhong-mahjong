// 探针：①旋转设备自动跟随（原有能力回归）②手动横屏（2026-11-14 竖屏锁定兜底）
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
  ];
  return candidates.find(p => fs.existsSync(p));
}

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: findBrowser() });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1; window.__noSplitBar = 1;
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
  null, { timeout: 60000 }
);

const snap = (label) => page.evaluate(label => {
  const aw = document.getElementById('appWrap');
  const stage = document.getElementById('stage');
  const dock = document.getElementById('bottomDock');
  const hand = document.getElementById('hand');
  const sp = document.getElementById('hSplitter');
  const grip = document.getElementById('dockGrip');
  const hr = hand ? hand.getBoundingClientRect() : null;
  const first = hand ? hand.querySelector('.tile-photo') : null;
  const rows = hand ? [...hand.querySelectorAll('.tile-photo')].map(t => Math.round(t.getBoundingClientRect().top / 40)) : [];
  const rowSpan = rows.length ? (Math.max(...rows) - Math.min(...rows)) : null;
  return {
    label,
    vp: innerWidth + 'x' + innerHeight,
    rot: aw.classList.contains('rot'),
    awW: Math.round(aw.getBoundingClientRect().width),
    awH: Math.round(aw.getBoundingClientRect().height),
    pport: stage.classList.contains('pport'),
    dockShown: dock ? dock.style.display : null,
    dockPos: dock ? getComputedStyle(dock).position : null,
    splitterShown: sp ? getComputedStyle(sp).display : null,
    gripShown: grip ? getComputedStyle(grip).display : null,
    handTileW: first ? Math.round(first.getBoundingClientRect().width) : null,
    handRowSpan: rowSpan, // 0=单行（横屏口径），>0=多行 wrap
    handTiles: hand ? hand.querySelectorAll('.tile-photo').length : 0,
    rotBtnText: (document.getElementById('rotBtn') || {}).textContent,
    overflowX: document.documentElement.scrollWidth > innerWidth + 2,
  };
}, label);

const out = [];
out.push(await snap('A: 手机竖屏基线'));

// B: 点「横屏」按钮 → 模拟横屏（视口仍竖=系统竖屏锁定场景）
await page.click('#rotBtn');
await page.waitForTimeout(600);
out.push(await snap('B: 竖屏锁定+手动横屏'));

// C: rot 模式下手牌拖动换算验证（鼠标拖动：先移 8px 激活，拖到另一张牌位置松手）
const dragOk = await page.evaluate(async () => {
  const hand = document.getElementById('hand');
  const tiles = [...hand.querySelectorAll('.tile-photo')];
  if (tiles.length < 4) return { skip: true };
  const before = tiles.map(t => t.dataset.uid).join(',');
  const t0 = tiles[0].getBoundingClientRect();       // 屏幕系视觉位置（已旋转）
  const t3 = tiles[3].getBoundingClientRect();
  const mk = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, target: null, isTrusted: true });
  const fire = (el, type, ev) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...ev }));
  // pointerdown 依赖 e.target.closest —— 直接构造在 tile 上
  fire(tiles[0], 'pointerdown', { clientX: t0.left + 5, clientY: t0.top + 5, pointerId: 1, button: 0, pointerType: 'mouse' });
  await new Promise(r => setTimeout(r, 40));
  fire(document, 'pointermove', mk(t0.left + 20, t0.top + 5)); // 超 6px 激活
  await new Promise(r => setTimeout(r, 30));
  // 拖到第 4 张牌的屏幕位置（沿手牌排列的屏幕轴向）
  const mid = t3.left + t3.width / 2, midY = t3.top + t3.height / 2;
  fire(document, 'pointermove', mk(mid, midY));
  await new Promise(r => setTimeout(r, 30));
  fire(document, 'pointerup', mk(mid, midY));
  await new Promise(r => setTimeout(r, 60));
  const after = [...hand.querySelectorAll('.tile-photo')].map(t => t.dataset.uid).join(',');
  return { before, after, changed: before !== after, skip: false };
});
out.push({ label: 'C: rot 模式手牌拖动换算', ...dragOk });

// D: 点「竖屏」按钮 → 恢复竖屏
await page.click('#rotBtn');
await page.waitForTimeout(600);
out.push(await snap('D: 手动回竖屏'));

// E: rot 模式下视口真变横（用户解锁旋转转横/安卓 lock 成功）→ 自动撤 rot 走原生横屏
await page.click('#rotBtn');
await page.waitForTimeout(400);
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(700);
out.push(await snap('E: rot 中视口变横→自动撤'));

// F: 回竖屏收尾
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
out.push(await snap('F: 回竖屏'));

console.log(JSON.stringify(out, null, 2));
console.log('pageErrors:', errors.length, errors.slice(0, 5));
await browser.close();
