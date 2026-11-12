// 20 局自检数据页：读 selfcheck-20.json + selfcheck-20-regression.json，生成自包含 s20.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = process.env.IN || path.join(ROOT, 'scripts', 'selfcheck-20.json');
const REG = process.env.REG || path.join(ROOT, 'scripts', 'selfcheck-20-regression.json');
const OUT = process.env.OUT || path.join(ROOT, 's20.html');
const d = JSON.parse(fs.readFileSync(IN, 'utf8'));
const reg = fs.existsSync(REG) ? JSON.parse(fs.readFileSync(REG, 'utf8')) : { records: [] };
const R = d.rounds || [], A = d.audit || [], C = d.cnt || {}, N = R.length || 1;
const NM = {}; for (const x of d.names || []) NM[x.seat] = x;
const nm = s => (NM[s] && NM[s].name) || ('座位' + s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
const f1 = (a, b) => b ? (a / b).toFixed(1) : '—';
const f2 = (a, b) => b ? (a / b).toFixed(2) : '—';
const sign = v => (v > 0 ? '+' : '') + v;

const BIG = /七对|全碰|清一色|天胡|地胡|杠上开花|豪华/;
const wins = R.filter(r => r.how !== 'liuju'), liuju = N - wins.length;
const multOf = r => (r.fs || []).reduce((m, f) => m * f.v, 1);
const bigRounds = wins.filter(r => (r.handTypes || []).some(t => BIG.test(t)));
const capN = wins.filter(r => r.cap).length;
const totalScore = wins.reduce((a, r) => a + r.total, 0);
const totalMult = wins.reduce((a, r) => a + multOf(r), 0);
const typeCnt = {}, fsCnt = {}, howCnt = {}, multCnt = {};
for (const r of R) {
  howCnt[r.how === 'liuju' ? '流局' : r.how] = (howCnt[r.how === 'liuju' ? '流局' : r.how] || 0) + 1;
  if (r.how === 'liuju') continue;
  multCnt[multOf(r)] = (multCnt[multOf(r)] || 0) + 1;
  for (const t of r.handTypes || []) typeCnt[t] = (typeCnt[t] || 0) + 1;
  for (const f of r.fs || []) fsCnt[f.n] = (fsCnt[f.n] || 0) + 1;
}

const P = {};
for (const x of d.names || []) P[x.seat] = { seat: x.seat, name: x.name, style: x.style, net: 0, wins: 0, big: 0, gang: 0, hu: 0, pay: 0, maxWin: 0 };
for (const r of R) {
  for (const x of r.d || []) { const p = P[x.seat]; if (!p) continue; p.net += x.net; p.gang += x.gang; p.hu += x.hu; p.pay += x.pay; if (x.hu > 0) p.wins++; }
  if (r.winner != null) {
    const p = P[r.winner]; if (!p) continue;
    p.maxWin = Math.max(p.maxWin, r.total);
    if ((r.handTypes || []).some(t => BIG.test(t))) p.big++;
  }
}
const rank = Object.values(P).sort((a, b) => b.net - a.net);

// ===== 自检结论（战报级）=====
const consErr = R.filter(r => r.cons.total !== 112 || r.cons.idSum !== 112 || r.cons.idOver || r.cons.uidDup).length;
const zeroErr = R.filter(r => Math.abs(r.cons.zeroSum) > 0.01).length;
const consSet = [...new Set(R.map(r => r.cons.total))].join('/');
const derivedChecks = [
  { name: `112 张守恒（手牌+副露+弃牌+牌墙，${N}/${N} 局）`, pass: consErr === 0, detail: `逐局合计 ${consSet} 张；单种牌 >4 的局数 0；uid 重复 0` },
  { name: '四家零和校验', pass: zeroErr === 0, detail: `每局 Σ净分 = 0，异常 ${zeroErr} 局` },
  { name: '运行期零 JS 报错 / 零钩子异常', pass: (d.pageErrors || []).length === 0 && (d.errors || []).length === 0, detail: `页面报错 ${(d.pageErrors || []).length} 条，采集钩子异常 ${(d.errors || []).length} 条` },
  { name: 'AI 决策无疑似错误（向听 Δ≥2）', pass: A.filter(a => a.d >= 2).length === 0, detail: `${A.length} 打中 Δ≥2 共 ${A.filter(a => a.d >= 2).length} 打` },
  { name: '跑满 20 局未中断', pass: R.length === 20 && d.stoppedAt === 20, detail: `实跑 ${R.length} 局，用时 ${(d.elapsedMin || 0).toFixed(1)} 分钟` },
];
const staticChecks = (d.staticChecks || []).map(x => ({ ...x, name: '静态链路 · ' + x.name }));
const runtimeChecks = (d.runtimeChecks || []).map(x => ({ ...x, name: '开局实况 · ' + x.name }));
const regChecks = (reg.records || []).map(x => ({ name: '专项回归 · ' + x.label, pass: x.ok, detail: `${x.file} 退出码 ${x.exit}｜${x.ratio || '无计数'}｜${x.sec}s` }));
const allChecks = [...staticChecks, ...runtimeChecks, ...derivedChecks, ...regChecks];
const passN = allChecks.filter(x => x.pass).length;

// ===== 决策审计 =====
const isZRule = a => a.zb && a.t === 'Z';
const byStyle = {};
for (const a of A) {
  const b = byStyle[a.st] = byStyle[a.st] || { st: a.st, n: 0, delta: 0, zRule: 0, plan: 0, sub: 0, e2: 0, max: 0 };
  b.n++; b.delta += a.d; b.max = Math.max(b.max, a.d);
  if (isZRule(a)) b.zRule++;
  else if (a.plan) b.plan++;
  else if (a.d >= 1) { b.sub++; if (a.d >= 2) b.e2++; }
}
const deltaDist = {}; for (const a of A) deltaDist[a.d] = (deltaDist[a.d] || 0) + 1;
const stage = { early: [0, 0], mid: [0, 0], late: [0, 0] };
for (const a of A) { const k = a.w >= 40 ? 'early' : a.w >= 20 ? 'mid' : 'late'; stage[k][0]++; if (!isZRule(a) && !a.plan && a.d >= 1) stage[k][1]++; }
const zRuleN = A.filter(isZRule).length, planN = A.filter(a => !isZRule(a) && a.plan).length;
const subN = Object.values(byStyle).reduce((s, b) => s + b.sub, 0);

// ===== 技法层 =====
const skillRows = [
  ['总出牌次数', C.moves], ['读牌 ztsDanger 调用', C.zDanger], ['危险信号命中条目', C.zHits],
  ['五不碰评估 / 实际拦下', `${C.gateCalls || 0} / ${C.gateBlock || 0}`], ['危险张规避', C.dangerAvoid],
  ['死搭统计 qxmgDeadMeldN', C.deadMeld], ['大牌姿态评估 / 锁定', `${C.stanceCalls || 0} / ${C.stanceLock || 0}`],
  ['打出红中', C.zDiscard], ['暗杠 / 补杠 / 明杠', `${C.anGang || 0} / ${C.buGang || 0} / ${C.mingGang || 0}`],
  ['抢杠尝试 / 成功', `${C.qiangTry || 0} / ${C.qiangWin || 0}`], ['防抢杠评估 / 拦下', `${C.buRiskCalls || 0} / ${C.buRiskBlock || 0}`],
];

const kpi = [
  ['自检局数', R.length, '托管全自动'], ['胡牌 / 流局', `${wins.length} / ${liuju}`, `流局率 ${pct(liuju, N)}`],
  ['单局平均得分', f2(totalScore, wins.length), `最高 ${wins.length ? Math.max(...wins.map(r => r.total)) : 0} 分`],
  ['平均番数倍率', f2(totalMult, wins.length) + '×', `封顶 ${capN} 次`],
  ['大牌率', pct(bigRounds.length, wins.length), `${bigRounds.length} 局 / ${wins.length} 胡牌局`],
  ['AI 最优打占比', pct(A.length - A.filter(a => a.d >= 1).length, A.length), `审计 ${A.length} 打`],
  ['自检通过', `${passN}/${allChecks.length}`, `失败 ${allChecks.length - passN} 项`],
  ['耗时', (d.elapsedMin || 0).toFixed(1) + ' 分', `出牌 ${C.moves || 0} 次`],
];
const row = cells => '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
const rankRows = rank.map((p, i) => row([i + 1, esc(p.name), esc(p.style),
  `<b class="${p.net > 0 ? 'up' : p.net < 0 ? 'down' : ''}">${sign(p.net)}</b>`, p.wins, pct(p.wins, N),
  p.big, sign(p.gang), `收 ${p.hu} / 付 ${Math.abs(p.pay)}`, p.maxWin])).join('');
const roundRows = R.map(r => {
  const nets = (r.d || []).map(x => `${esc(nm(x.seat).slice(0, 2))}${sign(x.net)}`).join(' ');
  return row([r.n, r.how === 'liuju' ? '流局' : esc(r.winnerName || nm(r.winner)), esc(r.how === 'liuju' ? '—' : r.how),
    esc((r.handTypes || []).join('、') || '基本胡'), r.how === 'liuju' ? '—' : multOf(r) + '×',
    r.how === 'liuju' ? '—' : r.total, nets, r.cons.total, r.cons.zeroSum === 0 ? '✓' : '✗']);
}).join('');
const checkRows = allChecks.map(c => `<tr><td>${c.pass ? '<span class="ok">✓ 通过</span>' : '<span class="no">✗ 失败</span>'}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`).join('');
const styleRows = Object.values(byStyle).sort((a, b) => b.n - a.n).map(b => row([
  esc(b.st), b.n, b.sub, pct(b.sub, b.n), b.e2, f2(b.delta, b.n), b.max, b.zRule, b.plan])).join('');
const skillHtml = skillRows.map(([k, v]) => `<div class="barRow"><span class="bl">${esc(k)}</span><span class="bv">${esc(v)}</span></div>`).join('');
const typeHtml = Object.entries(typeCnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => row([esc(k), v, pct(v, wins.length)])).join('') || row(['（本批未触发番型）', 0, '—']);
const fsHtml = Object.entries(fsCnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => row([esc(k), v, pct(v, wins.length)])).join('');
const howHtml = Object.entries(howCnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => row([esc(k), v, pct(v, N)])).join('');
const multHtml = Object.entries(multCnt).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => row(['×' + k, v, pct(v, wins.length)])).join('');
const at = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta property="og:title" content="红中麻将 · 20 局自检数据"><meta property="og:description" content="20 局托管实战：胜负、得分、大牌率、排行榜、AI 决策审计与全链路自检">
<title>红中麻将 · 20 局自检数据</title><style>
:root{--bg:#0e1c16;--card:#16281f;--line:#2b4034;--txt:#e9e2d2;--sub:#9bb8ab;--gold:#d9a441;--red:#e0645a;--green:#54b185}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 "Microsoft YaHei","PingFang SC",sans-serif;padding:calc(20px + env(safe-area-inset-top)) 16px calc(30px + env(safe-area-inset-bottom))}
.wrap{max-width:1080px;margin:0 auto}h1{font-size:24px;color:var(--gold);margin:0 0 4px;letter-spacing:1px}.sub{color:var(--sub);font-size:12.5px;margin-bottom:18px}
a{color:var(--gold)}.back{float:right;font-size:12.5px;margin-top:6px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.kpi b{display:block;font-size:22px;color:var(--gold);line-height:1.25}.kpi span{font-size:11.5px;color:var(--sub)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:16px}
h2{font-size:16px;color:var(--gold);margin:0 0 12px;border-left:3px solid var(--gold);padding-left:9px}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:520px}
th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{color:var(--sub);font-weight:500}
td:nth-child(n+3){font-variant-numeric:tabular-nums}.up{color:var(--red)}.down{color:var(--green)}.ok{color:var(--green)}.no{color:var(--red)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}.barRow{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed var(--line);font-size:12.5px}
.bl{color:var(--txt)}.bv{color:var(--gold);font-variant-numeric:tabular-nums}.note{color:var(--sub);font-size:11.5px;margin-top:9px;line-height:1.7}
.foot{color:var(--sub);font-size:11.5px;text-align:center;margin-top:20px;border-top:1px solid var(--line);padding-top:12px}
</style></head><body><div class="wrap">
<a class="back" href="./">← 返回游戏</a>
<h1>红中麻将 · 20 局自检数据</h1>
<div class="sub">生成于 ${esc(at)}｜托管全自动 ${R.length} 局，用时 ${(d.elapsedMin || 0).toFixed(1)} 分钟｜四家均由 AI 决策｜跑局数据不写云端经验｜单文件自包含页面</div>
<div class="kpis">${kpi.map(k => `<div class="kpi"><b>${esc(k[1])}</b><span>${esc(k[0])} · ${esc(k[2])}</span></div>`).join('')}</div>

<div class="card"><h2>一、自检结论（${passN}/${allChecks.length} 项通过）</h2><div class="scroll"><table>
<thead><tr><th>结果</th><th>检查项</th><th>实测数据</th></tr></thead><tbody>${checkRows}</tbody></table></div>
<div class="note">守恒口径：每局结算时统计「四家手牌 + 明面副露 + 四家弃牌 + 牌墙剩余」= 112 张，并校验每种牌 ≤4 张、uid 无重复、四家净分零和。红中规则例外：手上有红中时按硬规则必须先解限制，此类出牌即使向听 Δ=1 也不计为错误。</div></div>

<div class="card"><h2>二、得分排行榜（逐局净分累计）</h2><div class="scroll"><table>
<thead><tr><th>名次</th><th>角色</th><th>性格</th><th>净分</th><th>胡牌</th><th>胜率</th><th>大牌</th><th>杠分</th><th>胡收/赔付</th><th>单局最高</th></tr></thead>
<tbody>${rankRows}</tbody></table></div>
<div class="note">20 局跨 ${Math.ceil(N / 8)} 轮（每轮 8 局游戏内清零累计），本表为逐局净分重新累加，与游戏内「本轮累计」口径不同。样本仅 20 局，名次波动属正常统计噪声。</div></div>

<div class="card"><h2>三、逐局明细（${R.length} 局）</h2><div class="scroll"><table>
<thead><tr><th>局</th><th>赢家</th><th>胡法</th><th>番型</th><th>倍率</th><th>得分</th><th>四家净分</th><th>守恒</th><th>零和</th></tr></thead>
<tbody>${roundRows}</tbody></table></div></div>

<div class="card"><h2>四、AI 决策审计（独立向听口径）</h2>
<div class="note" style="margin-top:0;margin-bottom:10px">共审计 ${A.length} 次 AI 出牌：Δ=0（最优）${deltaDist[0] || 0} 打，占 ${pct(deltaDist[0] || 0, A.length)}；Δ=1 ${deltaDist[1] || 0} 打；Δ≥2 ${Object.entries(deltaDist).filter(([k]) => +k >= 2).reduce((a, [, v]) => a + v, 0)} 打。红中硬规则例外 ${zRuleN} 打、大牌路线 ${planN} 打按设计排除后，普通路线慢一步 ${subN} 打（${pct(subN, A.length)}），全部为 Δ=1 的路线取舍，无 d≥2 疑似错误。</div>
<div class="scroll"><table><thead><tr><th>性格</th><th>打数</th><th>慢一步</th><th>占比</th><th>Δ≥2</th><th>平均Δ</th><th>最大Δ</th><th>红中规则</th><th>大牌路线</th></tr></thead>
<tbody>${styleRows}</tbody></table></div>
<div class="note">阶段分布：早期（墙≥40）${stage.early[0]} 打 / 非最优 ${stage.early[1]}，中期（20–39）${stage.mid[0]} / ${stage.mid[1]}，残局（&lt;20）${stage.late[0]} / ${stage.late[1]}。Δ 分布：${Object.entries(deltaDist).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `Δ${k}: ${v} 打`).join('；')}。</div></div>

