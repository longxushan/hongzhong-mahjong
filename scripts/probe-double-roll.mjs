// 2026-11-10 排查「我来掷」出现两次：跟踪按钮 display 变化次数与触发场景
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
const page = await browser.newPage();

// 静音 + 30ms 后模拟 onended，并大幅缩短 diceAuto 让流程快走
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

// 等 diceOverlay 出现
await page.waitForFunction(
  () => document.getElementById('diceOverlay')?.classList.contains('show'),
  null, { timeout: 20000 }
);

const result = await page.evaluate(async () => {
  // 用 MutationObserver 跟踪 #diceRollBtn 的可见性变化（style.display 属性变化）
  const btn = document.getElementById('diceRollBtn');
  const log = [];
  const obs = new MutationObserver(() => {
    const vis = btn.style.display !== 'none' && btn.offsetParent !== null;
    log.push({ t: Date.now(), display: btn.style.display, visible: vis, note: document.getElementById('diceNote')?.textContent || '' });
  });
  obs.observe(btn, { attributes: true, attributeFilter: ['style'] });

  // 固定骰点：第 1 轮四家全部 6+6=12（平局，含玩家）→ 第 2 轮各不相同
  const seq = [];
  let call = 0;
  const origRandInt = window.randInt;
  window.randInt = function () { call++; return 5; }; // 1+5=6，两颗都 6 → 每家 12 点
  // 观察 12 秒（diceAuto 默认 6s，不点击 → 自动掷）
  await new Promise(r => setTimeout(r, 26000));
  obs.disconnect();

  const visEvents = log.filter(l => l.visible);
  // 去掉连续重复，统计按钮从隐藏→可见的次数
  let shows = 0, lastVis = false;
  for (const l of log) {
    if (l.visible && !lastVis) shows++;
    lastVis = l.visible;
  }
  return { mutations: log.length, shows, visFirst: visEvents[0]?.note, noteNow: document.getElementById('diceNote')?.textContent, diceResult: window._diceResult, eastBadge: !!document.querySelector('.diceSeat.east') };
});

console.log('按钮从隐藏→可见次数:', result.shows, '（平局加掷场景预期 ≥2）');
console.log('首次可见时提示语:', result.visFirst);
console.log('最终提示语:', result.noteNow);
console.log('掷骰结果:', JSON.stringify(result.diceResult));
console.log(result.shows >= 2 ? 'CONFIRMED: 平局加掷会让「我来掷」再次出现' : `按钮显示次数 ${result.shows}，未见复现`);

await browser.close();
