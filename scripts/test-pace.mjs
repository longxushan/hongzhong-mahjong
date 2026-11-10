// 2026-11-10 实测出牌节奏：包装全局 think() 计时，正常模式（非托管）下
// 每次出牌思考应落在 0.3-1.5s（基础 300ms + 语音跟随最多 1200ms）
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

// 静音：play 立即 resolve，且 30ms 后模拟 onended（vpNext 依赖该事件推进队列）
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

// 等进入牌局（首局掷骰自动完成）
await page.waitForFunction(
  () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard',
  null, { timeout: 30000 }
);

const result = await page.evaluate(async () => {
  // 包装 think()：记录每次出牌思考耗时（不改变行为）
  window.__thinkTimes = [];
  const orig = window.think;
  window.think = async function () {
    const t = Date.now();
    const r = await orig.apply(this, arguments);
    window.__thinkTimes.push(Date.now() - t);
    return r;
  };
  // 替玩家操作：轮到玩家出牌时替他打一张（不打红中，避免 confirmZ 弹窗）；
  // 出现碰/杠/胡选择时替他点「过」
  const loop = setInterval(() => {
    try {
      if (!G || G.over || !G.awaiting) return;
      if (G.awaiting === 'discard') {
        const h = p(0).hand;
        const t = [...h].reverse().find(x => x.id !== 'Z');
        if (t) humanRespond(t);
      } else {
        const btns = [...document.querySelectorAll('#actions button')];
        const pass = btns.find(b => /过|不/.test(b.textContent));
        if (pass) pass.click();
      }
    } catch (e) { /* 忽略瞬时状态 */ }
  }, 250);

  await new Promise(r => setTimeout(r, 20000));
  clearInterval(loop);

  const ts = window.__thinkTimes;
  const gaps = ts.map(g => g / 1000);
  const inRange = ts.filter(g => g >= 280 && g <= 1650).length; // ±150ms 调度容差
  return {
    n: ts.length,
    list: gaps.map(g => g.toFixed(2)).join(', '),
    min: ts.length ? Math.min(...ts) / 1000 : 0,
    max: ts.length ? Math.max(...ts) / 1000 : 0,
    avg: ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length / 1000 : 0,
    inRange,
    autoFlag: p(0).auto === true,
  };
});

console.log(`采样 think() 次数: ${result.n}（玩家座位 auto=${result.autoFlag}，走正常 thinkVoiceSync 分支）`);
console.log(`间隔明细(s): ${result.list}`);
console.log(`min=${result.min.toFixed(2)}s  max=${result.max.toFixed(2)}s  avg=${result.avg.toFixed(2)}s`);
console.log(`区间 0.3-1.5s 内(±0.15s 容差): ${result.inRange}/${result.n}`);
const pass = result.n >= 10 && result.inRange === result.n;
console.log(pass ? 'PASS: 出牌节奏 0.3-1.5s 达标' : 'FAIL: 需人工检查');

await browser.close();
process.exit(pass ? 0 : 1);