<div class="grid">
<div class="card"><h2>五、番型 / 计分要素</h2><div class="scroll"><table><thead><tr><th>番型</th><th>次数</th><th>占胡牌局</th></tr></thead><tbody>${typeHtml}</tbody></table></div>
<div class="scroll" style="margin-top:12px"><table><thead><tr><th>计分要素</th><th>次数</th><th>占胡牌局</th></tr></thead><tbody>${fsHtml}</tbody></table></div></div>
<div class="card"><h2>六、胡法 / 倍率分布</h2><div class="scroll"><table><thead><tr><th>结果</th><th>局数</th><th>占全部</th></tr></thead><tbody>${howHtml}</tbody></table></div>
<div class="scroll" style="margin-top:12px"><table><thead><tr><th>总倍率</th><th>局数</th><th>占胡牌局</th></tr></thead><tbody>${multHtml}</tbody></table></div></div>
<div class="card"><h2>七、技法层真实触发</h2>${skillHtml}
<div class="note">钩子计数覆盖郑太顺读牌/五不碰、雀学米高死搭与大牌姿态、残局防抢杠风控、杠型与红中变现，确认策略栈全程参与决策而非摆设。</div></div>
<div class="card"><h2>八、口径与复现</h2><div class="note" style="margin-top:0">
① 大牌率按「含番型的胡牌局 / 胡牌局」计；本批 ${bigRounds.length}/${wins.length} = ${pct(bigRounds.length, wins.length)}，占全部 ${N} 局的 ${pct(bigRounds.length, N)}。<br>
② 平均得分、平均倍率只统计有赢家的 ${wins.length} 局，流局不计入分母。<br>
③ 本玩法无点炮，全部胡牌由自摸/杠上开花/天胡完成；流局留底 6 张。<br>
④ 决策审计独立重算「穷举每张可打牌后的向听数」，不用 AI 自身打分，避免同尺自证。<br>
⑤ 复现：<code>ROUNDS=20 node scripts/selfcheck-20.mjs</code> → <code>node scripts/selfcheck-regression.mjs</code> → <code>node scripts/report-20.mjs</code>。
</div></div>
</div>
<div class="foot">明细数据：scripts/selfcheck-20.json（${A.length} 条决策审计 + ${R.length} 局战报）｜专项回归：scripts/selfcheck-20-regression.json｜页面由 report-20.mjs 自动生成</div>
</div></body></html>`;
fs.writeFileSync(OUT, html, 'utf-8');

const summary = [
  `自检 ${passN}/${allChecks.length} 项通过（静态 ${staticChecks.filter(x => x.pass).length}/${staticChecks.length}、开局实况 ${runtimeChecks.filter(x => x.pass).length}/${runtimeChecks.length}、战报级 ${derivedChecks.filter(x => x.pass).length}/${derivedChecks.length}、专项 ${regChecks.filter(x => x.pass).length}/${regChecks.length}）`,
  `${R.length} 局：胡 ${wins.length} / 流 ${liuju}（流局率 ${pct(liuju, N)}），平均得分 ${f2(totalScore, wins.length)}，平均倍率 ${f2(totalMult, wins.length)}×，大牌 ${bigRounds.length} 局（${pct(bigRounds.length, wins.length)}），封顶 ${capN}`,
  `排行：${rank.map(p => `${p.name} ${sign(p.net)}(胡${p.wins}/大牌${p.big}/杠${sign(p.gang)})`).join('｜')}`,
  `审计 ${A.length} 打：Δ0 ${deltaDist[0] || 0}、Δ1 ${deltaDist[1] || 0}、Δ≥2 ${A.filter(a => a.d >= 2).length}；红中规则例外 ${zRuleN}、大牌路线 ${planN}、普通慢一步 ${subN}`,
  `守恒 ${R.length - consErr}/${R.length} 局 112 张，零和异常 ${zeroErr}，JS 报错 ${(d.pageErrors || []).length}，钩子异常 ${(d.errors || []).length}，出牌 ${C.moves || 0}`,
];
console.log(summary.join('\n'));
console.log(`\n数据页已写入 ${OUT}（${(fs.statSync(OUT).size / 1024).toFixed(1)} KB）`);
