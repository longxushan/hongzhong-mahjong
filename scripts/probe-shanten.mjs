// 师傅推荐质量抽检：npm run probe
// 在真实牌局的玩家决策点采样，验证打错提醒（liveWarn/teachPick）的建议牌：
// ① 打出后向听数 = 全部候选的最小向听（向听最优）；② 与 AI 精算 masterDiscard 同级（差距 0）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');
const N = Number(process.env.SAMPLES || 15);

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
try { ({ chromium } = await import('playwright-core')); } catch (e) { console.error('缺少 playwright-core：npm install'); process.exit(1); }
const browserPath = findBrowser();
if (!browserPath) { console.error('未找到浏览器'); process.exit(1); }

const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load' });
await page.evaluate(() => { CFG.aiDelay = 0; CFG.thinkMin = 0; CFG.thinkMax = 0; CFG.diceMs = 40; CFG.diceGap = 20; CFG.diceAuto = 30; CFG.diceHold = 40; });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
await page.locator('.roleBtn').first().click();

const samples = [];
let skippedRule = 0;
let guard = 0;
while (samples.length < N && guard < 160) {
  guard++;
  await page.waitForFunction(
    () => typeof G !== 'undefined' && !!G && (G.over || (G.awaiting === 'discard' && p(0).hand.length === 14)),
    null, { timeout: 12000 }
  ).catch(() => null);
  const over = await page.evaluate(() => !G || G.over);
  if (over) { await page.evaluate(() => { restart(); }); continue; }
  // 打红中确认弹窗：自动确认，解锁「手里≥2红中必须先打红中」的规则锁定局
  const cz = await page.evaluate(() => G.awaiting === 'confirmZ');
  if (cz) { await page.evaluate(() => humanRespond({ yes: 1 })); await page.waitForTimeout(200); continue; }
  const ok = await page.evaluate(() => G.awaiting === 'discard' && p(0).hand.length === 14);
  if (!ok) { await page.waitForTimeout(400); continue; }

  const r = await page.evaluate(() => {
    const me = p(0), d = handDiagnose(me), pick = teachPick(d), md = masterDiscard(me);
    if (pick.rule) {
      // 特例路径（红中硬规则/冒险打红中）：不参与向听对比；zBlocked 打红中推进（confirmZ 由外层自动确认）
      const outTile = (pick.id === 'Z' && blockedByZRule(me))
        ? me.hand.find(t => t.id === 'Z')
        : (me.hand.find(t => t.id !== 'Z') || me.hand[0]);
      humanRespond(outTile);
      return { skipped: true };
    }
    const seen = {}, arr = [];
    for (const t of me.hand) {
      if (t.id === 'Z' || seen[t.id]) continue; seen[t.id] = 1;
      const ah = me.hand.filter(x => x.uid !== t.uid);
      arr.push({ id: t.id, sh: calcShanten(ah, me.melds) });
    }
    const minSh = Math.min(...arr.map(x => x.sh));
    const pickSh = pick.id === 'Z' ? null : (arr.find(x => x.id === pick.id) || {}).sh;
    const mdSh = !md || md.id === 'Z' ? null : (arr.find(x => x.id === md.id) || {}).sh;
    // 大牌姿态诊断：未最优样本要能自证是大牌路线（用户需求：做大牌允许慢 1-2 步）
    let stanceInfo = null;
    try {
      const st = pick.stance || null;
      if (st) stanceInfo = { kind: st.kind, name: st.name, pickFit: pick.id === 'Z' ? 0 : stanceFit(st, pick.id, d), shGap: pickSh == null ? null : pickSh - minSh };
    } catch (e) {}
    const outTile = me.hand.find(t => t.id !== 'Z') || me.hand[0]; // 推进用普通牌，避免红中确认弹 10 秒等待
    humanRespond(outTile);
    return { pickId: pick.id, rule: false, pickSh, mdId: md ? md.id : null, mdSh, minSh, candCount: arr.length, stanceInfo };
  });
  if (r.skipped) { skippedRule++; await page.waitForTimeout(250); continue; }
  samples.push(r);
  await page.waitForTimeout(250);
}
await browser.close();

console.log(`采样 ${samples.length} 个真实决策点（每点平均 ${Math.round(samples.reduce((s, x) => s + x.candCount, 0) / Math.max(1, samples.length))} 个候选牌逐一验算）\n`);
const norm = samples.filter(s => !s.rule);
const pickOpt = norm.filter(s => s.pickSh === s.minSh);
const mdOpt = norm.filter(s => s.mdSh === s.minSh);
console.log(`① 打错提醒的建议牌达到「全候选最小向听」：${pickOpt.length}/${norm.length}${norm.length ? '（' + Math.round(pickOpt.length / norm.length * 100) + '%）' : ''}`);
for (const s of norm.filter(x => x.pickSh !== x.minSh)) {
  const st = s.stanceInfo;
  console.log(`   建议非向听最优：${s.pickId}（向听 ${s.pickSh} vs 最优 ${s.minSh}）` + (st && st.pickFit > 0 ? ` —— 大牌姿态[${st.name}]路线牌（契合度 ${st.pickFit}，慢 ${st.shGap} 步在安全闸内）` : ' —— 无姿态解释，需复核！'));
}
console.log(`② AI 精算 masterDiscard 同样达到最小向听：${mdOpt.length}/${norm.length}`);
const tie = norm.filter(s => s.mdSh === s.pickSh);
console.log(`③ 师傅建议与 AI 精算向听一致（差距 0）：${tie.length}/${norm.length}`);
console.log(`④ 特例路径跳过（红中硬规则/冒险打红中）：${skippedRule} 个 —— 规则与期望值打法，打红中自动确认以解锁、不参与向听对比`);
console.log(`⑤ 运行期 JS 报错：${errors.length} 条${errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''}`);
const stanceExplained = s => s.stanceInfo && s.stanceInfo.pickFit > 0 && (s.pickSh == null || s.pickSh - s.minSh <= 2);
const pickBad = norm.filter(s => s.pickSh !== s.minSh && !stanceExplained(s));
const pass = errors.length === 0 && pickBad.length === 0 && norm.length >= 5;
console.log(pass ? '\n结论：抽检通过——普通路线建议向听最优；大牌姿态样本慢 1-2 步属预期（做大牌自主决断）。' : '\n结论：存在无法用大牌姿态解释的未最优样本或报错，需复核。');
process.exit(pass ? 0 : 1);
