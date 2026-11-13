// 2026-11-13 用户需求专项：① 去掉一个音乐开关（音效/语音/背景音乐统一由「声音」控制）并检查逻辑错误
// ② 出牌按钮移到我的头像右侧、头像左侧新增「听」按钮，点击列出我胡哪些牌 ③ 底部教学模块再往上提。
// 断言：源码口径、音频状态同步、按钮几何、听牌浮层（含绝张/未听牌）、出牌链路、dock 高度、组合零裁切。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const HTML = fs.readFileSync(FILE, 'utf8');
const EXE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));

const results = [];
const chk = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

// ① 源码口径
chk('源码：顶栏只剩一个音频开关', HTML.includes('<button id="soundBtn">') && !/<button id="bgmBtn"/.test(HTML));
chk('源码：旧音乐开关逻辑与 banshanBgm 偏好已清除',
  !/syncBgmUI/.test(HTML) && !/setItem\('banshanBgm'/.test(HTML) && HTML.includes("removeItem('banshanBgm')"));
chk('源码：bgmOn 恒跟随 soundOn，无独立状态漂移', HTML.includes('bgmOn=soundOn') && HTML.includes('let bgmOn=soundOn'));
chk('源码：底部教学模块改抽屉浮层（dockGrip 拖动条 + dockMaxH 贴手牌 + 竖屏 V4 键 + 牌桌 52vh 不占满）',
  HTML.includes('dockGrip') && HTML.includes('dockMaxH') && HTML.includes('banshanDockHPortV4') &&
  HTML.includes('max-height:52vh') && HTML.includes('max-height:38vh') && HTML.includes('banshanDockHV2'));
chk('源码：出牌按钮与听牌浮层已接入',
  HTML.includes("id='playBtn'") && HTML.includes("id='tingBtn'") &&
  HTML.includes('function buildTingHTML') && HTML.includes('function openTingModal') &&
  !/mk\('出牌'/.test(HTML));

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1;
  HTMLMediaElement.prototype.play = function () {
    const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20);
    return Promise.resolve();
  };
});
await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
await page.evaluate(() => {
  const b = document.getElementById('teachBtn');
  if (b && !b.classList.contains('btnActive')) b.click();
});
await page.waitForTimeout(450);

// ② 音频：单一开关 + 状态同步
const audio0 = await page.evaluate(() => ({
  sound: !!document.getElementById('soundBtn'),
  bgm: !!document.getElementById('bgmBtn'),
  stored: localStorage.getItem('banshanBgm'),
  sync: bgmOn === soundOn,
  count: [...document.querySelectorAll('#topbar button')].filter(b => /声音|音乐/.test(b.textContent)).length,
  text: document.getElementById('soundBtn').textContent,
}));
chk('运行期：只有「声音」开关、旧音乐按钮不存在、旧偏好已清',
  audio0.sound && !audio0.bgm && audio0.stored === null && audio0.count === 1, JSON.stringify(audio0));
chk('运行期：bgmOn 与 soundOn 初始严格同步', audio0.sync);
await page.click('#soundBtn');
const audioOff = await page.evaluate(() => ({ soundOn, bgmOn, text: document.getElementById('soundBtn').textContent }));
chk('关声音：音效/语音/背景音乐一并关闭，状态无漂移',
  audioOff.soundOn === false && audioOff.bgmOn === false && audioOff.text.includes('关'), JSON.stringify(audioOff));
await page.click('#soundBtn');
const audioOn = await page.evaluate(() => ({ soundOn, bgmOn, text: document.getElementById('soundBtn').textContent }));
chk('开声音：背景音乐随之恢复，仅需一个开关',
  audioOn.soundOn === true && audioOn.bgmOn === true && audioOn.text.includes('开'), JSON.stringify(audioOn));

// ③ 头像行按钮几何
const geom = await page.evaluate(() => {
  const who = document.querySelector('#seat0 .who');
  const tb = document.getElementById('tingBtn'), pb = document.getElementById('playBtn');
  const av = who.querySelector('.whoAvatar').getBoundingClientRect();
  const nm = who.querySelector('.whoName').getBoundingClientRect();
  const t = tb.getBoundingClientRect(), p = pb.getBoundingClientRect(), w = who.getBoundingClientRect();
  return {
    inWho: who.contains(tb) && who.contains(pb),
    leftOfAvatar: t.right <= av.left + 2,
    rightOfName: p.left >= nm.right - 2,
    insideWho: t.left >= w.left - 2 && p.right <= w.right + 2,
    playVisible: getComputedStyle(pb).display !== 'none',
    actionsHasPlay: [...document.querySelectorAll('#actions button')].some(b => b.textContent.includes('出牌')),
    tingText: tb.textContent.trim(), playText: pb.textContent.trim(),
    playH: Math.round(p.height),
  };
});
chk('「听」在头像左侧、「出牌」在头像右侧，同处头像行',
  geom.inWho && geom.leftOfAvatar && geom.rightOfName && geom.insideWho, JSON.stringify(geom));
