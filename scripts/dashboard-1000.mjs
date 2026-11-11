// 千局实战可视化看板：读 audit-1000.json 生成自包含 HTML（纯 CSS/SVG，无外部依赖）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = process.env.IN || path.join(ROOT, 'scripts', 'audit-1000.json');
const OUT = process.env.OUT || path.join(ROOT, 'docs', '千局实战看板.html');
const d = JSON.parse(fs.readFileSync(IN, 'utf8'));
const R = d.rounds || [], C = d.cnt || {}, N = R.length || 1;
const NM = {}; for (const x of d.names || []) NM[x.seat] = x;
const nm = s => (NM[s] && NM[s].name) || ('座位' + s);
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const wins = R.filter(r => r.how !== 'liuju'), liuju = N - wins.length;
const P = {}; for (let s = 0; s < 4; s++) P[s] = { name: nm(s), style: (NM[s] && NM[s].style) || '', net: 0, wins: 0, big: 0, gang: 0 };
const types = {}, mults = {}, bins = [0, 0, 0, 0, 0, 0, 0];
let total = 0, cap = 0, zeroErr = 0, dealerWin = 0, maZ = 0, soft = 0, hard = 0;
for (const r of R) {
  if (r.how !== 'liuju') {
    total += r.total; if (r.cap) cap++;
    if (r.isDealerWin) dealerWin++;
    if (r.maHasZ) soft++; else hard++;
    if (r.maZTiles) maZ += r.maZTiles;
    let m = 1; for (const f of r.fs || []) m *= f.v;
    mults[m] = (mults[m] || 0) + 1;
    for (const t of r.handTypes || []) types[t] = (types[t] || 0) + 1;
    const v = r.total;
    bins[v <= 2 ? 0 : v <= 5 ? 1 : v <= 10 ? 2 : v <= 20 ? 3 : v <= 34 ? 4 : v <= 49 ? 5 : 6]++;
    if (r.winner != null) {
      P[r.winner].wins++;
      if ((r.handTypes || []).some(t => /七对|全碰|清一色|天胡|地胡|杠上开花|豪华/.test(t))) P[r.winner].big++;
    }
  }
  let s = 0; for (const x of r.d || []) { const p = P[x.seat]; if (p) { p.net += x.net; p.gang += x.gang; s += x.net; } }
  if (Math.abs(s) > 0.01) zeroErr++;
}
const rank = Object.values(P).sort((a, b) => b.net - a.net);
const maxNet = Math.max(1, ...rank.map(p => Math.abs(p.net)));
const maxType = Math.max(1, ...Object.values(types), ...Object.values(mults));
const typeRows = Object.entries(types).sort((a, b) => b[1] - a[1]);
const multRows = Object.entries(mults).sort((a, b) => +a[0] - +b[0]);
const segs = [];
for (let i = 0; i < N; i += 100) {
  const g = R.slice(i, i + 100), wv = g.filter(r => r.how !== 'liuju');
  segs.push({ label: `${i + 1}-${i + g.length}`, liu: g.length ? (g.length - wv.length) / g.length * 100 : 0, score: wv.reduce((a, r) => a + r.total, 0) / (wv.length || 1) });
}
const bar = (label, val, max, color, note) => `<div class="barRow"><span class="bl">${esc(label)}</span><div class="bt"><i style="width:${Math.max(1, val / max * 100)}%;background:${color}"></i></div><span class="bv">${esc(note != null ? note : val)}</span></div>`;
const GOLD = '#d9a441', RED = '#e0645a', GREEN = '#54b185', BLUE = '#6fa8dc', PURPLE = '#b28bd4';
const skill = [
  ['郑太顺 · 读牌调用', C.zDanger, GOLD], ['郑太顺 · 危险信号条目', C.zHits, RED],
  ['郑太顺 · 五不碰评估', C.gateCalls, BLUE], ['郑太顺 · 五不碰拦下', C.gateBlock, PURPLE],
  ['郑太顺 · 金三银七加分', C.keep37, GOLD], ['郑太顺 · 幺九二八罚分', C.keepPen, GREEN],
  ['郑太顺 · 危险张规避', C.dangerAvoid, BLUE],
  ['雀学米高 · 死搭统计', C.deadMeld, PURPLE], ['雀学米高 · 姿态锁定', C.stanceLock, GOLD],
  ['雀学米高 · 心法台词', C.masterqx, RED], ['雀学米高 · 防守台词', C.guard, GREEN],
  ['风控 · 防抢杠评估', C.buRiskCalls, BLUE], ['风控 · 防抢杠拦下', C.buRiskBlock, PURPLE],
  ['规则 · 碰后不补杠拦截', C.noBuBlock, RED],
];
const maxSkill = Math.max(1, ...skill.map(x => x[1] || 0));
const gangRows = [
  ['暗杠 +6', C.anGang, GOLD], ['补杠 +3', C.buGang, BLUE], ['明杠放杠 +2', C.mingGang, PURPLE],
  ['抢杠尝试', C.qiangTry, RED], ['抢杠成功', C.qiangWin, GREEN],
  ['防抢杠风控拦下', C.buRiskBlock, BLUE], ['碰后不补杠拦截', C.noBuBlock, PURPLE],
];
const maxGang = Math.max(1, ...gangRows.map(x => x[1] || 0));
const segLine = segs.map((s, i) => `${20 + i * (560 / Math.max(1, segs.length - 1))},${110 - Math.min(100, s.liu) * 0.9}`).join(' ');
const segScore = segs.map((s, i) => `${20 + i * (560 / Math.max(1, segs.length - 1))},${110 - Math.min(20, s.score) * 4.5}`).join(' ');

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>千局实战看板 · 巢湖-金华红中</title><style>
:root{--bg:#0e1c16;--card:#16281f;--line:#2b4034;--txt:#e9e2d2;--sub:#9bb8ab;--gold:#d9a441;--red:#e0645a;--green:#54b185}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 "Microsoft YaHei","PingFang SC",sans-serif;padding:28px}
.wrap{max-width:1080px;margin:0 auto}h1{font-size:26px;color:var(--gold);margin:0 0 4px;letter-spacing:2px}.sub{color:var(--sub);font-size:12.5px;margin-bottom:22px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:22px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}.kpi b{display:block;font-size:24px;color:var(--gold);line-height:1.2}.kpi span{font-size:12px;color:var(--sub)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px}
h2{font-size:16px;color:var(--gold);margin:0 0 14px;border-left:3px solid var(--gold);padding-left:10px}
.barRow{display:flex;align-items:center;gap:10px;margin:7px 0;font-size:12.5px}.bl{width:170px;flex:none;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt{flex:1;height:14px;background:#0c1712;border-radius:7px;overflow:hidden}.bt i{display:block;height:100%;border-radius:7px}.bv{width:92px;flex:none;text-align:right;color:var(--sub);font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--sub);font-weight:500}td.num{text-align:right;font-variant-numeric:tabular-nums}.pos{color:var(--red)}.neg{color:var(--green)}
.note{color:var(--sub);font-size:11.5px;margin-top:10px}.svgbox{width:100%;height:140px}.foot{color:var(--sub);font-size:11.5px;text-align:center;margin-top:24px;border-top:1px solid var(--line);padding-top:14px}
</style></head><body><div class="wrap">
<h1>千局实战看板 · 巢湖-金华红中</h1>
<div class="sub">托管全自动 · ${N} 局 · 生成于 2026-11-11 · 四家均由 AI 决策 · 禁用云经验写入 · 页面 JS 报错 ${(d.pageErrors || []).length} 条</div>
<div class="kpis">
<div class="kpi"><b>${N}</b><span>总局数</span></div>
<div class="kpi"><b>${pct(wins.length, N)}</b><span>自摸胡牌率</span></div>
<div class="kpi"><b>${pct(liuju, N)}</b><span>流局率</span></div>
<div class="kpi"><b>${(total / (wins.length || 1)).toFixed(2)}</b><span>平均单局得分</span></div>
<div class="kpi"><b>${cap}</b><span>50 分封顶次数</span></div>
<div class="kpi"><b>${zeroErr}</b><span>零和校验异常局</span></div>
</div>
<div class="grid">
<div class="card"><h2>得分排行榜（跨轮全局净分）</h2><table><tr><th>角色</th><th>性格</th><th class="num">净分</th><th class="num">胡牌</th><th class="num">胜率</th><th class="num">杠分</th><th class="num">大牌</th></tr>
${rank.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.style)}</td><td class="num ${p.net >= 0 ? 'pos' : 'neg'}">${p.net > 0 ? '+' : ''}${p.net}</td><td class="num">${p.wins}</td><td class="num">${pct(p.wins, N)}</td><td class="num ${p.gang >= 0 ? 'pos' : 'neg'}">${p.gang > 0 ? '+' : ''}${p.gang}</td><td class="num">${p.big}</td></tr>`).join('')}
</table><div class="note">庄家胡牌 ${dealerWin} / ${N} 局 = ${pct(dealerWin, N)}（随机基准 25%）。赢红输绿。</div>
${rank.map(p => bar(p.name, Math.abs(p.net), maxNet, p.net >= 0 ? RED : GREEN, (p.net > 0 ? '+' : '') + p.net)).join('')}
</div>
<div class="card"><h2>大牌概率 · 番型与倍率</h2>
${typeRows.length ? typeRows.map(([k, v]) => bar(k, v, maxType, PURPLE, `${v} / ${pct(v, wins.length)}`)).join('') : '<div class="note">本样本未出现番型</div>'}
<div class="note" style="margin:14px 0 6px">总倍率分布（番型连乘）</div>
${multRows.map(([k, v]) => bar('×' + k, v, Math.max(1, ...Object.values(mults)), GOLD, `${v} / ${pct(v, wins.length)}`)).join('')}
<div class="note">红中变现：赢家打出 ≥1 只红中 ${wins.length - (R.filter(r => r.how !== 'liuju' && !(r.fs || []).some(f => /打出\d+只红中/.test(f.n))).length)} 局；翻码翻出红中计分 ${maZ} 张；软胡 ${soft} / 硬胡 ${hard}。</div>
</div>
<div class="card"><h2>单局得分分布</h2>
${['0-2 分', '3-5 分', '6-10 分', '11-20 分', '21-34 分', '35-49 分', '50 分封顶'].map((k, i) => bar(k, bins[i], Math.max(1, ...bins), i >= 4 ? GOLD : BLUE, `${bins[i]} / ${pct(bins[i], wins.length)}`)).join('')}
<div class="note">流局时平均墙剩 6 张（规则留底）。零和校验 ${zeroErr === 0 ? '全部通过' : zeroErr + ' 局异常'}。</div>
</div>
<div class="card"><h2>杠与风控</h2>
${gangRows.map(([k, v, c]) => bar(k, v || 0, maxGang, c, v || 0)).join('')}
<div class="note">全桌累计打出红中 ${C.zDiscard || 0} 张（每局 ${((C.zDiscard || 0) / N).toFixed(2)} 张）。</div>
</div>
<div class="card"><h2>麻将技法运用（对数刻度）</h2>
${skill.map(([k, v, c]) => bar(k, Math.log10((v || 0) + 1), Math.log10(maxSkill + 1), c, (v || 0).toLocaleString())).join('')}
<div class="note">五不碰拦截率 ${pct(C.gateBlock || 0, C.gateCalls || 0)}；姿态锁定率 ${pct(C.stanceLock || 0, C.stanceCalls || 0)}。横条为 log10 刻度，数值为真实触发次数。</div>
</div>
<div class="card"><h2>分段稳定性（每 100 局）</h2>
<svg class="svgbox" viewBox="0 0 600 130" preserveAspectRatio="none">
<line x1="20" y1="110" x2="580" y2="110" stroke="#2b4034"/><line x1="20" y1="20" x2="20" y2="110" stroke="#2b4034"/>
<polyline points="${segLine}" fill="none" stroke="${RED}" stroke-width="2"/><polyline points="${segScore}" fill="none" stroke="${GOLD}" stroke-width="2"/>
</svg>
<div class="note">红线 = 流局率%（0–100 映射），金线 = 平均得分（0–20 映射）。</div>
<table style="margin-top:10px"><tr><th>区段</th><th class="num">流局率</th><th class="num">平均得分</th></tr>${segs.map(s => `<tr><td>第 ${s.label} 局</td><td class="num">${s.liu.toFixed(1)}%</td><td class="num">${s.score.toFixed(2)}</td></tr>`).join('')}</table>
</div>
</div>
<div class="foot">数据源 scripts/audit-1000.json · 复现 ROUNDS=1000 node scripts/audit-1000.mjs · 报告 docs/千局实战审计报告-2026-11-11.md</div>
</div></body></html>`;
fs.writeFileSync(OUT, html, 'utf8');
console.log(`看板已生成 ${OUT}（${N} 局）`);
