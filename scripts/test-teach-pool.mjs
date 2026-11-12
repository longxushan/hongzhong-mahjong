// 2026-11-12 用户需求：①教学模式「推荐打出」与「打牌建议」合并成一栏
// ②打错提醒必须看本局废牌区（河里已打什么、贴张还剩几张），不许照抄麻将口诀
// 断言：四栏布局、合并标题、牌河数字随废牌区实时变化并进入提醒/复盘/讲思路判据
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
function findBrowser() {
  return [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].find(p => fs.existsSync(p));
}

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: findBrowser() });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

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
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 30000 });

const r = await page.evaluate(() => {
  const mk = (id, uid) => ({ id, uid, suit: id === 'Z' ? 'Z' : id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) });
  const ids = ['W1','W1','W2','W3','W5','W6','W9','T2','T4','T7','B1','B5','B8','Z'];
  const me = p(0);
  me.hand = ids.map((id, i) => mk(id, 70000 + i));
  me.melds = [];
  for (let k = 0; k < 4; k++) { G.players[k].discard = []; G.players[k].melds = []; }
  G.awaiting = 'discard';
  // 打开教学模式面板
  teachOn = true; thinkOn = false; refreshDock(); updateTeachPanel();
  const grid = document.querySelector('.tGrid');
  const cols = [...grid.querySelectorAll('.tCol')].map(c => ({
    cls: c.className, head: (c.querySelector('.tColHead') || {}).textContent || '',
  }));
  const advHTML = (document.querySelector('.tColAdv') || {}).innerHTML || '';
  const advHasPool = advHTML.includes('废牌区实况') && advHTML.includes('tPoolNum');
  const advHasStage = advHTML.includes('全场废牌区') && !advHTML.includes('开局先理牌');
  const advHasKouNote = advHTML.includes('牌理通则');
  const advEl = document.querySelector('.tColAdv');
  const advGeom = { client: advEl.clientHeight, scroll: advEl.scrollHeight };
  const mainEl = document.querySelector('.tColMain');
  const mainSecs = mainEl ? mainEl.querySelectorAll('.tSec').length : 0;
  const mainHasBoth = !!mainEl && !!mainEl.querySelector('.tPlanTag') && !!mainEl.querySelector('.tPool');
  const oppEl = document.querySelector('.tColOpp');
  const oppEmpty = (oppEl || {}).textContent || '';
  const oppCards = oppEl ? oppEl.querySelectorAll('.tOppCard').length : 0;
  const oppHasTwoLines = !!oppEl && oppEl.textContent.includes('牌型') && oppEl.textContent.includes('打法')
    && oppEl.textContent.includes('别家暗牌不可见');
  const panelEmpty = document.getElementById('teachPanel').textContent;
  const splitters = grid.querySelectorAll('.colSplitter').length;
  const scanEmpty = poolScan('W1');
  const keepEmpty = poolKeepValue('W1', handDiagnose(me));
  const stageEmpty = poolStageText(handDiagnose(me));
  const judgeEmpty = poolJudgeLine('W1');
  const t = me.hand.find(x => x.id === 'W1');
  mistakeWarnOn = true;
  liveWarn(t);
  const warnEmpty = { cls: document.getElementById('liveWarn').className, txt: document.getElementById('liveWarn').textContent };

  // 构造真实废牌区：一万河里 3 张、贴张二万/三万被大量打掉，全场共 20 张
  const pool = ['W1','W1','W1','W2','W2','W3','W3','W2','T4','T5','T6','B3','B7','B9','W9','T1','T9','B1','B2','Z'];
  for (let i = 0; i < pool.length; i++) G.players[1 + (i % 3)].discard.push(mk(pool[i], 60000 + i));
  const scanFull = poolScan('W1');
  const keepFull = poolKeepValue('W1', handDiagnose(me));
  const stageFull = poolStageText(handDiagnose(me));
  const judgeFull = poolJudgeLine('W1');
  const reason = poolReasonText('W1', teachPick(handDiagnose(me)).id);
  const think = buildThinkHTML();
  liveWarn(t);
  const warnFull = { cls: document.getElementById('liveWarn').className, txt: document.getElementById('liveWarn').textContent };
  updateTeachPanel();
  const panelFull = document.getElementById('teachPanel').textContent;
  const oppFull = (document.querySelector('.tColOpp') || {}).textContent || '';
  return {
    cols, heads: cols.map(c => c.head), splitters,
    mainSecs, mainHasBoth, oppCards, oppHasTwoLines,
    oppEmpty: oppEmpty.slice(0, 200), oppFull: oppFull.slice(0, 200),
    advHasPool, advHasStage, advHasKouNote, advLen: advHTML.length, advGeom,
    panelEmpty: panelEmpty.slice(0, 500), panelFull: panelFull.slice(0, 500),
    scanEmpty: { out: scanEmpty.out, nearLeft: scanEmpty.nearLeft, total: scanEmpty.total },
    scanFull: { out: scanFull.out, nearLeft: scanFull.nearLeft, total: scanFull.total },
    keepEmpty, keepFull, judgeEmpty, judgeFull, stageEmpty, stageFull, reason,
    thinkHasPool: think.includes('全场废牌区 20 张'),
    warnEmpty, warnFull,
  };
});

