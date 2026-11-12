// 2026-11-12 手牌拆解回归测试（用户需求：按麻将通常规则分类；后续追加「拆牌方式」开关：默认正常打，点开才分组摆牌）
// 断言：①分组零重叠且覆盖全部手牌 ②标准牌型分类准确（顺子/刻子/对子/两面搭/嵌张搭/边张搭/孤张/红中）
//       ③每组进张正确 ④默认正常打牌（无拆解条、手牌原样）⑤点开后拆解条+手牌按同源分组分开摆放、可点选出牌
//       ⑥关闭恢复、状态持久化 ⑦实时刷新/折叠/竖屏不遮挡/教学面板统计同源
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
  ].find(p => fs.existsSync(p));
}

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: findBrowser() });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.addInitScript(() => {
  window.__noCloudExp = 1; // 禁云：测试数据不得写入真实云端
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
  null, { timeout: 30000 }
);

const checks = [];
const chk = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || '' });

// ---------- ① 默认：正常打牌（拆解条不出现、手牌原样不分组） ----------
const def = await page.evaluate(() => {
  const btn = document.getElementById('splitBtn'), sb = document.getElementById('splitBar'), hand = document.getElementById('hand');
  return {
    btn: !!btn, label: btn ? btn.textContent : '', active: btn ? btn.classList.contains('btnActive') : false,
    mode: splitMode, barHidden: getComputedStyle(sb).display === 'none',
    grouped: hand.classList.contains('splitHand'), grpN: hand.querySelectorAll(':scope > .hGrp').length,
    tiles: hand.querySelectorAll('.tile-photo').length, handN: p(0).hand.length,
    stored: localStorage.getItem('banshanSplitMode'),
  };
});
chk('顶部有「拆牌方式」按钮', def.btn && def.label === '拆牌方式', def.label);
chk('默认关闭：按钮未高亮、拆解条隐藏', !def.mode && !def.active && def.barHidden, JSON.stringify(def));
chk('默认正常打牌：手牌不分组、牌数与手牌一致', !def.grouped && def.grpN === 0 && def.tiles === def.handN, JSON.stringify(def));

// ---------- ② 纯函数层 ----------
const pure = await page.evaluate(() => {
  const me = p(0);
  const mk = (id, uid) => ({ id, uid, suit: id === 'Z' ? 'Z' : id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) });
  const setHand = ids => { me.hand = ids.map((id, i) => mk(id, 90000 + i)); me.melds = []; me.discard = []; };
  const brief = b => b.groups.map(g => ({
    type: g.type, label: g.label, tiles: g.tiles.join(','), ids: g.ids.join(','),
    draws: g.draws.map(d => d.id).join(','),
  }));
  const A = ['W1','W2','W3','W4','W5','T7','T7','B3','B5','B9','Z'];
  setHand(A);
  const bA = handBreakdown(me);
  const B = ['W5','W5','W5','T2','T3','T4','B8','B9','B1','B1','Z','Z'];
  setHand(B);
  const bB = handBreakdown(me);
  const C = ['W2','W3','W4','W5','T1','T2','T7','T9','B3','B3','B3','B8','Z'];
  setHand(C);
  const bC = handBreakdown(me);
  return { A, B, C, bA: { ...bA, groups: brief(bA) }, bB: { ...bB, groups: brief(bB) }, bC: { ...bC, groups: brief(bC) } };
});

const cover = (ids, b) => b.groups.reduce((n, g) => n + g.tiles.split(',').length, 0) + b.zN === ids.length;
chk('A 零重叠、覆盖全部 11 张', cover(pure.A, pure.bA), JSON.stringify(pure.bA.groups));
chk('B 零重叠、覆盖全部 12 张', cover(pure.B, pure.bB), JSON.stringify(pure.bB.groups));
chk('C 零重叠、覆盖全部 13 张', cover(pure.C, pure.bC), JSON.stringify(pure.bC.groups));
const types = arr => arr.map(g => g.type).sort().join(',');
chk('A 分类：顺子+两面搭+将牌+嵌张搭+孤张',
  types(pure.bA.groups) === 'chow,emb,pair,solo,two', types(pure.bA.groups));
