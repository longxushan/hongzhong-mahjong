// 2026-11-11 牌型分析精准性回归测试（用户需求：主做牌型要精准并实时更新）
// 断言：①碰一组+顺子结构不再误报碰碰胡（原逻辑有副露就锁死全碰且 G.pongCommit 粘滞）
//       ②豪华对（四张算两对）七对成型度不被低估，主做与推荐姿态（bigHandStance）同源一致
//       ③清一色判定实时重算不依赖粘滞状态 ④页面无 pongCommit 残留引用
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

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
await page.waitForFunction(
  () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard',
  null, { timeout: 30000 }
);

const results = await page.evaluate(() => {
  const out = [];
  const me = p(0);
  const mk = (id, uid) => ({ id, uid, suit: id === 'Z' ? 'Z' : id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) });
  const setHand = ids => { me.hand = ids.map((id, i) => mk(id, 90000 + i)); };
  const probe = (label, handIds, meldList) => {
    setHand(handIds);
    me.melds = (meldList || []).map(t => ({ type: 'peng', tiles: [mk(t, 91001), mk(t, 91002), mk(t, 91003)] }));
    const t0 = performance.now();
    const d = handDiagnose(me);
    const pick = teachPick(d);
    const ht = recommendHandType(d, me);
    out.push({
      label, ms: Math.round(performance.now() - t0),
      plan: ht.planName, stanceKind: pick.stance ? pick.stance.kind : null,
      pick: pick.id, pairCount7: d.pairCount7,
    });
  };

  // B：碰一组筒子 + 手里全是顺子结构 → 应判普通自摸胡（非碰碰胡）
  probe('B', ['W1','W2','W3','W7','W8','W9','T2','T3','T4','T7','T8','T9','W5'], ['B3']);
  // C：碰一组 + 清一色万 10 张 → 清一色（实时算，不靠粘滞状态）
  probe('C', ['W1','W2','W3','W5','W6','W7','W9','W9','T5','W4','W8'], ['B3']);
  // D：W2×4 + 三对（豪华七对实际 5 对成型）→ 七小对，与推荐姿态同源
  probe('D', ['W2','W2','W2','W2','T5','T5','B7','B7','W9','W9','T3'], []);
  // E：4 对 + 顺子一向听 → 七小对（七对口径成型 5 对，牌型分析与推荐一致）
  probe('E', ['W2','W2','T5','T5','B7','B7','W9','W9','T3','T4','T5','B1','B2'], []);
  // B'：探针后再切回顺子结构 → 主做应实时从七对切回基本（无粘滞）
  probe('B2', ['W1','W2','W3','W7','W8','W9','T2','T3','T4','T7','T8','T9','W5'], ['B3']);
  return out;
});

console.log(JSON.stringify(results, null, 2));
const by = l => results.find(r => r.label === l);
const STANCE_PLAN = { qing: '清一色', seven: '七小对', pong: '碰碰胡' };
let pass = true;
const chk = (cond, msg) => { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) pass = false; };

chk(by('B').plan === '普通自摸胡', 'B 碰1组+全顺子结构 → 普通自摸胡（不再误报碰碰胡）');
chk(by('C').plan === '清一色' && by('C').stanceKind === 'qing', 'C 清一色万10张 → 清一色，与推荐姿态同源');
chk(by('D').plan === '七小对' && by('D').stanceKind === 'seven' && by('D').pairCount7 === 5, 'D W2×4+三对 → 七小对（豪华对算两对，成型5对）+ 姿态一致');
chk(by('E').plan === '七小对' && by('E').stanceKind === 'seven', 'E 4对一向听 → 七小对，与推荐姿态一致');
chk(by('B2').plan === '普通自摸胡', 'B2 手牌切回顺子结构 → 主做实时切回普通自摸胡（无粘滞）');
for (const r of results) {
  if (r.stanceKind) chk(STANCE_PLAN[r.stanceKind] === r.plan, r.label + ' 主做=' + r.plan + ' 与姿态 kind=' + r.stanceKind + ' 一致');
  chk(r.ms < 300, r.label + ' 计算耗时 ' + r.ms + 'ms < 300ms（实时更新可用）');
}
const src = fs.readFileSync(FILE, 'utf8');
chk(!src.includes('G.pongCommit'), '页面无 G.pongCommit 粘滞状态代码引用（仅注释提及）');
chk(pageErrors.length === 0, '页面零 JS 报错');
console.log(pass ? 'PASS: 牌型分析精准且与推荐同源、实时无粘滞' : 'FAIL: 需调整');
await browser.close();
process.exit(pass ? 0 : 1);