const checks = [
  ['教学面板由五栏合并为四栏', r.cols.length === 4],
  ['存在合并栏「推荐打出 · 打牌建议」', r.heads.some(h => h.includes('推荐打出') && h.includes('打牌建议'))],
  ['不再有独立的「推荐打出」「打牌建议」两栏', !r.heads.includes('推荐打出') && !r.heads.includes('打牌建议')],
  ['拖拽分隔条数量随列数变为 3', r.splitters === 3],
  ['四栏从左到右：牌型+推荐 → 对手分析 → 听牌一览 → 积分排行',
    /牌型分析/.test(r.heads[0]) && /推荐打出/.test(r.heads[0]) && /打牌建议/.test(r.heads[0])
    && /对手分析/.test(r.heads[1]) && /听牌一览/.test(r.heads[2]) && /积分排行/.test(r.heads[3])],
  ['第1栏内两块并存：牌型分析与推荐打出同栏、不再各自成栏', r.mainSecs === 2 && r.mainHasBoth],
  ['第2栏对手分析含三家卡片、牌型/打法两行与可见口径说明', r.oppCards === 3 && r.oppHasTwoLines],
  ['对手分析随本局废牌区实时刷新', r.oppFull.includes('20 张') && r.oppFull !== r.oppEmpty],
  ['合并栏含废牌区实况块与数字高亮', r.advHasPool === true],
  ['合并栏含本局阶段实况（替代固定口诀）', r.advHasStage === true],
  ['合并栏把口诀降级为参考', r.advHasKouNote === true],
  ['空废牌区：一万河里 0 张', r.scanEmpty.out === 0 && r.scanEmpty.total === 0],
  ['构造牌河后：一万河里 3 张、全场 20 张', r.scanFull.out === 3 && r.scanFull.total === 20],
  ['贴张可见剩余随废牌区下降', r.scanFull.nearLeft < r.scanEmpty.nearLeft],
  ['留牌价值随废牌区下降', r.keepFull < r.keepEmpty],
  ['牌河判据随实况改变', r.judgeFull !== r.judgeEmpty],
  ['阶段判据是实况数字而非口诀', r.stageFull.includes('全场废牌区 20 张') && !r.stageFull.includes('开局先理牌')],
  ['打错提醒（空河）已带牌河字段', /废牌区 0 张/.test(r.warnEmpty.txt) && /贴张剩/.test(r.warnEmpty.txt)],
  ['打错提醒（有河）数字随牌河更新', /废牌区 20 张/.test(r.warnFull.txt) && /河里 3 张/.test(r.warnFull.txt)],
  ['打错提醒两次结论文案不同（看实际牌局）', r.warnFull.txt !== r.warnEmpty.txt],
  ['提醒保留独立复核与大师机会成本口径', r.warnFull.txt.includes('雀学米高·机会成本') && r.warnFull.txt.includes('郑太顺读牌')],
  ['复盘理由带本局废牌区数字', r.reason.includes('废牌区共 20 张')],
  ['讲思路第三步读的是废牌区实况', r.thinkHasPool === true],
  ['教学面板文字随废牌区刷新', r.panelFull.includes('20 张') && r.panelEmpty !== r.panelFull],
  ['合并栏内容在横屏教学面板内不被裁切', r.advGeom.client > 0 && r.advGeom.scroll - r.advGeom.client <= 40],
  ['页面无 JS 报错', pageErrors.length === 0],
];

