// 2026-11-12 用户需求：教学面板新增独立「对手分析 · 牌型与打法」列
// 核心口径：只用玩家可见信息（四家弃牌 + 明面副露 + 自己手牌 + 角色公开打法），不偷看别家暗手牌与牌墙。
// 断言：四栏顺序、牌型倾向推断分支、打法描述、暗杠只算 1 张、等张信号、面板渲染、列宽 V2、横竖屏布局
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const EXE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1; window.__noSplitBar = 1;
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

const r = await page.evaluate(() => {
  const mk = (id, uid) => ({ id, uid, suit: id === 'Z' ? 'Z' : id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) });
  const ids = (arr, base) => arr.map((id, i) => mk(id, base + i));
  const reset = () => { for (let k = 0; k < 4; k++) { G.players[k].discard = []; G.players[k].melds = []; } };
  const out = {};

  // ① 空河基线 + 源码口径（不读别家 hand / 牌墙）
  reset();
  const base = opponentAnalysis();
  out.base = { n: base.list.length, total: base.total, meldTotal: base.meldTotal, sigTotal: base.sigTotal,
    names: base.list.map(x => x.name), styles: base.list.map(x => x.style), plans: base.list.map(x => x.plan) };
  const src = opponentAnalysis.toString();
  out.srcClean = !/\.hand\b/.test(src) && !/G\.wall/.test(src) && src.includes('angang');

  // ② 偷看暗牌检测：给别家塞一手特殊暗牌，分析结果必须一字不变
  const savedHand = p(1).hand;
  p(1).hand = ids(['W1','W1','W1','W1','T9','T9','T9','B1','B1','B1','Z','Z','Z','Z'], 90000);
  const afterHidden = opponentAnalysis();
  out.noPeek = JSON.stringify(afterHidden.list) === JSON.stringify(base.list);
  p(1).hand = savedHand;

  // ③ 牌型推断：碰碰胡（明面两组碰、无吃顺）
  reset();
  p(1).melds = [
    { type: 'peng', base: 'W3', tiles: ids(['W3','W3'], 91000) },
    { type: 'peng', base: 'B7', tiles: ids(['B7','B7'], 91200) },
  ];
  const pong = opponentAnalysis();
  out.pongPlan = pong.list[0].plan; out.pongBasis = pong.list[0].basis; out.pongMeldTotal = pong.meldTotal;

  // ④ 牌型推断：清一色/混一色（河里几乎只打一门，另一门几乎没打）
  reset();
  p(2).discard = ids(['W1','W2','W3','W5','W7','W9'], 92000);
  const qing = opponentAnalysis();
  out.qingPlan = qing.list[1].plan; out.qingBasis = qing.list[1].basis;

  // ⑤ 牌型推断：门清（未副露、红中未弃、花色分散）
  reset();
  p(3).discard = ids(['W1','T2','B3','W4','T5','B6'], 93000);
  const menqing = opponentAnalysis();
  out.mqPlan = menqing.list[2].plan; out.mqBasis = menqing.list[2].basis;

  // ⑥ 暗杠只算亮出的 1 张（不能按 4 张推花色）
  reset();
  p(1).melds = [{ type: 'angang', base: 'W5', tiles: ids(['W5','W5','W5','W5'], 94000) }];
  const angang = opponentAnalysis();
  out.angangMeldSuits = angang.list[0].meldSuits;

  // ⑦ 等张信号：反常对（先 W6 后 W8，差 2）按家命中
  reset();
  p(2).discard = ids(['W6','W8','T1'], 95000);
  const sig = opponentAnalysis();
  out.sigOne = sig.list[1].sig; out.sigTotal = sig.sigTotal;

  // ⑧ 全场汇总：20 张弃牌 + 副露计数
  reset();
  const pool = ['W1','W1','W2','W3','T4','T5','B6','B7','W9','T1','B2','Z','W5','T8','B3','W7','T9','B1','W4','T3'];
  for (let i = 0; i < pool.length; i++) G.players[1 + (i % 3)].discard.push(mk(pool[i], 96000 + i));
  p(1).melds = [{ type: 'peng', base: 'T2', tiles: ids(['T2','T2'], 97000) }];
  const full = opponentAnalysis();
  out.full = { total: full.total, meldTotal: full.meldTotal, wall: full.wall };
  out.playStyle = full.list.map(x => x.play);
  out.fastCount = full.list.filter(x => x.fast).length;

  // ⑨ 面板渲染：四栏顺序、三家卡片、牌型/打法两行、口径说明、分隔条
  teachOn = true; thinkOn = false; refreshDock(); updateTeachPanel();
  const cols = [...document.querySelectorAll('.tGrid .tCol')].map(c => ({
    cls: c.className, head: (c.querySelector('.tColHead') || {}).textContent || '',
  }));
  const oppEl = document.querySelector('.tColOpp');
  out.panel = {
    heads: cols.map(c => c.head), classes: cols.map(c => c.cls),
    cards: oppEl.querySelectorAll('.tOppCard').length,
    cardLines: [...oppEl.querySelectorAll('.tOppCard')].map(c => [...c.querySelectorAll('.tOppLine')].length),
    hasTwoLabels: [...oppEl.querySelectorAll('.tOppCard')].every(c => c.textContent.includes('牌型') && c.textContent.includes('打法')),
    hasNote: oppEl.textContent.includes('别家暗牌不可见'),
    splitters: document.querySelectorAll('.colSplitter').length,
    mainSecs: document.querySelectorAll('.tColMain .tSec').length,
  };

  // ⑩ 列宽存储键 V2：旧键不得套到新四栏语义上
  const tg = document.querySelector('.tGrid');
  tg.classList.remove('manual'); tg.style.gridTemplateColumns = '';
  localStorage.removeItem('banshanColWidthsV2');
  localStorage.setItem('banshanColWidths', JSON.stringify({ widths: [100, 100, 100, 100] }));
  applyColWidths();
  out.oldKeyIgnored = !tg.classList.contains('manual');
  localStorage.setItem('banshanColWidthsV2', JSON.stringify({ widths: [400, 320, 220, 134] }));
  applyColWidths();
  out.v2KeyApplied = tg.classList.contains('manual');
  localStorage.removeItem('banshanColWidthsV2');
  tg.classList.remove('manual'); tg.style.gridTemplateColumns = '';

  // ⑪ 教学 + 拆牌组合：面板仍为四栏且对手分析不报错
  try { splitMode = true; syncSplitModeUI(); render(); updateTeachPanel(); splitMode = false; syncSplitModeUI(); render(); updateTeachPanel(); }
  catch (e) { out.comboError = String(e); }
  out.combo = { cols: document.querySelectorAll('.tGrid .tCol').length, cards: document.querySelectorAll('.tColOpp .tOppCard').length };
  return out;
});