chk('出牌按钮仅存在于头像行，#actions 不再重复放置',
  geom.playVisible && !geom.actionsHasPlay && geom.tingText === '听' && geom.playText === '出牌' && geom.playH > 0,
  JSON.stringify(geom));

// ④ 听牌浮层
await page.click('#tingBtn');
const modal0 = await page.evaluate(() => ({
  disp: getComputedStyle(document.getElementById('tingModal')).display,
  text: document.getElementById('tingBody').textContent,
  note: document.querySelector('#tingModal .tingNote')?.textContent || '',
}));
chk('点「听」弹出浮层且带可见口径说明',
  modal0.disp === 'flex' && /当前听|还没听牌|尚未开始/.test(modal0.text) && modal0.note.includes('玩家可见口径'),
  modal0.text.slice(0, 40));

const tingCase = await page.evaluate(() => {
  window.__savedHand = p(0).hand.slice();
  window.__savedDiscard = G.players.map(x => (x.discard || []).slice());
  const mk = (id, i) => ({ id, uid: 90000 + i, suit: id[0], rank: parseInt(id[1], 10) });
  p(0).hand = ['W1','W2','W3','W4','W5','W6','W7','W8','W9','T1','T2','T3','B1'].map(mk);
  p(0).melds = [];
  const ting = calcTing();
  closeTingModal(); openTingModal();
  const body = document.getElementById('tingBody');
  return {
    ting,
    b1Name: tileName(tileFromId('B1')),
    items: body.querySelectorAll('.tingItem').length,
    photos: body.querySelectorAll('.tingItem .tp-sm').length,
    text: body.textContent,
  };
});
chk('已知单钓将牌型：calcTing 命中 B1', tingCase.ting.includes('B1'), JSON.stringify(tingCase.ting));
chk('浮层逐张列出所有可胡牌（牌面 + 牌名 + 剩余张数）',
  tingCase.items === tingCase.ting.length && tingCase.photos === tingCase.ting.length &&
  tingCase.text.includes(tingCase.b1Name) && tingCase.text.includes('剩') && tingCase.text.includes('当前听'),
  `items=${tingCase.items} photos=${tingCase.photos} text=${tingCase.text.slice(0, 60)}`);

const deadCase = await page.evaluate(() => {
  const mk = (id, i) => ({ id, uid: 95000 + i, suit: id[0], rank: parseInt(id[1], 10) });
  p(1).discard = ['B1','B1','B1','B1'].map(mk);
  closeTingModal(); openTingModal();
  const body = document.getElementById('tingBody');
  return { left: visibleLeft('B1'), dead: body.querySelectorAll('.tingItem.dead').length, text: body.textContent };
});
chk('绝张口径：明面已无剩余的听张标注「绝张」，不误称可胡',
  deadCase.left === 0 && deadCase.dead >= 1 && deadCase.text.includes('绝张'), JSON.stringify(deadCase).slice(0, 180));

const noneCase = await page.evaluate(() => {
  const mk = (id, i) => ({ id, uid: 96000 + i, suit: id[0], rank: parseInt(id[1], 10) });
  p(0).hand = ['W1','W4','W7','T1','T4','T7','B1','B4','B7','W9','T9','B9','B5'].map(mk);
  p(0).melds = [];
  const ting = calcTing();
  closeTingModal(); openTingModal();
  const body = document.getElementById('tingBody');
  return { ting, text: body.textContent, empty: !!body.querySelector('.tingEmpty'), items: body.querySelectorAll('.tingItem').length };
});
chk('未听牌：明确提示「还没听牌」并给出向听数，不列空列表',
  noneCase.ting.length === 0 && noneCase.empty && noneCase.items === 0 && noneCase.text.includes('还没听牌'),
  JSON.stringify(noneCase).slice(0, 180));
await page.click('#tingCloseBtn');
const closed = await page.evaluate(() => getComputedStyle(document.getElementById('tingModal')).display);
chk('关闭按钮可收起浮层', closed === 'none', closed);
await page.click('#tingBtn');
await page.evaluate(() => document.getElementById('tingModal').click());
const closed2 = await page.evaluate(() => getComputedStyle(document.getElementById('tingModal')).display);
chk('点遮罩亦可收起浮层', closed2 === 'none', closed2);