for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
console.log('\n栏位:', JSON.stringify(r.heads));
console.log('空河 → 满河:', JSON.stringify(r.scanEmpty), '→', JSON.stringify(r.scanFull), 'keep', r.keepEmpty, '→', r.keepFull);
console.log('合并栏几何:', JSON.stringify(r.advGeom), 'HTML 长度', r.advLen);
console.log('提醒（满河）:', r.warnFull.cls, '|', r.warnFull.txt.slice(0, 260));
if (pageErrors.length) console.log('页面错误:', pageErrors);
// 手机竖屏：合并栏跨整行，四栏不溢出视口
const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
const p2Errors = [];
page2.on('pageerror', e => p2Errors.push(e.message));
await page2.addInitScript(() => {
  window.__noCloudExp = 1; window.__noSplitBar = 1;
  HTMLMediaElement.prototype.play = function () {
    const self = this;
    setTimeout(() => { if (typeof self.onended === 'function') self.onended(); }, 30);
    return Promise.resolve();
  };
});
await page2.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page2.click('#startBtn');
await page2.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
await page2.locator('.roleBtn').first().click();
await page2.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 30000 });
const port = await page2.evaluate(() => {
  teachOn = true; thinkOn = false; refreshDock(); updateTeachPanel();
  const adv = document.querySelector('.tColAdv'), cs = getComputedStyle(adv);
  const rect = adv.getBoundingClientRect(), grid = document.querySelector('.tGrid').getBoundingClientRect();
  const dockEl = document.getElementById('bottomDock');
  dockEl.scrollTop = rect.top - dockEl.getBoundingClientRect().top + dockEl.scrollTop;
  const after = adv.getBoundingClientRect(), dr = dockEl.getBoundingClientRect();
  const scrollReachable = after.top >= dr.top - 2 && after.top < dr.bottom - 40 && adv.scrollHeight <= adv.clientHeight + 2;
  return { scrollReachable, afterTop: Math.round(after.top), dockTop: Math.round(dr.top), dockBottom: Math.round(dr.bottom),
    pport: document.getElementById('stage').classList.contains('pport'),
    cols: document.querySelectorAll('.tGrid .tCol').length,
    span: cs.gridColumn, oppSpan: getComputedStyle(document.querySelector('.tColOpp')).gridColumn,
    client: adv.clientHeight, scroll: adv.scrollHeight,
    inViewport: rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1,
    gridW: Math.round(grid.width), advW: Math.round(rect.width),
    rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right) },
    grid: { top: Math.round(grid.top), bottom: Math.round(grid.bottom) },
    dock: (() => { const d = document.getElementById('bottomDock').getBoundingClientRect(); return { top: Math.round(d.top), bottom: Math.round(d.bottom), h: Math.round(d.height), scroll: document.getElementById('teachPanel').scrollHeight }; })(),
    vh: window.innerHeight,
    rows: [...document.querySelectorAll('.tGrid .tCol')].map(c => { const q = c.getBoundingClientRect(); return { head: (c.querySelector('.tColHead') || {}).textContent, top: Math.round(q.top), bottom: Math.round(q.bottom), h: Math.round(q.height) }; }),
    hasPool: adv.textContent.includes('废牌区实况'),
  };
});
const portChecks = [
  ['竖屏四栏布局', port.pport && port.cols === 4],
  ['竖屏合并栏跨整行且可滑动查看完整内容', /1\s*\/\s*3|span 2/.test(port.span) && port.scrollReachable],
  ['竖屏对手分析栏也跨整行', /1\s*\/\s*3|span 2/.test(port.oppSpan)],
  ['竖屏四栏自上而下顺序正确、听牌与积分并排',
    /牌型分析/.test(port.rows[0].head) && /对手分析/.test(port.rows[1].head)
    && /听牌一览/.test(port.rows[2].head) && /积分排行/.test(port.rows[3].head)
    && port.rows[0].top < port.rows[1].top && port.rows[1].top < port.rows[2].top
    && Math.abs(port.rows[2].top - port.rows[3].top) < 3],
  ['竖屏合并栏显示废牌区实况', port.hasPool],
  ['竖屏无 JS 报错', p2Errors.length === 0],
];
for (const [name, ok] of portChecks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
console.log('竖屏几何:', JSON.stringify(port));
const pass = checks.every(c => c[1]) && portChecks.every(c => c[1]);
console.log(pass ? `\nPASS: ${checks.length + portChecks.length}/${checks.length + portChecks.length} 教学合并 + 打错提醒牌河实况` : '\nFAIL: 见上');
await browser.close();
process.exit(pass ? 0 : 1);