chk('A 两面搭进张 = 三万/六万',
  pure.bA.groups.some(g => g.type === 'two' && g.draws === 'W3,W6'), JSON.stringify(pure.bA.groups));
chk('A 嵌张搭进张 = 四筒',
  pure.bA.groups.some(g => g.type === 'emb' && g.draws === 'B4'), JSON.stringify(pure.bA.groups));
chk('A 红中单列且不占实体组', pure.bA.zN === 1 && !pure.bA.groups.some(g => g.tiles.includes('中')));
chk('B 分类：刻子+顺子+边张搭+将牌',
  types(pure.bB.groups) === 'chow,edge,pair,pong', types(pure.bB.groups));
chk('B 边张搭 8/9 筒进张 = 七筒',
  pure.bB.groups.some(g => g.type === 'edge' && g.draws === 'B7'), JSON.stringify(pure.bB.groups));
chk('B 红中×2', pure.bB.zN === 2);
chk('C 分类含刻子与两面/嵌张/边张体系',
  pure.bC.groups.some(g => g.type === 'pong') && pure.bC.groups.some(g => g.type === 'edge'), types(pure.bC.groups));
chk('分组带 ids，供实体手牌按组归位', pure.bA.groups.every(g => g.ids.split(',').length === g.tiles.split(',').length)
  && pure.bA.groups.some(g => g.type === 'chow' && g.ids === 'W1,W2,W3'), JSON.stringify(pure.bA.groups));

// ---------- ③ 打开「拆牌方式」：拆解条 + 实体手牌同源分组 ----------
await page.click('#splitBtn');
const on = await page.evaluate(() => {
  const me = p(0), hand = document.getElementById('hand'), sb = document.getElementById('splitBar');
  const mk = (id, uid) => ({ id, uid, suit: id === 'Z' ? 'Z' : id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) });
  const setHand = ids => { me.hand = ids.map((id, i) => mk(id, 90000 + i)); me.melds = []; me.discard = []; render(); };
  setHand(['W1','W2','W3','W4','W5','T7','T7','B3','B5','B9','Z']);
  const b = handBreakdown(me);
  const grps = [...hand.querySelectorAll(':scope > .hGrp')];
  const uid2id = {}; for (const t of me.hand) uid2id[t.uid] = t.id;
  const dom = grps.map(g => ({
    type: [...g.classList].find(c => c.startsWith('h-') && c !== 'hGrp') || '',
    label: g.querySelector('.hLab').textContent,
    ids: [...g.querySelectorAll('.tile-photo')].map(t => uid2id[+t.dataset.uid]).join(','),
    border: getComputedStyle(g).borderTopWidth,
  }));
  return {
    mode: splitMode, active: document.getElementById('splitBtn').classList.contains('btnActive'),
    barShown: getComputedStyle(sb).display !== 'none', grouped: hand.classList.contains('splitHand'),
    stored: localStorage.getItem('banshanSplitMode'),
    src: b.groups.map(g => ({ type: g.type, label: g.label, ids: g.ids.join(',') })),
    dom, tiles: hand.querySelectorAll('.tile-photo').length, handN: me.hand.length,
    zN: b.zN,
    // 竖屏分组占两块高度：确保「出牌」按钮没被挤出座位区（overflow:hidden 会直接裁掉）
    actVisible: (() => {
      const a = document.getElementById('actions').getBoundingClientRect(), s = document.getElementById('seat0').getBoundingClientRect();
      const btn = document.querySelector('#actions button');
      return !!btn && a.height > 0 && a.top >= s.top - 2 && a.bottom <= s.bottom + 2;
    })(),
  };
});
chk('点开后模式生效：按钮高亮、拆解条出现、手牌进入分组态',
  on.mode && on.active && on.barShown && on.grouped && on.stored === '1', JSON.stringify({ mode: on.mode, active: on.active, barShown: on.barShown, grouped: on.grouped, stored: on.stored }));
