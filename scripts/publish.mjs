// 免凭证发布：npm run publish
// 通过 WorkBuddy 的 GitHub 连接器通道，把本仓库的 UTF-8 文本文件推到 main 分支。
// 二进制文件（图片等）请改用 git push。可用 --dry-run 只列出待发布文件。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = process.env.GITHUB_OWNER || 'longxushan';
const REPO = process.env.GITHUB_REPO || 'hongzhong-mahjong';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const MESSAGE = process.env.PUBLISH_MESSAGE || 'chore: 同步本地改动';
const MAX_BATCH = 700 * 1024;

const SKIP_DIRS = new Set(['.git', 'node_modules', '_site', 'test-results', 'playwright-report']);
const TEXT_EXT = new Set(['.html', '.md', '.json', '.yml', '.yaml', '.mjs', '.js', '.css', '.txt']);
const SPECIAL = new Set(['.gitignore', '.nojekyll']);

function collect(dir, base = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      out.push(...collect(full, rel));
    } else if (ent.isFile()) {
      if (!TEXT_EXT.has(path.extname(ent.name).toLowerCase()) && !SPECIAL.has(ent.name)) continue;
      out.push({ path: rel, content: fs.readFileSync(full, 'utf8') });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const files = collect(ROOT);
const totalBytes = files.reduce((s, f) => s + Buffer.byteLength(f.content, 'utf8'), 0);
console.log(`目标：${OWNER}/${REPO}@${BRANCH}`);
console.log(`待发布 ${files.length} 个文本文件，${totalBytes} 字节`);
if (process.argv.includes('--dry-run')) {
  for (const f of files) console.log(`  ${f.path}  ${Buffer.byteLength(f.content, 'utf8')} B`);
  process.exit(0);
}

const cfg = JSON.parse(process.env.CODEBUDDY_MCP_CONFIG || '{}');
const g = cfg.mcpServers && cfg.mcpServers.github;
if (!g) {
  console.error('✗ 未找到 WorkBuddy 的 GitHub 连接器，请改用 git push');
  process.exit(1);
}

const url = g.url;
const baseHeaders = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
  ...(g.headers || {}),
};
let sessionId = null;

function parseBody(text) {
  const t = text.trim();
  if (t.startsWith('{')) { try { return JSON.parse(t); } catch (e) { return null; } }
  for (const line of t.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      try { return JSON.parse(line.slice(5).trim()); } catch (e) { /* next */ }
    }
  }
  return null;
}

async function rpc(method, params, id, notify = false) {
  const h = { ...baseHeaders };
  if (sessionId) h['Mcp-Session-Id'] = sessionId;
  const body = { jsonrpc: '2.0', method, params };
  if (!notify) body.id = id;
  const res = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const text = await res.text();
  return { status: res.status, json: parseBody(text), raw: text.slice(0, 500) };
}

const init = await rpc('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'hongzhong-publish', version: '1.0.0' },
}, 1);
if (init.status !== 200 || !init.json || init.json.error) {
  console.error('✗ 连接器初始化失败：', init.status, init.raw);
  process.exit(1);
}
await rpc('notifications/initialized', {}, undefined, true);

let callId = 1;
async function pushFiles(batch, message) {
  const r = await rpc('tools/call', {
    name: 'push_files',
    arguments: { owner: OWNER, repo: REPO, branch: BRANCH, message, files: batch },
  }, ++callId);
  if (!r.json || r.json.error) throw new Error(r.json?.error?.message || r.raw);
  const result = r.json.result || {};
  const text = (result.content || []).map(c => c.text || '').join('\n');
  if (result.isError) throw new Error(text);
  return text;
}

// 大文件单独成批，避免单次请求体过大
const batches = [];
let cur = [], size = 0;
for (const f of files) {
  const s = Buffer.byteLength(f.content, 'utf8');
  if (cur.length && size + s > MAX_BATCH) { batches.push(cur); cur = []; size = 0; }
  cur.push(f);
  size += s;
  if (size >= MAX_BATCH) { batches.push(cur); cur = []; size = 0; }
}
if (cur.length) batches.push(cur);

for (let i = 0; i < batches.length; i++) {
  const msg = batches.length > 1 ? `${MESSAGE} (${i + 1}/${batches.length})` : MESSAGE;
  try {
    const out = await pushFiles(batches[i], msg);
    console.log(`✓ [${i + 1}/${batches.length}] 已提交 ${batches[i].length} 个文件：${batches[i].map(f => f.path).join(', ')}`);
    if (out.trim()) console.log('  ' + out.trim().slice(0, 240).replace(/\n/g, '\n  '));
  } catch (e) {
    console.error(`✗ 第 ${i + 1} 批失败：${e.message}`);
    process.exit(1);
  }
}
console.log('\n全部推送完成，GitHub Actions 将自动重新部署 Pages。');
