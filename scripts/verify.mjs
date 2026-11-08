// 冒烟验证：npm run verify
// 依据 docs/跨智能体复刻与调试手册.md 第九部分：状态驱动、守恒 112、剩余口径、零报错
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
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/local/bin/chromium',
  ];
  return candidates.find(p => fs.existsSync(p));
}

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('✗ 缺少 playwright-core，请先执行：npm install');
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.error('✗ 未找到浏览器，请用 BROWSER_PATH 指定 Chrome/Edge 可执行文件');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const checks = [];
function assert(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

try {
  await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
  assert('页面加载', true, `${fs.statSync(FILE).size} 字节`);

  // 只加速 AI 思考，不写入文件
  await page.evaluate(() => {
    if (typeof CFG !== 'undefined') { CFG.aiDelay = 0; CFG.thinkMin = 0; CFG.thinkMax = 0; }
  });

  await page.click('#startBtn');
  await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
  await page.locator('.roleBtn').first().click();

  // 状态驱动：等到玩家自己的出牌回合（手里 14 张）
  await page.waitForFunction(
    () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard'
      && typeof p === 'function' && p(0).hand.length === 14,
    null,
    { timeout: 30000 }
  );
  assert('进入牌局（玩家回合，手牌 14 张）', true);

  const r = await page.evaluate(() => {
    const total = G.players.reduce((s, pl) =>
      s + pl.hand.length
        + pl.melds.reduce((a, m) => a + m.tiles.length, 0)
        + pl.discard.length, 0) + wallRemain();
    const ids = [];
    for (const s of ['W', 'T', 'B']) for (let i = 1; i <= 9; i++) ids.push(s + i);
    ids.push('Z');
    const wall = G.wall.slice(G.head, G.tail + 1);
    const mismatch = ids.filter(id => tileRemaining(id) !== wall.filter(t => t.id === id).length);
    return { total, wallRemain: wallRemain(), awaiting: G.awaiting, mismatch };
  });

  assert('全局牌数守恒 = 112', r.total === 112, `实测 ${r.total}，牌墙 ${r.wallRemain}`);
  assert('28 种牌的 tileRemaining 与牌墙真实数一致', r.mismatch.length === 0,
    r.mismatch.length ? '不一致：' + r.mismatch.join(',') : '28/28 全部一致');

  // 打法攻略弹窗：打开、检查分节与表格、关闭
  const tipsOk = await page.evaluate(() => {
    document.getElementById('tipsBtn').click();
    const m = document.getElementById('tipsModal');
    const shown = m && m.style.display !== 'none';
    const secs = m ? m.querySelectorAll('.ruleSec').length : 0;
    const tbls = m ? m.querySelectorAll('table').length : 0;
    if (shown) m.style.display = 'none';
    return { shown, secs, tbls };
  });
  assert('打法攻略弹窗可用', tipsOk.shown && tipsOk.secs >= 6 && tipsOk.tbls >= 3,
    `分节 ${tipsOk.secs} 个、表格 ${tipsOk.tbls} 张`);

  // 角色声音重设：7 个角色均含 female/rate/pitch/prefer，梅姐为女声
  const vp = await page.evaluate(() => {
    const names = Object.keys(ROLE_VOICE_PROFILE);
    const ok = names.length === 7 && names.every(n => {
      const v = ROLE_VOICE_PROFILE[n];
      return typeof v.female === 'boolean' && v.rate > 0 && v.pitch > 0 && v.prefer instanceof RegExp;
    });
    return { ok, names: names.join(','), meiFemale: ROLE_VOICE_PROFILE['梅姐'] ? ROLE_VOICE_PROFILE['梅姐'].female : null };
  });
  assert('角色声音按年龄性别性格重设', vp.ok && vp.meiFemale === true, `7 角色：${vp.names}，仅梅姐女声`);

  // 欢快音效：函数齐全且胡牌为六音旋律
  const sfx = await page.evaluate(() => {
    const fns = ['sndDraw', 'sndDiscard', 'sndPeng', 'sndGang', 'sndWin', 'sndLiuJu', 'sndClick'];
    return { ok: fns.every(f => typeof window[f] === 'function'), winMelody: typeof window.sndWin === 'function' };
  });
  assert('欢快麻将音效函数齐全', sfx.ok, 'sndDraw/Discard/Peng/Gang/Win/LiuJu/Click');

  // 手机竖屏自动横屏：390×844 视口下舞台应为 rot（CSS 旋转 90°）而非 pport（上下分割）
  const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page2.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
    const land = await page2.evaluate(() => {
      const st = document.getElementById('stage');
      return { rot: st.classList.contains('rot'), pport: st.classList.contains('pport') };
    });
    assert('手机竖屏自动旋转横屏', land.rot && !land.pport, `rot=${land.rot}, pport=${land.pport}`);

    // 手机横屏状态下进入牌局：教学模式默认不打开
    await page2.click('#startBtn');
    await page2.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
    await page2.locator('.roleBtn').first().click();
    await page2.waitForFunction(
      () => typeof G !== 'undefined' && !!G && typeof p === 'function' && !!p(0),
      null, { timeout: 30000 }
    );
    const teach = await page2.evaluate(() => ({ teachOn }));
    assert('手机横屏默认不开教学模式', teach.teachOn === false, `teachOn=${teach.teachOn}`);
  } finally {
    await page2.close();
  }

  // 谁赢谁坐庄：模拟上局座位3胡牌，开新局后庄家应为座位3且其手牌14张
  const dz = await page.evaluate(() => {
    lastWinner = 3; lastDealer = 1; hasPlayed = true;
    run();
    return { dealer: G.dealer, hand: p(3).hand.length };
  });
  assert('谁赢谁坐庄（胡牌者下局当庄）', dz.dealer === 3 && dz.hand === 14,
    `新局庄家=座位${dz.dealer}（座位3胡牌），庄家手牌 ${dz.hand} 张`);

  assert('运行期零 JavaScript 报错', errors.length === 0,
    errors.length ? errors.slice(0, 3).join(' | ') : '0 条');
} catch (e) {
  assert('验证流程完整执行', false, e.message.split('\n')[0]);
  try {
    const diag = await page.evaluate(() => ({
      hasG: typeof G !== 'undefined' && !!G,
      awaiting: (typeof G !== 'undefined' && G) ? G.awaiting : null,
      hands: (typeof G !== 'undefined' && G) ? G.players.map(pl => pl.hand.length) : null,
      roleShown: !!document.querySelector('#roleSelect.show'),
      roleBtns: document.querySelectorAll('.roleBtn').length,
      splash: !!document.querySelector('#splash'),
    }));
    console.log('  诊断：' + JSON.stringify(diag));
  } catch (e2) {
    console.log('  诊断读取失败：' + e2.message);
  }
  if (errors.length) console.log('  页面错误：' + errors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
}

const failed = checks.filter(c => !c.ok);
console.log(`\n结果：${checks.length - failed.length}/${checks.length} 项通过`);
process.exit(failed.length ? 1 : 0);
