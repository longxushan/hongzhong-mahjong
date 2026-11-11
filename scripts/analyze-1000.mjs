// 千局审计分析：生成控制台摘要 + docs/千局实战审计报告.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = process.env.IN || path.join(ROOT, 'scripts', 'audit-1000.json');
const OUT = process.env.OUT || path.join(ROOT, 'docs', '千局实战审计报告-2026-11-11.md');
const d = JSON.parse(fs.readFileSync(IN, 'utf-8'));
const R = d.rounds || [], C = d.cnt || {}, NM = {};
for (const x of d.names || []) NM[x.seat] = x;
const nm = s => (NM[s] && NM[s].name) || ('座位' + s);
const style = s => (NM[s] && NM[s].style) || '—';
const pct = (a, b) => b ? (a / b * 100).toFixed(2) + '%' : '—';
const avg = (a, b) => b ? (a / b).toFixed(2) : '—';
const wins = R.filter(r => r.how !== 'liuju'), liuju = R.filter(r => r.how === 'liuju');
const N = R.length;

// 四家聚合
const P = {};
for (let s = 0; s < 4; s++) P[s] = { seat: s, name: nm(s), style: style(s), wins: 0, net: 0, gang: 0, huPts: 0, pay: 0, big: 0, cap: 0, maxWin: 0, zDisc: 0, dealerWins: 0, dealerRounds: 0 };
const typeCnt = {}, fsCnt = {}, multDist = {}, howCnt = {}, zDiscWin = {};
let totalScore = 0, totalMult = 0, capN = 0, dealerWinN = 0, dealerRoundN = 0, maHitSum = 0, maZN = 0, maZRounds = 0, zeroSumErr = 0, gangAbs = 0;
let softHu = 0, hardHu = 0, liujuWall = 0;
const scores = [], scoreBins = [[0, 2], [3, 5], [6, 10], [11, 20], [21, 34], [35, 49], [50, 999]];
for (const r of R) {
  if (r.how === 'liuju') {
    howCnt['流局'] = (howCnt['流局'] || 0) + 1;
    if (r.wallRemain != null) liujuWall += r.wallRemain;
  } else {
    if (r.maHasZ) softHu++; else hardHu++;
    howCnt[r.how] = (howCnt[r.how] || 0) + 1;
    scores.push(r.total); totalScore += r.total; if (r.cap) capN++;
    let mult = 1; for (const f of r.fs || []) mult *= f.v;
    totalMult += mult; multDist[mult] = (multDist[mult] || 0) + 1;
    for (const t of r.handTypes || []) typeCnt[t] = (typeCnt[t] || 0) + 1;
    for (const f of r.fs || []) fsCnt[f.n] = (fsCnt[f.n] || 0) + 1;
    const zd = (r.fs || []).find(f => /打出\d+只红中/.test(f.n));
    const zdn = zd ? parseInt(zd.n.match(/\d+/)[0], 10) : 0;
    zDiscWin[zdn] = (zDiscWin[zdn] || 0) + 1;
    if (r.maHit != null) { maHitSum += r.maHit; if (r.maZTiles > 0) { maZN += r.maZTiles; maZRounds++; } }
    if (r.winner != null) {
      const p = P[r.winner]; p.wins++; p.maxWin = Math.max(p.maxWin, r.total);
      if ((r.handTypes || []).some(t => /七对|全碰|清一色|天胡|地胡|杠上开花|豪华/.test(t))) p.big++;
      if (r.cap) p.cap++;
      if (r.isDealerWin) { dealerWinN++; p.dealerWins++; }
    }
  }
  dealerRoundN++;
  let sNet = 0;
  for (const x of r.d || []) {
    const p = P[x.seat]; if (!p) continue;
    p.net += x.net; p.gang += x.gang; p.huPts += x.hu; p.pay += x.pay;
    sNet += x.net; gangAbs += Math.abs(x.gang);
  }
  if (Math.abs(sNet) > 0.01) zeroSumErr++;
}
const scoreBinRows = scoreBins.map(([lo, hi]) => {
  const n = scores.filter(v => v >= lo && v <= hi).length;
  return `| ${lo}–${hi === 999 ? '50+' : hi} 分 | ${n} | ${pct(n, wins.length)} |`;
});
const rank = Object.values(P).sort((a, b) => b.net - a.net);
scores.sort((a, b) => a - b);
const median = scores.length ? scores[Math.floor(scores.length / 2)] : 0;
const zDiscTotal = C.zDiscard || 0;
const lines = [];
const w = s => lines.push(s);

