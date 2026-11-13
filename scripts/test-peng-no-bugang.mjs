// 2026-11-13 用户复核规则：「之前碰过，手里还有一只，留在手中的牌不能拿来杠」
// 即 2026-11-11 定稿的「碰后不补杠」：手里 3 张同牌 + 别家第 4 张只碰不杠 → 该碰牌本局禁补杠。
// 断言：源码链路、运行期标记/排除/强杠拦截、玩家 UI 不给补杠按钮、AI 托管不补、
//       留手那张仍是普通手牌（可打出/可参与胡牌）、常规 2 张碰后摸第 4 张仍可补、
//       规则弹窗与全部攻略文案口径一致（不得残留「碰完还能杠」）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const HTML = fs.readFileSync(FILE, 'utf8');
const DOC = fs.readFileSync(path.join(ROOT, 'docs', '最优打法建议.md'), 'utf8');
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
chk('源码：doPeng 在碰时手里有 3 张同牌时打 noBugang 标记',
  HTML.includes('function doPeng(pl,id){const held=pl.hand.filter(x=>x.id===id).length;') &&
  HTML.includes("const m={type:'peng',base:id,tiles:t};if(held>=3)m.noBugang=true;"));
chk('源码：findBuGang 排除带标记的碰牌，doGang 再做二次拦截',
  HTML.includes("m.type==='peng'&&!m.noBugang&&pl.hand.some(t=>t.id===m.base)") &&
  HTML.includes("if(kind==='bugang'&&!pl.melds.some(m=>m.type==='peng'&&m.base===id&&!m.noBugang))return;") &&
  HTML.includes("const m=pl.melds.find(x=>x.base===id&&x.type==='peng'&&!x.noBugang);if(!m)return;"));
chk('源码：玩家 / AI / 超时代打三条补杠路径都走 findBuGang',
  HTML.includes("for(const id of o.bu)mk('补杠 '+id") &&
  HTML.includes("const an=findAnGang(me),bu=findBuGang(me)") &&
  HTML.includes("const an=canG?findAnGang(cur):[],bu=canG?findBuGang(cur):[]") &&
  HTML.includes("const bu=findBuGang(cur);if(bu.length&&aiWantClaim"));
chk('源码：规则弹窗明文「碰后不补杠」并澄清留手那张仍是普通手牌',
  HTML.includes('碰后不补杠（2026-11-11 规则）') &&
  HTML.includes('不允许再补杠') &&
  /留在手里的?那张牌仍是普通手牌/.test(HTML) &&
  HTML.includes('可打出、可参与胡牌'));
chk('文案：游戏内与攻略文档均无「碰完还能杠」旧规则残留',
  !HTML.includes('碰完还能杠') && !DOC.includes('碰完还能杠') &&
  (HTML.match(/碰后不补杠/g) || []).length >= 2);
chk('文案：攻略三处已改为碰后不补杠口径',
  (HTML.match(/本局(?:再)?(?:也)?不能(?:再)?补杠|本局禁补杠/g) || []).length >= 2 &&
  (DOC.match(/不能再补杠|禁补杠/g) || []).length >= 2);

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1; window.__noSplitBar = 1;
  HTMLMediaElement.prototype.play = function () {
    const s = this;
    setTimeout(() => { if (typeof s.onended === 'function') s.onended(); }, 20);
    return Promise.resolve();
  };
});
await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 15000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard', null, { timeout: 60000 });

// ② 运行期：手里 3 张 W5 只碰不杠
const scene = await page.evaluate(() => {
  const pl = p(0);
  const save = { hand: pl.hand.slice(), melds: pl.melds.slice(), gs: G.players.map(x => x.gangScore), awaiting: G.awaiting, hr: G.humanResolve };
  const mk = (id, u) => ({ id, uid: u, suit: id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) });
  const filler = n => Array.from({ length: n }, (_, i) => mk(['T1', 'T4', 'B7', 'B9', 'W9', 'T6', 'B1', 'W2', 'T8', 'B5'][i % 10], 92000 + i));
  const out = {};
  try {
    pl.hand = [mk('W5', 91001), mk('W5', 91002), mk('W5', 91003), ...filler(10)];
    pl.melds = [];
    doPeng(pl, 'W5');
    out.marked = pl.melds[0].noBugang === true;
    out.leftOne = pl.hand.filter(t => t.id === 'W5').length === 1;
    out.excluded = !findBuGang(pl).includes('W5');
    out.noAnGang = !findAnGang(pl).some(t => t.id === 'W5');
    out.noMingGang = canMingGang(pl, 'W5') === false;
    const gs0 = G.players.map(x => x.gangScore);
    doGang(pl, 'bugang', 'W5');                       // 强行调用也必须被拦
    out.stillPeng = pl.melds[0].type === 'peng' && pl.melds[0].tiles.length === 2;
    out.handUnchanged = pl.hand.filter(t => t.id === 'W5').length === 1;
    out.scoreUnchanged = G.players.every((x, i) => x.gangScore === gs0[i]);

    // 玩家自摸杠界面：只应出现「不杠」，不得出现「补杠 W5」
    G.awaiting = 'gangself';
    renderActions({ an: findAnGang(pl), bu: findBuGang(pl) });
    const btns = [...document.querySelectorAll('#actions button')].map(b => b.textContent.trim());
    out.uiButtons = btns;
    out.uiNoBu = !btns.some(t => t.includes('补杠'));

    // 超时 AI 代打：不得选中补杠
    let captured = null;
    const origRespond = window.humanRespond;
    window.humanRespond = v => { captured = v; };
    G.humanResolve = () => { };
    try { takeOverByAI(); } catch (e) { out.aiErr = String(e); }
    window.humanRespond = origRespond;
    out.aiCaptured = captured;
    out.aiNoBu = !captured || !captured.kind || captured.kind !== 'bu';

    // 留手那张仍是普通手牌：可打出、可参与向听/听张计算
    G.awaiting = 'discard';
    const sh = calcShanten(pl.hand, pl.melds);
    out.shantenOK = Number.isFinite(sh);
    const tile = pl.hand.find(t => t.id === 'W5');
    out.canDiscard = !!tile;
    discardTile(pl, tile);
    out.discarded = pl.discard.some(t => t.id === 'W5') && !pl.hand.some(t => t.id === 'W5');
  } catch (e) { out.err = String(e); }
  pl.hand = save.hand; pl.melds = save.melds;
  G.players.forEach((x, i) => x.gangScore = save.gs[i]);
  G.awaiting = save.awaiting; G.humanResolve = save.hr;
  renderActions({});
  return out;
});

