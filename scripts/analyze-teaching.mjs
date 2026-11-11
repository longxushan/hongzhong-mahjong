// 教学审计简报生成器：读取 audit-teaching.json，输出教学建议质量 / 打错提醒误报 / 文案自相矛盾
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2] || path.join(ROOT, 'scripts', 'audit-teaching.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const S = d.samples || [], R = d.rounds || [];
const pct = (n, m) => m ? (n / m * 100).toFixed(1) + '%' : '—';
const cnt = f => S.filter(f).length;

console.log('=== 教学模块 100 局独立审计简报 ===\n');
console.log(`局数 ${R.length}｜玩家决策样本 ${S.length}｜页面错误 ${(d.errors || []).length}`);
const wins = R.filter(r => r.how !== 'liuju');
console.log(`自摸 ${wins.length} 局｜流局 ${R.filter(r => r.how === 'liuju').length} 局｜平均单局得分 ${(R.reduce((a, r) => a + (r.total || 0), 0) / (R.length || 1)).toFixed(1)}\n`);

console.log('【1】教学推荐质量（独立尺子 = 玩家可见口径下 sh→听牌宽度→一进听进张）');
console.log(`  与「玩家可见口径最优」一致      ${cnt(x => x.pickVsVis)} / ${S.length} = ${pct(cnt(x => x.pickVsVis), S.length)}`);
console.log(`  与「真实牌墙口径最优」一致      ${cnt(x => x.pickVsReal)} / ${S.length} = ${pct(cnt(x => x.pickVsReal), S.length)}`);
console.log(`  与 AI 实际打出的牌一致          ${cnt(x => x.pickVsAI)} / ${S.length} = ${pct(cnt(x => x.pickVsAI), S.length)}`);
console.log(`  两种口径最优牌不同              ${cnt(x => !x.visVsReal)} / ${S.length} = ${pct(cnt(x => !x.visVsReal), S.length)}`);
console.log(`  推荐牌让向听变差 Δsh>0          ${cnt(x => x.deltaSh > 0)} / ${S.length} = ${pct(cnt(x => x.deltaSh > 0), S.length)}（其中大牌姿态 ${cnt(x => x.deltaSh > 0 && x.stance)}、非姿态 ${cnt(x => x.deltaSh > 0 && !x.stance)}）`);

console.log('\n【2】打错提醒判定');
console.log(`  误报：打「可见口径最优」被判打亏 ${cnt(x => x.warnVis === 'bad')} / ${S.length} = ${pct(cnt(x => x.warnVis === 'bad'), S.length)}`);
console.log(`    被判「大牌方向打得通」放行     ${cnt(x => x.warnVis === 'stance')}；判「选得对」 ${cnt(x => x.warnVis === 'good')}`);
console.log(`  漏报：打最差牌却没判打亏        ${cnt(x => x.warnWorst !== 'bad')} / ${S.length} = ${pct(cnt(x => x.warnWorst !== 'bad'), S.length)}`);
console.log(`  「巡内净值是正的」断言中推荐其实非独立最优 ${cnt(x => x.goodButSuboptimal)} / ${S.length} = ${pct(cnt(x => x.goodButSuboptimal), S.length)}`);

console.log('\n【3】文案自相矛盾');
const iss = S.filter(x => x.issues && x.issues.length);
console.log(`  有矛盾的样本 ${iss.length} / ${S.length} = ${pct(iss.length, S.length)}`);
const by = {};
iss.forEach(x => x.issues.forEach(i => { const k = i.split(' ')[0]; by[k] = (by[k] || 0) + 1; }));
console.log('  分类', JSON.stringify(by));
iss.slice(0, 8).forEach(x => console.log(`  第${x.g}局 手[${x.hand}] 推${x.pick} 可见最优${x.visTop} → ${x.issues.join(';')}`));

console.log('\n【4】误报典型案例（Δsh=0 却被判打亏）');
S.filter(x => x.warnVis === 'bad' && x.deltaSh === 0).slice(0, 8).forEach(x =>
  console.log(`  第${x.g}局 手[${x.hand}] 师傅推${x.pick} 可见最优${x.visTop} AI打${x.aiPlay} | ${x.kou.slice(0, 70)}`));
