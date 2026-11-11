// 2026-11-11 审计数据分析：100 局战报汇总 + AI 决策质量画像
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = process.env.IN || path.join(ROOT, 'scripts', 'audit-100.json');
const data = JSON.parse(fs.readFileSync(IN, 'utf-8'));
const R = data.rounds;
const A = data.audit;
const nameMap = {};
for (const x of data.names || []) nameMap[x.seat] = x.name;
const seatName = s => nameMap[s] || ('座位' + s);

// ===== 一、战报汇总 =====
const aggr = {};
for (let s = 0; s < 4; s++) aggr[s] = { name: seatName(s), wins: 0, liuju: 0, net: 0, gangPts: 0, gangRounds: 0, bigWins: 0, bigTypes: {}, dumpZWins: 0, capHits: 0, huTotal: 0 };
const typeTotal = {};
let liuju = 0, totalMultSum = 0, huRounds = 0;
const bigRounds = [];
for (const r of R) {
  if (r.how === 'liuju') { liuju++; for (const x of r.d) { aggr[x.seat].liuju++; aggr[x.seat].net += x.net; aggr[x.seat].gangPts += x.gang; if (x.gang !== 0) aggr[x.seat].gangRounds++; } continue; }
  huRounds++;
  let mult = 1; for (const f of r.fs) mult *= f.v;
  totalMultSum += mult;
  const isBig = r.handTypes.length > 0 || mult >= 2;
  const dumpZ = r.fs.some(f => /^打出\d+只红中$/.test(f.n));
  if (isBig) { aggr[r.winner].bigWins++; for (const t of r.handTypes) { aggr[r.winner].bigTypes[t] = (aggr[r.winner].bigTypes[t] || 0) + 1; typeTotal[t] = (typeTotal[t] || 0) + 1; } }
  if (dumpZ) aggr[r.winner].dumpZWins++;
  if (r.cap) aggr[r.winner].capHits++;
  aggr[r.winner].huTotal += r.total;
  if (mult >= 4) bigRounds.push({ no: R.indexOf(r) + 1, winner: seatName(r.winner), types: r.handTypes.join('、') || '基本胡', mult, total: r.total });
  for (const x of r.d) { aggr[x.seat].net += x.net; aggr[x.seat].gangPts += x.gang; if (x.gang !== 0) aggr[x.seat].gangRounds++; if (x.hu > 0) aggr[x.seat].wins++; }
}
console.log('===== 战报汇总 =====');
console.log(`总局数 ${R.length}，胡牌局 ${huRounds}，流局 ${liuju}（流局率 ${(liuju / R.length * 100).toFixed(0)}%）`);
const bigRate = R.filter(r => r.how !== 'liuju' && (r.handTypes.length > 0 || r.fs.reduce((m, f) => m * f.v, 1) >= 2)).length / R.length * 100;
console.log(`大牌率（含牌型或倍率≥2）：${bigRate.toFixed(0)}%`);
for (const a of Object.values(aggr).sort((x, y) => y.net - x.net)) {
  console.log(`${a.name}: 净分 ${a.net >= 0 ? '+' : ''}${a.net} | 胡 ${a.wins} 局(${(a.wins / R.length * 100).toFixed(0)}%) | 大牌 ${a.bigWins} 局 ${JSON.stringify(a.bigTypes)} | 打红中胡 ${a.dumpZWins} | 杠分 ${a.gangPts} | 封顶 ${a.capHits}`);
}
console.log('牌型分布：', JSON.stringify(typeTotal));
console.log(`胡牌局平均倍率：${(totalMultSum / huRounds).toFixed(2)}×`);
if (bigRounds.length) console.log(`≥4×大胡 ${bigRounds.length} 局：`, bigRounds.slice(0, 10).map(b => `第${b.no}局${b.winner}${b.types}=${b.mult}×`).join('；'));

// ===== 二、决策审计 =====
console.log('\n===== AI 决策审计（独立向听口径）=====');
const byStyle = {};
for (const a of A) {
  const key = a.st;
  if (!byStyle[key]) byStyle[key] = { style: key, n: 0, sub: 0, err2: 0, planN: 0, planSub: 0, zbN: 0, sumD: 0, maxD: 0, errSamples: [], subSamples: [] };
  const B = byStyle[key];
  B.n++;
  B.sumD += a.d;
  if (a.d > B.maxD) B.maxD = a.d;
  const isZRule = a.zb && a.t === 'Z';
  if (isZRule) B.zbN++;
  if (a.plan) { B.planN++; if (a.d >= 1) B.planSub++; }
  else if (!isZRule) {
    if (a.d >= 1) { B.sub++; if (B.subSamples.length < 8) B.subSamples.push(a); }
    if (a.d >= 2) { B.err2++; if (B.errSamples.length < 8) B.errSamples.push(a); }
  }
}
for (const B of Object.values(byStyle).sort((x, y) => y.sub / y.n - x.sub / x.n)) {
  console.log(`\n[${B.style}] 打数 ${B.n} | 非最优率 ${((B.sub / B.n) * 100).toFixed(1)}% | 疑似错误率(d≥2) ${((B.err2 / B.n) * 100).toFixed(2)}% | 平均Δ ${(B.sumD / B.n).toFixed(3)} | 最大Δ ${B.maxD} | 红中规则牌 ${B.zbN} | 大牌路线打 ${B.planN}（其中非最优 ${B.planSub}）`);
  if (B.errSamples.length) console.log('  错误样本：', B.errSamples.map(a => `打${a.t}(Δ${a.d},sh${a.shA},剩${a.w})`).join('；'));
  if (B.subSamples.length) console.log('  非最优样本：', B.subSamples.map(a => `打${a.t}(Δ${a.d})`).join('；'));
}
// 全局 delta 分布
const dist = {};
for (const a of A) { const k = a.d; dist[k] = (dist[k] || 0) + 1; }
console.log('\nΔ分布：', JSON.stringify(dist));
// 阶段相关：非最优是否集中在特定阶段
const stageBad = { early: [0, 0], mid: [0, 0], late: [0, 0] };
for (const a of A) {
  const ph = a.w >= 40 ? 'early' : a.w >= 20 ? 'mid' : 'late';
  stageBad[ph][0]++;
  if (!a.plan && !(a.zb && a.t === 'Z') && a.d >= 1) stageBad[ph][1]++;
}
console.log('阶段非最优率：', Object.keys(stageBad).map(k => `${k}:${stageBad[k][1]}/${stageBad[k][0]}(${(stageBad[k][1] / stageBad[k][0] * 100).toFixed(1)}%)`).join(' '));
// 打出的牌的种类分析（非最优时打的什么）
const badTile = {};
for (const a of A) if (!a.plan && !(a.zb && a.t === 'Z') && a.d >= 2) badTile[a.t] = (badTile[a.t] || 0) + 1;
console.log('疑似错误时打出的牌分布：', JSON.stringify(badTile));