chk('运行期：3 张同牌只碰 → 该碰牌打上 noBugang，手里正好留 1 张',
  scene.marked && scene.leftOne, JSON.stringify({ marked: scene.marked, leftOne: scene.leftOne }));
chk('运行期：补杠选项被排除，暗杠/明杠渠道也都不成立（4 张已全见）',
  scene.excluded && scene.noAnGang && scene.noMingGang,
  JSON.stringify({ excluded: scene.excluded, noAnGang: scene.noAnGang, noMingGang: scene.noMingGang }));
chk('运行期：强行调用 doGang 补杠被拦截（牌型/手牌/杠分均不变）',
  scene.stillPeng && scene.handUnchanged && scene.scoreUnchanged && !scene.err,
  JSON.stringify({ stillPeng: scene.stillPeng, handUnchanged: scene.handUnchanged, scoreUnchanged: scene.scoreUnchanged, err: scene.err }));
chk('运行期：自摸杠界面不给「补杠」按钮',
  scene.uiNoBu, JSON.stringify(scene.uiButtons));
chk('运行期：超时 AI 代打也不会补这组牌',
  scene.aiNoBu && !scene.aiErr, JSON.stringify({ captured: scene.aiCaptured, err: scene.aiErr }));
chk('运行期：留在手里那张仍是普通手牌（可打出、参与向听计算）',
  scene.shantenOK && scene.canDiscard && scene.discarded,
  JSON.stringify({ shantenOK: scene.shantenOK, canDiscard: scene.canDiscard, discarded: scene.discarded }));

// ③ 不受影响的两种常规杠
const normal = await page.evaluate(() => {
  const pl = p(0);
  const save = { hand: pl.hand.slice(), melds: pl.melds.slice(), gs: G.players.map(x => x.gangScore) };
  const mk = (id, u) => ({ id, uid: u, suit: id[0], rank: parseInt(id[1], 10) });
  const filler = n => Array.from({ length: n }, (_, i) => mk(['T1', 'T4', 'B7', 'B9', 'W9', 'T6', 'B1', 'W2', 'T8', 'B5'][i % 10], 94000 + i));
  const out = {};
  try {
    // 常规：手里 2 张碰，之后自己摸到第 4 张 → 允许补杠
    pl.hand = [mk('B3', 93001), mk('B3', 93002), ...filler(10)];
    pl.melds = [];
    doPeng(pl, 'B3');
    out.unmarked = !pl.melds[0].noBugang;
    pl.hand.push(mk('B3', 93099));
    out.allowed = findBuGang(pl).includes('B3');
    doGang(pl, 'bugang', 'B3');
    out.ganged = pl.melds[0].type === 'bugang' && pl.melds[0].tiles.length === 3;
    // 当时直接明杠不受限
    pl.hand = [mk('T7', 95001), mk('T7', 95002), mk('T7', 95003), ...filler(10)];
    pl.melds = [];
    doGang(pl, 'minggang', 'T7');
    out.ming = pl.melds[0].type === 'minggang' && pl.melds[0].tiles.length === 3;
  } catch (e) { out.err = String(e); }
  pl.hand = save.hand; pl.melds = save.melds;
  G.players.forEach((x, i) => x.gangScore = save.gs[i]);
  return out;
});
chk('常规补杠不受影响：2 张碰后自摸第 4 张仍可补杠',
  normal.unmarked && normal.allowed && normal.ganged && !normal.err, JSON.stringify(normal));
chk('当时直接明杠不受限', normal.ming === true, JSON.stringify(normal));

// ④ 运行期文案
const modalText = await page.evaluate(() => document.getElementById('rulesModal').textContent);
chk('运行期规则弹窗：明文禁补杠 + 澄清留手那张牌仍可用',
  modalText.includes('碰后不补杠') && modalText.includes('不允许再补杠') &&
  modalText.includes('留在手里的那张牌仍是普通手牌') && modalText.includes('可打出、可参与胡牌'));
chk('零 JS 运行时异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
const pass = results.filter(r => r.ok).length;
console.log(`\n结果：${pass}/${results.length} 通过`);
if (pass !== results.length) process.exit(1);
