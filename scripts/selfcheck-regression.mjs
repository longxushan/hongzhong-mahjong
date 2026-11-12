// 20 局自检配套：串行跑关键专项回归，把退出码/通过数/输出摘要落盘供报告引用
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT || path.join(ROOT, 'scripts', 'selfcheck-20-regression.json');
const list = [
  ['verify.mjs', '主回归 · 全量冒烟'],
  ['test-hand-split.mjs', '拆牌方式 · 默认关闭/分组摆牌'],
  ['test-hand-drag.mjs', '手牌拖动配牌 · 12 组合布局'],
  ['test-teach-pool.mjs', '教学合并栏 · 牌河实况/打错提醒'],
  ['test-warn-band.mjs', '竖屏打错提醒 · 钉底不交叠'],
];
const records = [];
for (const [file, label] of list) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', file)], {
    cwd: ROOT, encoding: 'utf8', timeout: 480000,
    env: { ...process.env },
  });
  const lines = ((r.stdout || '') + '\n' + (r.stderr || '')).trim().split('\n').filter(Boolean);
  const hits = lines.map(l => l.match(/(\d+)\s*\/\s*(\d+)/)).filter(Boolean);
  const last = hits.length ? hits[hits.length - 1].slice(1, 3).join('/') : '';
  const rec = { file, label, ok: r.status === 0, exit: r.status,
    sec: +((Date.now() - t) / 1000).toFixed(1), ratio: last,
    tail: lines.slice(-3).join(' | ').slice(0, 400) };
  records.push(rec);
  console.log(`${rec.ok ? 'PASS' : 'FAIL'} ${file} ${rec.ratio || '(无计数)'} ${rec.sec}s  ${rec.tail.slice(0, 120)}`);
  fs.writeFileSync(OUT, JSON.stringify({ records, at: new Date().toISOString() }, null, 1), 'utf-8');
}
fs.writeFileSync(OUT, JSON.stringify({ records, at: new Date().toISOString() }, null, 1), 'utf-8');
console.log(`专项回归 ${records.filter(r => r.ok).length}/${records.length} 通过，明细 ${OUT}`);
