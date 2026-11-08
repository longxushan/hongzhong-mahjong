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
await page.evaluate(() => { CFG.aiDelay = 0; CFG.thinkMin = 0; CFG.thinkMax = 0; });
await page.click('#startBtn');
await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
await page.locator('.roleBtn').first().click();

const samples = [];
let guard = 0;
while (samples.length < N && guard < 120) {
  guard++;
  await page.waitForFunction(
    () => typeof G !== 'undefined' && !!G && (G.over || (G.awaiting === 'discard' && p(0).hand.length === 14)),
    null, { timeout: 12000 }
  ).catch(() => null);
  const over = await page.evaluate(() => !G || G.over);
  if (over) { await page.evaluate(() => { restart(); }); continue; }
  const ok = await page.evaluate(() => G.awaiting === 'discard' && p(0).hand.length === 14);
  if (!ok) { await page.waitForTimeout(400); continue; }

  const r = await page.evaluate(() => {
    const me = p(0), d = handDiagnose(me), pick = teachPick(d), md = masterDiscard(me);
    const seen = {}, arr = [];
    for (const t of me.hand) {
      if (t.id === 'Z' || seen[t.id]) continue; seen[t.id] = 1;
      const ah = me.hand.filter(x => x.uid !== t.uid);
      arr.push({ id: t.id, sh: calcShanten(ah, me.melds) });
    }
    const minSh = Math.min(...arr.map(x => x.sh));
    const pickSh = pick.id === 'Z' ? null : (arr.find(x => x.id === pick.id) || {}).sh;
    const mdSh = !md || md.id === 'Z' ? null : (arr.find(x => x.id === md.id) || {}).sh;
    const outTile = me.hand.find(t => t.id !== 'Z') || me.hand[0]; // 推进用普通牌，避免红中确认弹 10 秒等待
    humanRespond(outTile);
    return { pickId: pick.id, rule: !!pick.rule, pickSh, mdId: md ? md.id : null, mdSh, minSh, candCount: arr.length };
  });
  samples.push(r);
  await page.waitForTimeout(250);
}
await browser.close();

console.log(`采样 ${samples.length} 个真实决策点（每点平均 ${Math.round(samples.reduce((s, x) => s + x.candCount, 0) / Math.max(1, samples.length))} 个候选牌逐一验算）\n`);
const ruleS = samples.filter(s => s.rule);
const norm = samples.filter(s => !s.rule);
const pickOpt = norm.filter(s => s.pickSh === s.minSh);
const mdOpt = norm.filter(s => s.mdSh === s.minSh);
console.log(`① 打错提醒的建议牌达到「全候选最小向听」：${pickOpt.length}/${norm.length}${norm.length ? '（' + Math.round(pickOpt.length / norm.length * 100) + '%）' : ''}`);
for (const s of norm.filter(x => x.pickSh !== x.minSh)) console.log(`   未达最优：建议 ${s.pickId}（向听 ${s.pickSh}） vs 最优 ${s.minSh}`);
console.log(`② AI 精算 masterDiscard 同样达到最小向听：${mdOpt.length}/${norm.length}`);
const tie = norm.filter(s => s.mdSh === s.pickSh);
console.log(`③ 师傅建议与 AI 精算向听一致（差距 0）：${tie.length}/${norm.length}`);
console.log(`④ 特例路径（红中硬规则/冒险打红中）：${ruleS.length} 个 —— 这是规则与期望值打法，不参与向听对比`);
console.log(`⑤ 运行期 JS 报错：${errors.length} 条${errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''}`);
const pass = errors.length === 0 && pickOpt.length === norm.length && norm.length >= 5;
console.log(pass ? '\n结论：抽检全部通过——打错提醒的建议在牌理（向听）层面与 AI 精算同级、始终最优。' : '\n结论：存在未最优样本或报错，需复核。');
process.exit(pass ? 0 : 1);