chk('手牌分组数 = 拆解条实体组数 + 红中组', on.dom.length === on.src.length + (on.zN ? 1 : 0), JSON.stringify(on.dom.map(x => x.label)));
chk('每组牌面与 handBreakdown 的 ids 逐一对应（零重叠、不丢牌）',
  on.dom.filter(x => x.type !== 'h-joker' && x.type !== 'h-other').every((x, i) => x.ids === on.src[i].ids)
  && on.tiles === on.handN, JSON.stringify({ dom: on.dom, src: on.src }));
chk('组标签与拆解条同源（顺子/两面搭/将牌/嵌张搭/孤张/红中）',
  ['顺子','两面搭','将牌','嵌张搭','孤张','红中'].every(s => on.dom.some(x => x.label.includes(s))), on.dom.map(x => x.label).join('|'));
chk('每组有独立边框、视觉上分开摆放', on.dom.every(x => parseFloat(x.border) > 0), on.dom.map(x => x.border).join(','));
chk('竖屏分组态「出牌」按钮完整可见（未被座位裁切）', on.actVisible);

// 点选一张牌仍可正常选中（分组容器不能破坏点击链路）
await page.locator('#hand .tile-photo').first().click();
const sel = await page.evaluate(() => ({ selN: document.querySelectorAll('#hand .tile-photo.sel').length, picked: !!G._sel }));
chk('分组摆牌下点选出牌链路仍可用', sel.selN === 1 && sel.picked, JSON.stringify(sel));

// ---------- ④ UI 层：实时、折叠、红中硬规则、竖屏几何、教学统计同源 ----------
const ui = await page.evaluate(() => {
  const me = p(0);
  const mk = (id, uid) => ({ id, uid, suit: id === 'Z' ? 'Z' : id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) });
  const setHand = ids => { me.hand = ids.map((id, i) => mk(id, 90000 + i)); me.melds = []; me.discard = []; render(); };
  const sb = document.getElementById('splitBar');
  const out = {};
  out.exists = !!sb;
  out.visible = sb && getComputedStyle(sb).display !== 'none';
  setHand(['W1','W2','W3','W4','W5','T7','T7','B3','B5','B9','Z']);
  out.first = document.getElementById('sbBody').textContent;
  out.sum1 = document.getElementById('sbSum').textContent;
  setHand(['W5','W5','W5','T2','T3','T4','B8','B9','B1','B1','Z','Z']);
  out.second = document.getElementById('sbBody').textContent;
  out.sum2 = document.getElementById('sbSum').textContent;
  out.handRegrouped = document.querySelectorAll('#hand > .hGrp').length > 0
    && [...document.querySelectorAll('#hand > .hGrp .hLab')].some(x => x.textContent.includes('刻子'));
  out.zRule = document.getElementById('sbBody').textContent.includes('须先打 1 只才能胡');
  document.getElementById('sbHead').click();
  out.folded = sb.classList.contains('fold') && localStorage.getItem('banshanSplitBar') === '0';
  document.getElementById('sbHead').click();
  out.unfolded = !sb.classList.contains('fold') && localStorage.getItem('banshanSplitBar') === '1';
  const r = sb.getBoundingClientRect(), body = document.getElementById('sbBody'), hand = document.getElementById('hand');
  out.rect = { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight };
  out.wrap = getComputedStyle(body).flexWrap === 'wrap';
  out.noOverflow = body.scrollWidth <= body.clientWidth + 1;
  const grps = body.querySelectorAll('.sbGrp'), last = grps[grps.length - 1];
  out.allShown = !!last && last.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 2;
  out.handVisible = !!hand && hand.getBoundingClientRect().height > 10;
  if (!teachOn) teachOn = true;
  updateTeachPanel();
  const th = document.querySelector('.tHealth');
  if (th) {
    const m = {};
    th.textContent.replace(/(红中|顺子|对子|刻子|两面搭|嵌张|边张|孤张)\s*(\d+)/g, (a, k, v) => { m[k] = +v; return a; });
    const bb = handBreakdown(me), cc = { chow: 0, pong: 0, pair: 0, two: 0, emb: 0, edge: 0, solo: 0 };
    for (const g of bb.groups) cc[g.type]++;
    out.sameSource = m['红中'] === bb.zN && m['顺子'] === cc.chow && m['对子'] === cc.pair
      && m['刻子'] === cc.pong && m['两面搭'] === cc.two && m['嵌张'] === cc.emb
      && m['边张'] === cc.edge && m['孤张'] === cc.solo;
    out.health = th.textContent;
  } else out.sameSource = false;
  return out;
});
chk('拆解条在拆牌方式下可见（不依赖教学模式）', ui.exists && ui.visible);
chk('A 局面 UI 含顺子/两面搭/红中', ['顺子','两面搭','红中'].every(s => ui.first.includes(s)), ui.first.slice(0, 200));
chk('A 局面显示向听/进张摘要', /向听|已听牌|已胡牌/.test(ui.sum1), ui.sum1);
chk('换牌后实时刷新（出现刻子、不再有旧两面搭）',
  ui.second.includes('刻子') && !ui.second.includes('两面搭') && ui.first !== ui.second, ui.second.slice(0, 200));
