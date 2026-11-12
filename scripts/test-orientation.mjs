// 2026-11-12 用户需求：不管 iPad 还是手机，竖着放一律竖向排版、横着放一律横向排版。
// 专项回归：设备/视口方向矩阵、动态旋转、平板竖屏尺度、组合模式零裁切、源码不按设备分档。
// 口径：方向只取视口几何（高>宽），不再有「≤560px 才算竖屏」「平板竖屏强制旋转 90°」的分支。
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

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1; // 本测试不跑局，故不禁用拆解条（组合模式需要真实渲染 #splitBar）
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
// 教学面板全程保持开启，便于检查四栏结构与 dock
await page.evaluate(() => {
  const b = document.getElementById('teachBtn');
  if (b && !b.classList.contains('btnActive')) b.click();
});
await page.waitForTimeout(400);

const snap = () => page.evaluate(() => {
  const st = document.getElementById('stage');
  const box = sel => {
    const e = document.querySelector(sel); if (!e) return null;
    const r = e.getBoundingClientRect();
    return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), disp: getComputedStyle(e).display };
  };
  const s = st.getBoundingClientRect();
  const hand = document.getElementById('hand');
  const rows = new Set([...hand.querySelectorAll('.tile-photo')].map(e => Math.round(e.getBoundingClientRect().top))).size;
  const cols = [...document.querySelectorAll('.tGrid .tCol')].map(e => {
    const r = e.getBoundingClientRect();
    return { cls: e.className, t: Math.round(r.top), l: Math.round(r.left) };
  });
  const pool = document.querySelector('.tPool');
  const seat = document.getElementById('seat0').getBoundingClientRect();
  const clipped = [...hand.querySelectorAll('.tile-photo')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.top < seat.top - 2 || r.bottom > seat.bottom + 2 || r.left < seat.left - 2 || r.right > seat.right + 2;
  }).length;
  const actBtn = document.querySelector('#actions button');
  const actInside = !!actBtn && (() => {
    const r = actBtn.getBoundingClientRect();
    return r.top >= seat.top - 2 && r.bottom <= seat.bottom + 2 && r.right <= seat.right + 2;
  })();
  const sb = document.getElementById('splitBar');
  const sbInside = !sb || sb.style.display === 'none' || (() => {
    const r = sb.getBoundingClientRect();
    return r.top >= seat.top - 2 && r.bottom <= seat.bottom + 2;
  })();
  return {
    iw: innerWidth, ih: innerHeight,
    pport: st.classList.contains('pport'), pportWide: st.classList.contains('pportWide'),
    bodyWide: document.body.classList.contains('pportWide'),
    rot: st.classList.contains('rot'), stageW: Math.round(s.width), stageH: Math.round(s.height),
    stageWStyle: st.style.width, docW: document.documentElement.scrollWidth,
    topbar: box('#topbar'), table: box('#table'), hand: box('#hand'),
    actions: box('#actions'), dock: box('#bottomDock'), splitBar: box('#splitBar'),
    rows, cols, clipped, actInside, sbInside,
    handWrapDir: getComputedStyle(document.getElementById('handWrap')).flexDirection,
    handVar: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hand')),
    poolFs: pool ? parseFloat(getComputedStyle(pool).fontSize) : 0,
    btnFs: parseFloat(getComputedStyle(document.querySelector('#topbar button')).fontSize),
    dockScroll: (() => { const d = document.getElementById('bottomDock'); return d.scrollHeight - d.clientHeight; })(),
    teachOn: document.getElementById('teachBtn').classList.contains('btnActive'),
    splitOn: document.getElementById('splitBtn').classList.contains('btnActive'),
  };
});

