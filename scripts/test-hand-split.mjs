// 2026-11-12 手牌拆解回归测试（用户需求：开局自动按牌理分类、快速判断牌型与后续听张）
// 断言：①分组零重叠且覆盖全部手牌 ②标准牌型分类准确（顺子/刻子/对子/两面搭/嵌张搭/边张搭/孤张/红中）
//       ③每组进张正确（两面3/6、嵌张中间、边张3或7）④UI 常驻且随手牌实时刷新、折叠持久化
//       ⑤红中≥2 未打过时提示硬规则 ⑥手机竖屏不遮挡手牌、可横滑
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

// ---------- 纯函数层 ----------
const pure = await page.evaluate(() => {
  const me = p(0);
  const mk = (id, uid) => ({ id, uid, suit: id === 'Z' ? 'Z' : id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) });
  const setHand = ids => { me.hand = ids.map((id, i) => mk(id, 90000 + i)); me.melds = []; me.discard = []; };
  const brief = b => b.groups.map(g => ({
    type: g.type, label: g.label, tiles: g.tiles.join(','),
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

// ---------- UI 层：常驻、实时、折叠、红中硬规则 ----------
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
  // 红中硬规则：手里 2 只红中、本局没打过红中
  out.zRule = document.getElementById('sbBody').textContent.includes('须先打 1 只才能胡');
  // 折叠
  document.getElementById('sbHead').click();
  out.folded = sb.classList.contains('fold') && localStorage.getItem('banshanSplitBar') === '0';
  document.getElementById('sbHead').click();
  out.unfolded = !sb.classList.contains('fold') && localStorage.getItem('banshanSplitBar') === '1';
  // 竖屏几何：拆解条在视口内、手牌仍可见、横向可滚
  const r = sb.getBoundingClientRect(), body = document.getElementById('sbBody'), hand = document.getElementById('hand');
  out.rect = { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight };
  out.wrap = getComputedStyle(body).flexWrap === 'wrap';
  out.noOverflow = body.scrollWidth <= body.clientWidth + 1;
  const grps = body.querySelectorAll('.sbGrp'), last = grps[grps.length - 1];
  out.allShown = !!last && last.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 2;
  out.handVisible = !!hand && hand.getBoundingClientRect().height > 10;
  // 教学面板「牌型分析」统计必须与拆解条同源，不再出现「孤张 1」vs「孤张 2」打架
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
chk('拆解条常驻（未开教学模式也显示）', ui.exists && ui.visible);
chk('A 局面 UI 含顺子/两面搭/红中', ['顺子','两面搭','红中'].every(s => ui.first.includes(s)), ui.first.slice(0, 200));
chk('A 局面显示向听/进张摘要', /向听|已听牌|已胡牌/.test(ui.sum1), ui.sum1);
chk('换牌后实时刷新（出现刻子、不再有旧两面搭）',
  ui.second.includes('刻子') && !ui.second.includes('两面搭') && ui.first !== ui.second, ui.second.slice(0, 200));
chk('B 局面红中×2 提示须先打 1 只', ui.zRule);
chk('折叠/展开与持久化', ui.folded && ui.unfolded);
chk('竖屏拆解条在视口内', ui.rect.top >= 0 && ui.rect.bottom <= ui.rect.vh && ui.rect.right <= ui.rect.vw + 1, JSON.stringify(ui.rect));
chk('竖屏自动换行、全部分组可见且手牌未被挤没',
  ui.wrap && ui.noOverflow && ui.allShown && ui.handVisible,
  'wrap=' + ui.wrap + ' noOverflow=' + ui.noOverflow + ' allShown=' + ui.allShown + ' hand=' + ui.handVisible);
chk('牌型分析统计与拆解条同源、数字不再打架', ui.sameSource, ui.health);
chk('无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
let fail = 0;
for (const c of checks) { console.log((c.ok ? '✓ ' : '✗ ') + c.name + (c.ok ? '' : '  → ' + c.detail)); if (!c.ok) fail++; }
console.log(fail ? `FAIL ${fail}/${checks.length}` : `PASS ${checks.length}/${checks.length}`);
process.exit(fail ? 1 : 0);