const checks = [];
const chk = (name, ok, extra = '') => { checks.push([name, !!ok]); if (!ok) console.log('  ✗', name, extra); };
console.log('基线:', JSON.stringify(r.base));
console.log('牌型推断:', JSON.stringify({ pong: [r.pongPlan, r.pongBasis], qing: [r.qingPlan, r.qingBasis], mq: [r.mqPlan, r.mqBasis] }));
console.log('暗杠花色:', JSON.stringify(r.angangMeldSuits), '信号:', r.sigOne, '/', r.sigTotal, '满河:', JSON.stringify(r.full));

chk('空河：三家齐全、每家有名字/风格/牌型', r.base.n === 3 && r.base.names.every(Boolean) && r.base.styles.every(Boolean) && r.base.plans.every(Boolean));
chk('空河：全场 0 张、0 副露、0 信号', r.base.total === 0 && r.base.meldTotal === 0 && r.base.sigTotal === 0);
chk('源码不引用别家手牌与牌墙，且显式处理暗杠', r.srcClean === true);
chk('给别家塞满暗牌后分析结果一字不变（不偷看）', r.noPeek === true);
chk('碰碰胡倾向：明面两组碰、无吃顺', /碰碰胡/.test(r.pongPlan) && /2 组副露/.test(r.pongBasis), JSON.stringify([r.pongPlan, r.pongBasis]));
chk('碰碰胡场景副露汇总为 2 组', r.pongMeldTotal === 2, `meldTotal=${r.pongMeldTotal}`);
chk('清一色/混一色倾向：河里花色数字入判据', /清一色/.test(r.qingPlan) && /河里已打 万6\/条0\/筒0/.test(r.qingBasis), JSON.stringify([r.qingPlan, r.qingBasis]));
chk('门清路线：未副露、红中未弃', /门清/.test(r.mqPlan) && /尚未副露/.test(r.mqBasis), JSON.stringify([r.mqPlan, r.mqBasis]));
chk('暗杠只算亮出 1 张（W 门子计数为 1）', r.angangMeldSuits.W === 1 && r.angangMeldSuits.T === 0, JSON.stringify(r.angangMeldSuits));
chk('反常对弃牌轨迹命中按家等张信号', r.sigOne >= 3 && r.sigTotal >= 3, JSON.stringify([r.sigOne, r.sigTotal]));
chk('全场汇总：20 张弃牌 + 1 组副露', r.full.total === 20 && r.full.meldTotal === 1, JSON.stringify(r.full));
chk('打法含角色公开风格与弃牌数字', r.playStyle.every(s => /已打 \d+ 张/.test(s)) && r.playStyle.some(s => /型|派/.test(s)), JSON.stringify(r.playStyle.map(s => s.slice(0, 30))));
chk('面板四栏顺序：牌型+推荐 → 对手 → 听牌 → 积分',
  /牌型分析/.test(r.panel.heads[0]) && /推荐打出/.test(r.panel.heads[0])
  && /对手分析/.test(r.panel.heads[1]) && /听牌一览/.test(r.panel.heads[2]) && /积分排行/.test(r.panel.heads[3]), JSON.stringify(r.panel.heads));