chk('换牌后实体手牌同步重新分组（出现刻子组）', ui.handRegrouped);
chk('B 局面红中×2 提示须先打 1 只', ui.zRule);
chk('折叠/展开与持久化', ui.folded && ui.unfolded);
chk('竖屏拆解条在视口内', ui.rect.top >= 0 && ui.rect.bottom <= ui.rect.vh && ui.rect.right <= ui.rect.vw + 1, JSON.stringify(ui.rect));
chk('竖屏自动换行、全部分组可见且手牌未被挤没',
  ui.wrap && ui.noOverflow && ui.allShown && ui.handVisible,
  'wrap=' + ui.wrap + ' noOverflow=' + ui.noOverflow + ' allShown=' + ui.allShown + ' hand=' + ui.handVisible);
chk('牌型分析统计与拆解条同源、数字不再打架', ui.sameSource, ui.health);

// ---------- ⑤ 关闭：恢复正常打牌 ----------
await page.click('#splitBtn');
const off = await page.evaluate(() => {
  const hand = document.getElementById('hand'), sb = document.getElementById('splitBar');
  return {
    mode: splitMode, active: document.getElementById('splitBtn').classList.contains('btnActive'),
    barHidden: getComputedStyle(sb).display === 'none', grouped: hand.classList.contains('splitHand'),
    grpN: hand.querySelectorAll(':scope > .hGrp').length,
    tiles: hand.querySelectorAll('.tile-photo').length, handN: p(0).hand.length,
    stored: localStorage.getItem('banshanSplitMode'),
  };
});
chk('关闭后恢复正常打牌：拆解条隐藏、手牌不分组、牌数不丢',
  !off.mode && !off.active && off.barHidden && !off.grouped && off.grpN === 0 && off.tiles === off.handN && off.stored === '0',
  JSON.stringify(off));

// ---------- ⑥ 模式跨会话持久化 ----------
const page2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page2.on('pageerror', e => pageErrors.push('page2: ' + e.message));
await page2.addInitScript(() => {
  window.__noCloudExp = 1;
  localStorage.setItem('banshanSplitMode', '1');
});
await page2.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
const persisted = await page2.evaluate(() => ({ mode: splitMode, active: document.getElementById('splitBtn').classList.contains('btnActive') }));
chk('拆牌方式状态跨会话持久化并同步按钮高亮', persisted.mode && persisted.active, JSON.stringify(persisted));
await page2.close();

chk('无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
let fail = 0;
for (const c of checks) { console.log((c.ok ? '✓ ' : '✗ ') + c.name + (c.ok ? '' : '  → ' + c.detail)); if (!c.ok) fail++; }
console.log(fail ? `FAIL ${fail}/${checks.length}` : `PASS ${checks.length}/${checks.length}`);
process.exit(fail ? 1 : 0);