// ① 源码口径：不再按设备宽度分档、不再旋转舞台
chk('源码：isPhonePort 已去掉 560px 宽度门槛', !/innerWidth\s*<=\s*560/.test(HTML));
chk('源码：layout 不再 add(rot) 强制旋转平板竖屏', !/classList\.add\(['"]rot['"]\)/.test(HTML));
chk('源码：含纯几何方向判定 + 宽竖屏 + orientation 监听',
  HTML.includes('let __orientPort=null') && HTML.includes('function isWidePort') &&
  HTML.includes('pportWide') && HTML.includes("matchMedia('(orientation: portrait)')"));

// ② 设备 / 视口方向矩阵
const cases = [
  { name: '手机竖放 390×844', w: 390, h: 844, port: true },
  { name: '手机横放 844×390', w: 844, h: 390, port: false },
  { name: 'iPad 竖放 768×1024', w: 768, h: 1024, port: true },
  { name: 'iPad 横放 1024×768', w: 1024, h: 768, port: false },
  { name: 'iPad Pro 竖放 1024×1366', w: 1024, h: 1366, port: true },
  { name: 'iPad Pro 横放 1366×1024', w: 1366, h: 1024, port: false },
  { name: '安卓平板竖放 800×1280', w: 800, h: 1280, port: true },
  { name: '安卓平板横放 1280×800', w: 1280, h: 800, port: false },
  { name: '桌面窄高窗口 900×1200', w: 900, h: 1200, port: true },
  { name: '桌面常规窗口 1440×900', w: 1440, h: 900, port: false },
];
const snaps = {};
for (const c of cases) {
  await page.setViewportSize({ width: c.w, height: c.h });
  await page.waitForTimeout(420); // 覆盖 onOrientationChange 的 120ms / 320ms 两次重排
  const s = await snap();
  snaps[c.name] = s;
  const wantWide = c.port && c.w >= 600;
  const geomOK = s.pport === c.port && s.bodyWide === wantWide && !s.rot &&
    s.stageW === c.w && s.stageH === c.h && s.docW <= c.w + 1 && s.stageWStyle === '100%' &&
    (c.port ? s.handWrapDir === 'column' : s.handWrapDir === 'row');
  chk(`${c.name}：${c.port ? '竖向排版' : '横向排版'}, 无强制旋转, 舞台满屏`, geomOK,
    `pport=${s.pport} wide=${s.bodyWide} rot=${s.rot} handWrap=${s.handWrapDir} stage=${s.stageW}×${s.stageH} scrollW=${s.docW}`);
  const visOK = !!s.topbar && !!s.table && !!s.hand && !!s.actions &&
    s.topbar.b <= c.h + 1 && s.table.b <= c.h + 1 && s.hand.r <= c.w + 1 &&
    s.hand.b <= c.h + 1 && s.actions.b <= c.h + 1 && s.clipped === 0 && s.actInside;
  chk(`${c.name}：顶栏/牌桌/手牌/操作行完整可见无裁切`, visOK,
    `clipped=${s.clipped} actInside=${s.actInside} handBottom=${s.hand && s.hand.b}`);
  const colOK = s.cols.length === 4 &&
    s.cols[0].cls.includes('tColMain') && s.cols[1].cls.includes('tColOpp') &&
    s.cols[2].cls.includes('tColTing') && s.cols[3].cls.includes('tColRank') &&
    (c.port
      ? s.cols[0].t < s.cols[1].t && s.cols[1].t < s.cols[2].t && s.cols[2].t === s.cols[3].t
      : s.cols.every(x => x.t === s.cols[0].t));
  chk(`${c.name}：教学四栏顺序${c.port ? '（竖排 2 列）' : '（横排 1 行）'}正确`, colOK,
    s.cols.map(x => `${x.cls.replace('tCol ', '')}@${x.t}`).join(' '));
}

// ③ 平板竖放尺度：牌面、字号明显大于手机竖放，但结构一致
const phoneP = snaps['手机竖放 390×844'], padP = snaps['iPad 竖放 768×1024'];
chk('平板竖放牌面大于手机竖放（平板尺度）', padP.handVar > phoneP.handVar + 8,
  `pad=${padP.handVar}px phone=${phoneP.handVar}px`);
chk('平板竖放教学与顶栏字号放大', padP.poolFs >= 12 && padP.btnFs >= 12.5 && phoneP.poolFs <= 11,
  `pad pool=${padP.poolFs} btn=${padP.btnFs} / phone pool=${phoneP.poolFs}`);
// 宽竖屏与窄竖屏都按 flex-wrap 自适应行数（1~2 行），底部面板内容靠上下滑动查看
chk('竖放手牌行数自适应 + 底部面板可上下滑动',
  padP.rows >= 1 && padP.rows <= 2 && phoneP.rows >= 1 && phoneP.rows <= 2 &&
  padP.dockScroll > 0 && phoneP.dockScroll > 0 && padP.teachOn,
  `padRows=${padP.rows} phoneRows=${phoneP.rows} dockScroll=${padP.dockScroll}/${phoneP.dockScroll}`);

// ④ 动态旋转：同一页面来回翻转，方向类跟随且不留旋转态
await page.setViewportSize({ width: 768, height: 1024 });
await page.waitForTimeout(420);
const r1 = await snap();
await page.setViewportSize({ width: 1024, height: 768 });
await page.waitForTimeout(420);
const r2 = await snap();
await page.setViewportSize({ width: 768, height: 1024 });
await page.waitForTimeout(420);
const r3 = await snap();
chk('竖→横→竖 连续旋转：方向类双向跟随、无残留 rot',
  r1.pport && !r2.pport && r3.pport && !r1.rot && !r2.rot && !r3.rot &&
  r2.stageW === 1024 && r3.stageW === 768,
  `pport=${r1.pport}/${r2.pport}/${r3.pport}`);
chk('旋转后 dock 高度与牌面尺寸重算', r1.handVar !== r2.handVar && r1.dock.h !== r2.dock.h,
  `hand=${r1.handVar}/${r2.handVar} dock=${r1.dock.h}/${r2.dock.h}`);

// ⑤ 近正方形滞回：小幅尺寸变化不反复重排
await page.setViewportSize({ width: 900, height: 1200 });
await page.waitForTimeout(420);
const near0 = await snap();
await page.setViewportSize({ width: 900, height: 910 });
await page.waitForTimeout(420);
const near1 = await snap();
chk('近正方形（900×910）沿用上一方向，不抖动重排', near0.pport && near1.pport,
  `before=${near0.pport} after=${near1.pport}`);

// ⑥ 平板竖放 + 教学 + 拆牌：组合布局零裁切
await page.setViewportSize({ width: 768, height: 1024 });
await page.waitForTimeout(420);
await page.evaluate(() => {
  const t = document.getElementById('teachBtn'), s = document.getElementById('splitBtn');
  if (t && !t.classList.contains('btnActive')) t.click();
  if (s && !s.classList.contains('btnActive')) s.click();
});
await page.waitForTimeout(500);
const combo = await snap();
chk('iPad 竖放 + 教学 + 拆牌：拆解条/手牌/出牌按钮零裁切',
  combo.pport && combo.pportWide && combo.teachOn && combo.splitOn &&
  combo.clipped === 0 && combo.actInside && combo.sbInside &&
  combo.splitBar.disp !== 'none' && combo.hand.h > 0,
  `clipped=${combo.clipped} act=${combo.actInside} sb=${combo.sbInside} splitBar=${combo.splitBar.disp}`);
// 组合态再旋到横屏，仍零裁切
await page.setViewportSize({ width: 1024, height: 768 });
await page.waitForTimeout(420);
const comboL = await snap();
chk('组合态横屏：无裁切且方向切换后拆解条仍在',
  !comboL.pport && !comboL.rot && comboL.clipped === 0 && comboL.actInside && comboL.sbInside,
  `clipped=${comboL.clipped} act=${comboL.actInside} sb=${comboL.sbInside}`);

chk('全程零 JS 报错', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

const pass = results.filter(r => r.ok).length, total = results.length;
console.log(`\n方向自适应专项：${pass}/${total} 通过`);
await browser.close();
process.exit(pass === total ? 0 : 1);