chk('第1栏含两块、第2栏为 tColOpp', r.panel.mainSecs === 2 && /tColOpp/.test(r.panel.classes[1]) && /tColMain/.test(r.panel.classes[0]));
chk('对手栏三家卡片、每家牌型+打法两行、含可见口径说明',
  r.panel.cards === 3 && r.panel.cardLines.every(n => n === 2) && r.panel.hasTwoLabels && r.panel.hasNote, JSON.stringify(r.panel));
chk('拖拽分隔条仍为 3 条', r.panel.splitters === 3);
chk('旧列宽键 banshanColWidths 不再生效', r.oldKeyIgnored === true);
chk('V2 列宽键正常生效', r.v2KeyApplied === true);
chk('教学 + 拆牌组合下仍四栏、三家卡片且无异常', !r.comboError && r.combo.cols === 4 && r.combo.cards === 3, JSON.stringify(r.combo));
chk('页面无 JS 报错', pageErrors.length === 0, pageErrors.join(' | '));

// ---------- 竖屏布局 ----------
const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
const p2Errors = [];
p2.on('pageerror', e => p2Errors.push(e.message));
await p2.addInitScript(() => {
  window.__noCloudExp = 1; window.__noSplitBar = 1;
  HTMLMediaElement.prototype.play = function () {
    const s = this; setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20);
    return Promise.resolve();
  };
});
await p2.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await p2.click('#startBtn');
await p2.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await p2.locator('.roleBtn').first().click();
await p2.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });
const port = await p2.evaluate(() => {
  teachOn = true; thinkOn = false; refreshDock(); updateTeachPanel();
  const opp = document.querySelector('.tColOpp');
  const dockEl = document.getElementById('bottomDock');
  const rect = opp.getBoundingClientRect();
  dockEl.scrollTop = rect.top - dockEl.getBoundingClientRect().top + dockEl.scrollTop;
  const after = opp.getBoundingClientRect(), dr = dockEl.getBoundingClientRect();
  return {
    cols: document.querySelectorAll('.tGrid .tCol').length,
    span: getComputedStyle(opp).gridColumn,
    reachable: after.top >= dr.top - 2 && after.top < dr.bottom - 40,
    cards: opp.querySelectorAll('.tOppCard').length,
    rows: [...document.querySelectorAll('.tGrid .tCol')].map(c => ({ head: (c.querySelector('.tColHead') || {}).textContent, top: Math.round(c.getBoundingClientRect().top) })),
  };
});
chk('竖屏四栏、对手栏跨整行且可滚动看到', port.cols === 4 && /1\s*\/\s*3|span 2/.test(port.span) && port.reachable, JSON.stringify(port));
chk('竖屏三家卡片齐全、顺序自上而下', port.cards === 3 && /牌型分析/.test(port.rows[0].head) && /对手分析/.test(port.rows[1].head)
  && /听牌一览/.test(port.rows[2].head) && /积分排行/.test(port.rows[3].head), JSON.stringify(port.rows));
chk('竖屏无 JS 报错', p2Errors.length === 0, p2Errors.join(' | '));

const pass = checks.every(c => c[1]);
console.log(pass ? `\nPASS: ${checks.length}/${checks.length} 教学面板对手分析列` : `\nFAIL: ${checks.filter(c => !c[1]).length} 项`);
await browser.close();
process.exit(pass ? 0 : 1);