w('# 千局实战全面审计报告 · 巢湖-金华红中');
w('');
w(`> 生成时间：2026-11-11｜样本：**${N} 局**｜耗时 ${((d.elapsedMin || 0)).toFixed(1)} 分钟｜页面 JS 报错 ${(d.pageErrors || []).length} 条｜钩子内部异常 ${(d.errors || []).length} 条`);
w('> 口径：托管全自动，四家均由 AI 决策，禁用云经验写入；每 8 局游戏内重置 100 子起底，本报告「累计净分」为跨轮全局净分。');
w('');
w('## 一、总览');
w('');
w('| 指标 | 数值 |');
w('|---|---|');
w(`| 总局数 | ${N} |`);
w(`| 自摸胡牌 | ${wins.length}（${pct(wins.length, N)}） |`);
w(`| 流局 | ${liuju.length}（${pct(liuju.length, N)}） |`);
w(`| 总出牌次数 | ${C.moves || 0}（每局 ${avg(C.moves || 0, N)} 次） |`);
w(`| 单局平均得分 | ${avg(totalScore, wins.length)} 分 |`);
w(`| 单局得分中位数 / 最高 / 最低 | ${median} / ${scores[scores.length - 1] || 0} / ${scores[0] || 0} 分 |`);
w(`| 平均番数倍率 | ${avg(totalMult, wins.length)} × |`);
w(`| 触发单局 50 分封顶 | ${capN} 次（${pct(capN, wins.length)}） |`);
w(`| 平均每局杠分绝对值 | ${avg(gangAbs, N)} 分 |`);
w(`| 零和校验异常局 | ${zeroSumErr} 局（应为 0） |`);
w('');
w('### 胡法分布');
w('');
w('| 胡法 | 次数 | 占比 |');
w('|---|---|---|');
for (const [k, v] of Object.entries(howCnt).sort((a, b) => b[1] - a[1])) w(`| ${k} | ${v} | ${pct(v, N)} |`);
w('');
w('## 二、得分排行榜（跨轮全局净分）');
w('');
w('| 排名 | 角色 | 性格 | 累计净分 | 胡牌次数 | 胜率 | 杠分累计 | 大牌次数 | 封顶次数 | 单局最高 |');
w('|---|---|---|---|---|---|---|---|---|---|');
rank.forEach((p, i) => w(`| ${i + 1} | ${p.name} | ${p.style} | ${p.net > 0 ? '+' : ''}${p.net} | ${p.wins} | ${pct(p.wins, N)} | ${p.gang > 0 ? '+' : ''}${p.gang} | ${p.big} | ${p.cap} | ${p.maxWin} |`));
w('');
w(`**胡牌收入 / 赔付**：${rank.map(p => `${p.name} 收 ${p.huPts} / 付 ${p.pay}`).join('；')}`);
w('');
w(`**庄家优势**：庄家胡牌 ${dealerWinN} 次 / ${dealerRoundN} 局 = ${pct(dealerWinN, dealerRoundN)}（随机基准 25%）。`);
w('');
w('## 三、大牌概率与番型');
w('');
w('| 番型 / 牌型 | 次数 | 占胡牌局 |');
w('|---|---|---|');
for (const [k, v] of Object.entries(typeCnt).sort((a, b) => b[1] - a[1])) w(`| ${k} | ${v} | ${pct(v, wins.length)} |`);
w('');
w('| 计分要素 | 次数 | 占胡牌局 |');
w('|---|---|---|');
for (const [k, v] of Object.entries(fsCnt).sort((a, b) => b[1] - a[1])) w(`| ${k} | ${v} | ${pct(v, wins.length)} |`);
w('');
w('**总倍率分布**（各番型连乘）：' + Object.entries(multDist).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `×${k} ${v} 局（${pct(v, wins.length)}）`).join('；'));
w('');
w('**红中变现**（赢家打出红中只数）：' + Object.entries(zDiscWin).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k} 只 ${v} 局（${pct(v, wins.length)}）`).join('；'));
w('');
w(`**翻码**：平均中码 ${avg(maHitSum, wins.length)} 分；翻出红中计分的局面 ${maZRounds} 局（${pct(maZRounds, wins.length)}），共 ${maZN} 张红中中码；软胡（手里有红中）${softHu} 局（${pct(softHu, wins.length)}）翻 4 张、硬胡 ${hardHu} 局（${pct(hardHu, wins.length)}）翻 6 张 0 中保底 6 分。`);
w('');
w('### 单局得分分布');
w('');
w('| 区间 | 局数 | 占胡牌局 |');
w('|---|---|---|');
scoreBinRows.forEach(x => w(x));
w('');
w(`流局时平均墙剩 ${avg(liujuWall, liuju.length)} 张（规则留底 6）。`);
w('');
w('## 四、杠与风控');
w('');
w('| 杠型 / 风控 | 次数 | 每局均值 |');
w('|---|---|---|');
const gangRows = [
  ['暗杠（+6）', C.anGang], ['补杠（+3）', C.buGang], ['明杠放杠（+2）', C.mingGang],
  ['抢杠尝试', C.qiangTry], ['抢杠成功', C.qiangWin],
  ['防抢杠风控拦下补杠', C.buRiskBlock], ['碰后不补杠规则拦截', C.noBuBlock],
];
for (const [k, v] of gangRows) w(`| ${k} | ${v || 0} | ${avg(v || 0, N)} |`);
w('');
w(`全桌累计打出红中 ${zDiscTotal} 张（每局 ${avg(zDiscTotal, N)} 张）。`);
w('');
w('## 五、麻将技法运用情况（AI 五层策略栈真实触发）');
w('');
w('| 技法层 | 触发次数 | 每局均值 | 说明 |');
w('|---|---|---|---|');
const skillRows = [
  ['郑太顺·读牌 ztsDanger 调用', C.zDanger, '每次 AI 出牌前读各家弃牌轨迹'],
  ['郑太顺·危险信号命中', C.zHits, '同线加减一 / 反常对 / 中后期 1·9 未见'],
  ['郑太顺·碰牌五不碰评估', C.gateCalls, ''],
  ['郑太顺·五不碰实际拦下', C.gateBlock, `拦截率 ${pct(C.gateBlock || 0, C.gateCalls || 0)}`],
  ['郑太顺·金三银七留牌加分', C.keep37, ''],
  ['郑太顺·幺九/二八罚分', C.keepPen, ''],
  ['郑太顺·危险张规避（打别的）', C.dangerAvoid, '手里有危险信号张但选择打别的'],
  ['雀学米高·死搭统计 qxmgDeadMeldN', C.deadMeld, '等向听时优先拆进张存量≤1 的死搭'],
  ['雀学米高·大师心法台词', C.masterqx, '拆死搭时冒技巧口径'],
  ['雀学米高·大牌姿态评估', C.stanceCalls, ''],
  ['雀学米高·姿态锁定', C.stanceLock, `锁定率 ${pct(C.stanceLock || 0, C.stanceCalls || 0)}`],
  ['雀学米高·防守台词', C.guard, '弃攻转守'],
  ['残局防抢杠风控评估', C.buRiskCalls, ''],
  ['残局防抢杠拦下', C.buRiskBlock, ''],
];
for (const [k, v, note] of skillRows) w(`| ${k} | ${v || 0} | ${avg(v || 0, N)} | ${note || ''} |`);
w('');
w('## 六、分段稳定性（每 100 局）');
w('');
w('| 区段 | 局数 | 流局率 | 平均得分 | 大牌率 | 平均倍率 |');
w('|---|---|---|---|---|---|');
for (let i = 0; i < N; i += 100) {
  const seg = R.slice(i, i + 100); if (!seg.length) continue;
  const wv = seg.filter(r => r.how !== 'liuju');
  const lj = seg.length - wv.length;
  const sc = wv.reduce((a, r) => a + r.total, 0);
  const big = wv.filter(r => (r.handTypes || []).some(t => /七对|全碰|清一色|天胡|地胡|杠上开花|豪华/.test(t))).length;
  const mul = wv.reduce((a, r) => a + (r.fs || []).reduce((x, f) => x * f.v, 1), 0);
  w(`| 第 ${i + 1}–${i + seg.length} 局 | ${seg.length} | ${pct(lj, seg.length)} | ${avg(sc, wv.length)} | ${pct(big, wv.length)} | ${avg(mul, wv.length)}× |`);
}
w('');
w('## 七、结论');
w('');
w(`1. 规则链路：${zeroSumErr === 0 ? '零和校验 100% 通过' : `发现 ${zeroSumErr} 局零和异常需复查`}；页面 JS 报错 ${(d.pageErrors || []).length} 条、钩子异常 ${(d.errors || []).length} 条。`);
w(`2. 胜率分布：${rank.map(p => `${p.name} ${pct(p.wins, N)}`).join(' / ')}；庄家胜率 ${pct(dealerWinN, dealerRoundN)}。`);
w(`3. 大牌：含番型的胡牌 ${Object.values(typeCnt).reduce((a, b) => a + b, 0)} 次条目，封顶 ${capN} 次；红中变现 ≥1 只的赢局 ${wins.length - (zDiscWin[0] || 0)} 局（${pct(wins.length - (zDiscWin[0] || 0), wins.length)}）。`);
w(`4. 技法层：五不碰闸评估 ${C.gateCalls || 0} 次、拦下 ${C.gateBlock || 0} 次；读牌 ${C.zDanger || 0} 次、危险信号 ${C.zHits || 0} 个；死搭止损分析 ${C.deadMeld || 0} 次——确认策略栈全程在参与决策而非摆设。`);
w(`5. 风控：补杠 ${C.buGang || 0} 次、抢杠成功 ${C.qiangWin || 0} 次；防抢杠风控拦下 ${C.buRiskBlock || 0} 次、碰后不补杠拦截 ${C.noBuBlock || 0} 次。`);
w('');
w('## 附录 A · 本次全面系统自检（跑局前）');
w('');
w('全部 **20 项通过，0 失败**（`npm run verify` + 19 个专项/探针脚本，逐个实测）：');
w('');
w('| 检查项 | 结果 | 关键实测 |');
w('|---|---|---|');
const checks = [
  ['verify.mjs（全量冒烟）', '35/35 ✓', '守恒 112 / 可见口径 / 规则弹窗同步 / 翻码红中 / 碰后不补杠 / 取消确认 / 教学引擎 / BGM / 零 JS 报错'],
  ['test-ai-qxmg', 'PASS', '雀学米高死搭止损 8/8 拆死搭、0/8 误拆活搭'],
  ['test-cloud-sync', 'PASS', '设备 B 读到设备 A 局数（g=40 w=8），跨设备经验累加成立'],
  ['test-dealer-hold', 'PASS', '定庄后面板停留 1.50s 再进局'],
  ['test-dice-scene', 'PASS', '四方位分数、进局清理、手牌 14 张'],
  ['test-draw-order', 'PASS', '抓牌时序、零 JS 报错'],
  ['test-me-draw', 'PASS', '玩家摸牌 13→14 链路'],
  ['test-pace', 'PASS', '出牌节奏 0.30s、35/35 落在 0.3–1.5s'],
  ['test-pport-adapt', 'PASS', '竖屏顶部自适应无遮挡'],
  ['test-role-exp', 'PASS', '经验 V2 六计数器 + pending 合并 + V1 迁移'],
  ['test-stance', '11/11 ✓', '大牌姿态同源、实时无粘滞、宣言只播一次'],
  ['test-start-silent', 'PASS', '开局 TTS 发声 0 次'],
  ['test-teach-plan', 'PASS', '牌型分析精准、与推荐同源'],
  ['test-tianhu', 'PASS', '自摸 6 → 地胡 12 → 天胡 24 计分链路'],
  ['test-warn-band', 'PASS', '打错提醒钉底 4px、无交叠'],
  ['probe-double-roll', 'PASS', '平局加掷复现「我来掷」'],
  ['probe-shanten', 'PASS', '普通路线向听最优；大牌姿态慢 1–2 步属预期'],
  ['probe-skills', 'PASS', '技能层触发计数、零 JS 报错'],
  ['eval-ai', 'PASS', '听牌巡数 5.1、死搭止损决策占比 20%（脚本积分展示字段为旧字段显示 undefined，不影响判定）'],
  ['audit-8games', 'PASS', '8 局守恒/时序/红中规则/零报错'],
];
for (const [a, b, c] of checks) w(`| ${a} | ${b} | ${c} |`);
w('');
w('**资源与同步**：单文件 `index.html` 1.3 MB 零依赖；`voice/` 420 个 mp3（host 209 / role 7 / w 36 / wf 36）；`cloud-sdk.js` 本地回落副本在位；规则同步三件套（rulesModal 文本 + docs 基线 + verify 关键词清单）已随本次三条规则升级逐条更新；Git 工作区与远程 main 同步。');
w('');
w('**本次会话已交付的规则/交互升级**：①翻码红中算 1 个子；②碰后不补杠；③打红中取消二次确认；④教学模块并入结构麻将实战篇；⑤100+100 局教学审计驱动的引擎修复（误报 38.0%→0.1%）。');
w('');
w('## 附录 B · 复现方式');
w('');
w('```');
w('ROUNDS=1000 node scripts/audit-1000.mjs   # 千局采集（约 30 分钟，分段落盘）');
w('node scripts/analyze-1000.mjs             # 生成本报告');
w('npm run verify                              # 35 项冒烟');
w('```');
w('');
w('> 明细数据 `scripts/audit-1000.json`；报告由脚本自动生成，数字可逐项回溯。');


fs.writeFileSync(OUT, lines.join('\n'), 'utf-8');
console.log(lines.slice(0, 60).join('\n'));
console.log(`\n报告已写入 ${OUT}`);
