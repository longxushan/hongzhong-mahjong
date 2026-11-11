// 大牌姿态功能测试：npm run test-stance
// 构造清一色/七对/碰碰胡手牌，验证 teachPick 切换大牌导向、liveWarn 宽容、AI 敢做大牌
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
  ];
  return candidates.find(p => fs.existsSync(p));
}

let chromium;
try { ({ chromium } = await import('playwright-core')); } catch (e) { console.error('缺少 playwright-core'); process.exit(1); }
const browserPath = findBrowser();
if (!browserPath) { console.error('未找到浏览器'); process.exit(1); }

const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load' });
await page.evaluate(() => { CFG.diceMs = 40; CFG.diceGap = 20; CFG.diceAuto = 30; CFG.diceHold = 40; });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G && G.awaiting === 'discard' && p(0).hand.length === 14, null, { timeout: 30000 }); // 冷启动 Edge 掷骰链路约 10s，15s 偶发超时

// 换手牌工具：普通牌 id → 牌对象（uid 伪造，不参与全局计数，仅用于引擎计算）
const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : '')); }

await page.evaluate(() => { window.__mk = (id, uid) => ({ id, uid, suit: id[0], rank: id === 'Z' ? 0 : parseInt(id[1], 10) }); });

// 用例1：清一色姿态——11万+3条（含一个条子两面搭），应建议打条子
const r1 = await page.evaluate(() => {
  const me = p(0);
  const ids = ['W1','W2','W3','W4','W5','W6','W7','W8','W9','W2','W5','T3','T4','T5'];
  me.hand = ids.map((x, i) => window.__mk(x, 900000 + i));
  const d = handDiagnose(me), pick = teachPick(d);
  return { stance: pick.stance ? pick.stance.name : null, pickId: pick.id, pickIsT: pick.id[0] === 'T', kou: pick.kou.slice(0, 30) };
});
check('清一色姿态：识别 + 建议打条子（非主色）', r1.stance && r1.pickIsT, `姿态=${r1.stance}，建议=${r1.pickId}`);

// 用例2：清一色 liveWarn 宽容——玩家手选另一张条子 T3（非首推），应显示方向正确而非打亏
const r2 = await page.evaluate(() => {
  const me = p(0);
  liveWarn(me.hand.find(t => t.id === 'T3'));
  const el = document.getElementById('liveWarn');
  const good = el.className.includes('warnGood') && !el.innerHTML.includes('打亏');
  const txt = el.innerHTML.slice(0, 60);
  clearWarn();
  return { good, txt };
});
check('清一色姿态 liveWarn：选非首推的别色牌不再报打亏', r2.good, r2.txt);

// 用例3：七对姿态——6对+2散张，应建议打散张、绝不拆对
const r3 = await page.evaluate(() => {
  const me = p(0);
  const ids = ['W1','W1','W3','W3','W5','W5','T2','T2','T7','T7','B4','B4','B9','W6'];
  me.hand = ids.map((x, i) => window.__mk(x, 910000 + i));
  const d = handDiagnose(me), pick = teachPick(d);
  const cnt = {}; for (const t of me.hand) cnt[t.id] = (cnt[t.id] || 0) + 1;
  const pickIsPair = cnt[pick.id] >= 2;
  return { stance: pick.stance ? pick.stance.name : null, pickId: pick.id, pickIsPair };
});
check('七对姿态：识别 + 建议打孤张、不拆对子', r3.stance && r3.stance.includes('七对') && !r3.pickIsPair, `姿态=${r3.stance}，建议=${r3.pickId}（对子=${r3.pickIsPair}）`);

// 用例4：碰碰胡姿态——2刻+3对+散张（刻子≥2优先碰碰胡而非七对），应打散张、保对刻
const r4 = await page.evaluate(() => {
  const me = p(0);
  const ids = ['W1','W1','W1','T3','T3','T3','B5','B5','B7','B7','W9','W9','T6','T8'];
  me.hand = ids.map((x, i) => window.__mk(x, 920000 + i));
  const d = handDiagnose(me), pick = teachPick(d);
  const cnt = {}; for (const t of me.hand) cnt[t.id] = (cnt[t.id] || 0) + 1;
  const pickIsPairOrPong = cnt[pick.id] >= 2;
  return { stance: pick.stance ? pick.stance.name : null, pickId: pick.id, pickIsPairOrPong };
});
check('碰碰胡姿态：识别 + 建议打散张、保对刻', r4.stance && r4.stance.includes('碰碰胡') && !r4.pickIsPairOrPong, `姿态=${r4.stance}，建议=${r4.pickId}`);

