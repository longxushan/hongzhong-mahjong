// 2026-11-10 实测：开始流程（开始→选角色→入座掷骰）零 TTS 发声、无杂音源
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

await page.addInitScript(() => {
  window.__noCloudExp = 1; // 禁云钩子：测试跑局数据不得写入真实云端
  HTMLMediaElement.prototype.play = function () {
    const self = this;
    setTimeout(() => { if (typeof self.onended === 'function') self.onended(); }, 30);
    return Promise.resolve();
  };
  // 记录所有 TTS 发声调用（杂音源排查）
  window.__ttsCalls = [];
  if ('speechSynthesis' in window) {
    const orig = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = function (u) { window.__ttsCalls.push(String(u && u.text).slice(0, 20)); return orig(u); };
  }
});

await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
await page.locator('.roleBtn').first().click();

// 等到掷骰浮层出现（开局阶段完成：开始→选角色→入座）
await page.waitForFunction(
  () => document.getElementById('diceOverlay')?.classList.contains('show'),
  null, { timeout: 20000 }
);
await page.waitForTimeout(1500);

const result = await page.evaluate(() => ({
  ttsCalls: window.__ttsCalls,
  ttsAvailable: typeof ttsAvailable !== 'undefined' ? ttsAvailable : 'undef',
}));

console.log('TTS 发声调用:', result.ttsCalls.length === 0 ? '0 次（开始阶段零 TTS 杂音）' : JSON.stringify(result.ttsCalls));
console.log('ttsAvailable =', result.ttsAvailable);
const pass = result.ttsCalls.length === 0;
console.log(pass ? 'PASS: 开始流程无 TTS 杂音' : 'FAIL: 仍有 TTS 发声');

await browser.close();
process.exit(pass ? 0 : 1);