// ⑤ 出牌链路：选牌 → 点头像右侧「出牌」
await page.evaluate(() => {
  p(0).hand = window.__savedHand.slice();
  p(0).melds = [];
  for (let i = 0; i < 4; i++) G.players[i].discard = (window.__savedDiscard[i] || []).slice();
  G._sel = null; render();
});
await page.waitForTimeout(200);
const before = await page.evaluate(() => ({ n: p(0).discard.length, awaiting: G.awaiting, cur: G.current }));
await page.locator('#hand .tile-photo').first().click();
const sel = await page.evaluate(() => !!G._sel);
await page.locator('#playBtn').click();
await page.waitForTimeout(600);
const after = await page.evaluate(() => ({ n: p(0).discard.length, sel: !!G._sel, awaiting: G.awaiting }));
chk('选牌后点头像右侧「出牌」正常打出（弃牌 +1、选中态清空）',
  before.awaiting === 'discard' && sel && after.n === before.n + 1 && !after.sel,
  JSON.stringify({ before, sel, after }));

// ⑥ 底部教学模块上提 + 排版零裁切
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const dockP = await page.evaluate(() => {
  const d = document.getElementById('bottomDock'), r = d.getBoundingClientRect();
  const stageH = document.getElementById('stage').clientHeight;
  const top = document.getElementById('topbar').offsetHeight;
  const seat = document.getElementById('seat0').getBoundingClientRect();
  const boxes = ['#hand', '#playBtn', '#tingBtn', '#splitBar'].map(s => {
    const e = document.querySelector(s); if (!e || getComputedStyle(e).display === 'none') return null;
    const b = e.getBoundingClientRect();
    return { s, ok: b.top >= seat.top - 2 && b.bottom <= seat.bottom + 2 && b.right <= seat.right + 2 };
  }).filter(Boolean);
  return { h: Math.round(r.height), top: Math.round(r.top), ratio: +(r.height / (stageH - top)).toFixed(3),
    topPct: +(r.top / innerHeight).toFixed(3), scroll: d.scrollHeight - d.clientHeight,
    clipped: boxes.filter(x => !x.ok).map(x => x.s), boxes: boxes.length };
});
chk('竖屏教学抽屉默认贴手牌（顶边到手牌下沿附近、占比约 0.7）',
  dockP.ratio >= 0.60 && dockP.topPct < 0.42 && dockP.scroll > 0, JSON.stringify(dockP));
chk('竖屏手牌 / 头像行按钮零裁切（出牌后按钮按状态收起属正常）',
  dockP.clipped.length === 0 && dockP.boxes >= 2, JSON.stringify(dockP.clipped));

await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(400);
const dockL = await page.evaluate(() => {
  const d = document.getElementById('bottomDock');
  return { maxH: getComputedStyle(d).maxHeight, fixed: d.classList.contains('dockFixed'),
    h: Math.round(d.getBoundingClientRect().height), vh: innerHeight };
});
chk('横屏教学区上限维持 38vh，且旧拖拽高度不覆盖新默认',
  Math.abs(parseFloat(dockL.maxH) - dockL.vh * 0.38) < 2 && !dockL.fixed, JSON.stringify(dockL));

// 组合模式（教学 + 拆牌）零裁切
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(350);
await page.evaluate(() => {
  const t = document.getElementById('teachBtn'), s = document.getElementById('splitBtn');
  if (t && !t.classList.contains('btnActive')) t.click();
  if (s && !s.classList.contains('btnActive')) s.click();
  render();
});
await page.waitForTimeout(400);
const combo = await page.evaluate(() => {
  const seat = document.getElementById('seat0').getBoundingClientRect();
  const inSeat = s => { const e = document.querySelector(s); if (!e || getComputedStyle(e).display === 'none') return null;
    const b = e.getBoundingClientRect(); return { s, ok: b.top >= seat.top - 2 && b.bottom <= seat.bottom + 2 && b.right <= seat.right + 2 }; };
  return { teach: document.getElementById('teachBtn').classList.contains('btnActive'),
    split: document.getElementById('splitBtn').classList.contains('btnActive'),
    bad: ['#hand', '#splitBar', '#playBtn', '#tingBtn'].map(inSeat).filter(x => x && !x.ok).map(x => x.s),
    barShown: getComputedStyle(document.getElementById('splitBar')).display !== 'none' };
});
chk('竖屏 + 教学 + 拆牌：手牌、拆解条、头像行按钮零裁切',
  combo.teach && combo.split && combo.barShown && combo.bad.length === 0, JSON.stringify(combo));

chk('全程零 JS 报错', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

const pass = results.filter(r => r.ok).length, total = results.length;
console.log(`\n音频合并 / 头像行按钮 / 听牌浮层 / 教学区上提专项：${pass}/${total} 通过`);
await browser.close();
process.exit(pass === total ? 0 : 1);