// 用例5：普通杂牌——无姿态、保持向听最优精算
const r5 = await page.evaluate(() => {
  const me = p(0);
  const ids = ['W1','W4','T2','T5','T8','B1','B3','B5','B7','B9','W7','T7','W9','B2'];
  me.hand = ids.map((x, i) => window.__mk(x, 930000 + i));
  const d = handDiagnose(me), pick = teachPick(d);
  const seen = {}, shs = [];
  for (const t of me.hand) { if (seen[t.id] || t.id === 'Z') continue; seen[t.id] = 1; shs.push(calcShanten(me.hand.filter(x => x.uid !== t.uid), me.melds)); }
  const minSh = Math.min(...shs);
  const pickSh = calcShanten(me.hand.filter(x => x.id !== pick.id), me.melds);
  return { stance: pick.stance ? pick.stance.name : null, optimal: pickSh === minSh };
});
check('普通杂牌：无姿态、向听最优', !r5.stance && r5.optimal, `姿态=${r5.stance}，向听最优=${r5.optimal}`);

// 用例6：AI 大牌决断——grand 风格 AI 拿清一色牌，masterDiscard 应打别色
const r6 = await page.evaluate(() => {
  const ai = p(1); ai.style = 'grand';
  const ids = ['W1','W2','W3','W4','W5','W6','W7','W8','W9','W3','W6','B5','B8','T4'];
  ai.hand = ids.map((x, i) => window.__mk(x, 940000 + i));
  const d = handDiagnose(ai), st = bigHandStance(ai, d, 1 - (MASTER_PROFILE.grand.big));
  const md = masterDiscard(ai);
  return { stance: st ? st.name : null, mdId: md ? md.id : null, mdIsOffSuit: md && md.id !== 'Z' && md.id[0] !== d.mainSuit };
});
check('AI（grand）清一色姿态：masterDiscard 敢打别色', r6.mdIsOffSuit, `姿态=${r6.stance}，AI打出=${r6.mdId}`);

// 用例7：AI 保守型——成型度不足时（主色 9 张但别色好搭向听领先），仍能按高门槛判定
const r7 = await page.evaluate(() => {
  const ai = p(2); ai.style = 'conservative';
  const ids = ['W1','W2','W3','W4','W5','W6','W7','W8','W9','T3','T4','T5','T6','T7'];
  ai.hand = ids.map((x, i) => window.__mk(x, 950000 + i));
  const d = handDiagnose(ai);
  const st = bigHandStance(ai, d, 1 - MASTER_PROFILE.conservative.big);
  const md = masterDiscard(ai);
  return { stance: st ? st.name : null, mdId: md ? md.id : null, isWan: md && md.id[0] === 'W' };
});
check('AI（conservative）门槛更高：主色仅9张时不锁清一色、按精算', !r7.stance || r7.isWan, `姿态=${r7.stance}，AI打出=${r7.mdId}`);

// 用例8：RISK 冒险档分化——激进/大牌/进修型敢慢 3 步、容忍碰退 1 步；保守/沉稳型严格
const r8 = await page.evaluate(() => {
  const a = RISK.aggressive, c = RISK.conservative, g = RISK.grand, s = RISK.steady, l = RISK.learning;
  return { aGap: a.safeGap, gGap: g.safeGap, lGap: l.safeGap, cGap: c.safeGap, sGap: s.safeGap, aTol: a.pengTol, cTol: c.pengTol };
});
check('RISK 冒险档分化（safeGap/pengTol）', r8.aGap===3 && r8.gGap===3 && r8.lGap===3 && r8.cGap===2 && r8.sGap===2 && r8.aTol===1 && r8.cTol===0, `激进${r8.aGap}步/容忍${r8.aTol}，保守${r8.cGap}步/容忍${r8.cTol}，沉稳${r8.sGap}步`);

// 用例9：大牌宣言——grand 首次锁姿态说一次性格宣言、重复不播（2026-11-10 起对局角色语音默认关 ROLE_VOICE_ON=false：宣言走 toast 字幕；语音开关打开时恢复 vpPlay role/ 通道）
const r9 = await page.evaluate(() => {
  const ai = p(1); ai.style = 'grand';
  const ids = ['W1','W2','W3','W4','W5','W6','W7','W8','W9','W3','W6','B5','B8','T4'];
  ai.hand = ids.map((x, i) => window.__mk(x, 960000 + i));
  G._stanceSaid = {}; // 重置宣言标记（用例6已触发过一次），验证「首次播、重复不播」
  let said = 0, txt = '';
  const backup = toast;
  window.toast = function (t) { if (typeof t === 'string' && t.indexOf('：') > 0) { said++; txt = t; } return backup.call(null, t); };
  masterDiscard(ai); masterDiscard(ai); // 连续两次：宣言只应播一次
  window.toast = backup;
  return { said, txt, marked: !!(G._stanceSaid && G._stanceSaid[ai.seat]), voiceOff: typeof ROLE_VOICE_ON !== 'undefined' && ROLE_VOICE_ON === false };
});
check('大牌宣言：grand 首次锁姿态只播一次（字幕通道）', r9.said === 1 && r9.marked && r9.voiceOff && r9.txt.length > 5, `字幕宣言 ${r9.said} 次：「${r9.txt}」，语音开关默认关=${r9.voiceOff}`);

// 用例10：清一色姿态碰方向保护——别色对子拒碰、主色对子走向听比较
const r10 = await page.evaluate(() => {
  const ai = p(2); ai.style = 'grand';
  const ids = ['W1','W2','W3','W4','W5','W6','W7','W8','W9','W3','W6','B5','B5'];
  ai.hand = ids.map((x, i) => window.__mk(x, 970000 + i));
  return { offSuit: masterClaim(ai, 'B5', 'peng'), mainSuit: masterClaim(ai, 'W4', 'peng') };
});
check('清一色姿态：别色对子拒碰', r10.offSuit === false, `别色碰=${r10.offSuit}（主色走向听比较=${r10.mainSuit}）`);

// 用例11：碰容忍差异——若探测到 after=before+1 的碰：激进过闸、保守必拒（随机固定 0.5，纯测 tol）
const r11 = await page.evaluate(() => {
  const ai = p(3);
  const decks = [
    ['W1','W1','W1','T3','T3','T3','B5','B5','B7','B7','W9','W9','T6'],
    ['W1','W1','W2','W3','W4','W5','T3','T3','T3','B5','B6','B7','W9'],
    ['T2','T2','T2','W4','W4','W4','B6','B6','B9','B9','W7','W7','T5'],
  ];
  let probe = null, deckIdx = -1;
  for (let di = 0; di < decks.length && !probe; di++) {
    ai.hand = decks[di].map((x, i) => window.__mk(x, 980000 + i));
    const before = calcShanten(ai.hand, ai.melds);
    const cnt = {}; for (const t of ai.hand) cnt[t.id] = (cnt[t.id] || 0) + 1;
    for (const id of Object.keys(cnt).filter(k => cnt[k] >= 2)) {
      const hold = ai.hand.filter(t => t.id !== id);
      const after = minShantenAfterDiscard(hold, ai.melds.concat([{ type: 'peng', tiles: [] }]));
      if (after - before === 1) { probe = id; deckIdx = di; break; }
    }
  }
  if (!probe) return { skip: true };
  const res = { skip: false, probe, deckIdx };
  const backupRand = Math.random;
  Math.random = () => 0.5;
  for (const st of ['aggressive', 'conservative']) {
    ai.style = st;
    res[st] = masterClaim(ai, probe, 'peng');
  }
  Math.random = backupRand;
  return res;
});
if (r11.skip) {
  console.log('○ 碰容忍差异：探测手牌中无 after=before+1 的碰组合，本用例跳过（tol 参数已由用例8锁定）');
  results.push({ name: '碰容忍差异（跳过）', ok: true, detail: '无+1组合' });
} else {
  check('碰容忍差异：激进敢碰退1步、保守必拒', r11.aggressive === true && r11.conservative === false, `碰 ${r11.probe} 后向听+1：激进=${r11.aggressive}，保守=${r11.conservative}`);
}

await browser.close();
const pass = results.every(r => r.ok) && errors.length === 0;
console.log(`\nJS 报错：${errors.length} 条${errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''}`);
console.log(pass ? `结果：${results.length}/${results.length} 项通过` : '结果：存在失败项，需修复');
process.exit(pass ? 0 : 1);
