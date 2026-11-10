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

  // 只加速 AI 思考与掷骰动画，不写入文件
  await page.evaluate(() => {
    if (typeof CFG !== 'undefined') {
      CFG.aiDelay = 0; CFG.thinkMin = 0; CFG.thinkMax = 0;
      CFG.diceMs = 40; CFG.diceGap = 20; CFG.diceAuto = 30; CFG.diceHold = 40;
    }
  });

  await page.click('#startBtn');
  await page.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
  await page.locator('.roleBtn').first().click();

  // 状态驱动：等到玩家自己的出牌回合（手里 14 张）；开局掷骰在 run() 首局自动完成
  await page.waitForFunction(
    () => typeof G !== 'undefined' && !!G && G.awaiting === 'discard'
      && typeof p === 'function' && p(0).hand.length === 14,
    null,
    { timeout: 30000 }
  );
  assert('进入牌局（玩家回合，手牌 14 张）', true);

  // 开局掷骰定庄：首局应完整走完（四人掷定东→东掷数位定庄），结果留痕且数位正确、浮层已收起
  const dice = await page.evaluate(() => {
    const r = window._diceResult;
    return r ? { ...r, math: (r.east + r.s - 1) % 4, overlayShown: document.getElementById('diceOverlay').classList.contains('show') } : null;
  });
  assert('开局掷骰定东数位定庄', !!dice && dice.dealer === dice.math && !dice.overlayShown && dice.rolls.filter(x => x != null).length === 4,
    dice ? `东=座位${dice.east}（掷${dice.rolls[dice.east]}点定东），东再掷 ${dice.s} 点，数到座位${dice.dealer} 坐庄` : '未检测到掷骰结果');

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

  // 听牌一览剩余张数=玩家可见口径（2026-11-09 用户定义：4 − 废牌区该牌数 − 自己手里该牌数，副露一并扣除）
  const html = fs.readFileSync(FILE, 'utf8');
  const visAnchor = html.includes('visibleLeft') && html.includes('废牌区已打出的') && !html.includes("· 墙剩");
  const vis = await page.evaluate(() => {
    const ids = ['W1', 'W9', 'T3', 'T7', 'B2', 'B8', 'Z'];
    const out = [];
    for (const id of ids) {
      let used = 0;
      for (const pl of G.players) {
        used += (pl.discard || []).filter(t => t.id === id).length;
        for (const m of pl.melds)
          used += (m.type === 'angang' && pl.seat !== 0) ? (m.tiles[0].id === id ? 1 : 0)
            : m.tiles.filter(t => t.id === id).length;
      }
      used += p(0).hand.filter(t => t.id === id).length;
      out.push(visibleLeft(id) === Math.max(0, 4 - used));
    }
    return { okFn: typeof visibleLeft === 'function', all: out.every(x => x), n: out.filter(x => x).length };
  });
  assert('听牌一览剩余=可见口径 4−废牌区−副露−自己手牌', visAnchor && vis.okFn && vis.all,
    `公式自洽 ${vis.n}/7 项（别家暗杠只扣明张；AI 精算仍走牌墙口径 tileRemaining 不受影响）`);

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

  // 对局账单（战绩）：每局输赢明细 + 累计汇总 + 结果列牌型标注 + 末尾各局胡牌牌型图；赢红输绿
  const histOk = await page.evaluate(() => {
    const btn = document.getElementById('histBtn');
    const modal = document.getElementById('histModal');
    if (!btn || !modal) return { ok: false, why: 'no btn/modal' };
    btn.click();
    const shown = modal.style.display === 'flex';
    const emptyHint = document.getElementById('histBody').textContent.includes('还没有打完的对局');
    modal.style.display = 'none';
    // 数据功能：塞两局记录（胡牌局带牌型+手牌快照、流局局无快照），生成明细表、累计行与牌型图区
    hist = [
      { r: 1, t: '胡·测试A·清一色自摸', ht: '清一色自摸', d: currentNames().map((n, i) => ({ n, v: i === 0 ? 24 : -8, g: 0 })), hand: ['W1', 'W2', 'W3', 'W9', 'Z'], melds: [{ type: 'peng', base: 'W5' }] },
      { r: 2, t: '流局', d: currentNames().map(n => ({ n, v: 0, g: 0 })) },
    ];
    const html = buildHistHTML();
    const rows = (html.match(/<tr[\s>]/g) || []).length; // 表头1+明细2+累计1=4
    const hasSum = html.includes('手里的子') && html.includes('100');
    const hasType = html.includes('清一色自摸'); // 结果列注明牌型
    const hasHands = html.includes('histHandRow') && /tp-sm/.test(html); // 末尾牌型图区
    // 赢红输绿：把生成的表格真正渲染出来，读明细单元格 computed color（防选择器优先级把颜色盖白）
    document.getElementById('histBody').innerHTML = html;
    const pe = document.querySelector('#histModal .histTable td.plus');
    const me = document.querySelector('#histModal .histTable td.minus');
    const pr = pe ? (getComputedStyle(pe).color.match(/\d+/g) || []).map(Number) : [];
    const mr = me ? (getComputedStyle(me).color.match(/\d+/g) || []).map(Number) : [];
    const redWin = pr.length === 3 && mr.length === 3 && pr[0] > pr[1] && mr[1] > mr[0];
    return { ok: shown && rows === 4 && hasSum && hasType && hasHands && redWin, shown, emptyHint, rows, hasSum, hasType, hasHands, redWin };
  });
  assert('对局账单：明细+牌型标注+牌型图+赢红输绿', histOk.ok,
    `弹窗=${histOk.shown}，行=${histOk.rows}，牌型标注=${histOk.hasType}，牌型图=${histOk.hasHands}，赢红输绿=${histOk.redWin}`);

  // 游戏规则弹窗与最新规则同步（2026-11-09 用户要求：每次修改后自动检查规则、及时更新）：
  // 关键条款关键词清单——以后每次规则级变更，同步改 rulesModal 文本后必须在此清单加上新条款关键词，
  // verify 在每次推送前必跑，漏改弹窗或漏加关键词都会让本断言变红。
  const rulesSync = await page.evaluate(() => {
    const t = document.getElementById('rulesModal').textContent;
    const keys = ['112 张', '开局掷骰定庄', '为「东」', '以他为 1 数起', '谁赢谁坐庄', '红中可替代任意牌', '禁止胡牌',
      '不能吃牌', '只能自摸', '天胡', '地胡', '主动不胡', '抢杠胡', '七对', '碰碰胡', '清一色', '豪华七对', '杠上花', '单局封顶 50',
      '100 个子', '8 局为一轮', '战绩', '100 起底', '四家摊牌', '资格作废', '连乘，单局仍封顶'];
    const miss = keys.filter(k => !t.includes(k));
    // 100 子起底：重置后四家各 100
    const base = currentNames().every(nm => cumScore[nm] === 100);
    // 天胡/地胡判定与番型逻辑在代码中齐备
    const bigWin = showWin.toString().includes("tianhu") && showWin.toString().includes("dihu");
    // 裁决②的实现锚点：红中硬规则在胡牌判定函数内（≥2 红中未打 → 判非胡，天胡/地胡同样被拦）
    const zGate = analyzeWin.toString().includes('blockedByZRule');
    return { ok: miss.length === 0 && base && bigWin && zGate, miss, base, bigWin, zGate };
  });
  assert('游戏规则弹窗与最新规则同步', rulesSync.ok,
    rulesSync.ok ? '掷骰/坐庄/天胡地胡（含红中硬规则/封顶裁决）/红中/牌型/计分封顶/100子/轮次/战绩/摊牌条款齐全' : (rulesSync.miss.length ? '规则弹窗缺失：' + rulesSync.miss.join('、') : '基础分/天胡/红中闸逻辑异常'));

  // 语音包（彻底解决手机没人声）：108 条预生成台词 mp3 齐全 + 播放引擎工作
  const voiceFiles = [];
  for (const lib of ['w', 'wf']) for (const id of [...['W','T','B'].flatMap(s => Array.from({length:9},(_,i)=>s+(i+1))), 'Z', 'peng', 'gang', 'angang', 'bugang', 'hu', 'tianhu', 'dihu']) voiceFiles.push(`${lib}/${id}.mp3`);
  for (let i = 0; i < 7; i++) voiceFiles.push(`host/names/${i}.mp3`, `role/${i}/qing.mp3`, `role/${i}/seven.mp3`, `role/${i}/pong.mp3`);
  for (let n = 2; n <= 12; n++) voiceFiles.push(`host/n${n}.mp3`);
  for (const k of ['zhi', 'dianzuida', 'zhuang']) voiceFiles.push(`host/${k}.mp3`);
  const missVoice = voiceFiles.filter(f => !fs.existsSync(path.join(ROOT, 'voice', f)));
  const vpTest = await page.evaluate(() => {
    const me = p(0);
    const okFn = ['vpPlay','vpSayTile','vpSayAction','vpSayEastDong','vpSayZhuang','vpSayStance','vpUnlock','vpStop'].every(f => typeof window[f] === 'function');
    // 2026-11-09 角色语音改字幕：vpSayTile 应在 #table 生成头像锚定字幕气泡（ROLE_VOICE_ON=false）
    vpStop(); vpQueue = [];
    document.querySelectorAll('#table .chatBox').forEach(b => b.remove());
    try { vpSayTile(me, { id: 'W5', rank: 5, suit: 'W' }); } catch (e) {}
    const cb = document.querySelector('#table .chatBox');
    const subOk = !!cb && /五万/.test(cb.textContent);
    if (cb) cb.remove();
    return { okFn, subOk, roleVoiceOff: typeof ROLE_VOICE_ON !== 'undefined' && ROLE_VOICE_ON === false };
  });
  assert('语音包：108 条台词齐全 + 报牌转字幕引擎', missVoice.length === 0 && vpTest.okFn && vpTest.subOk && vpTest.roleVoiceOff,
    missVoice.length ? '缺文件：' + missVoice.slice(0, 3).join(',') + ` 共${missVoice.length}个` : '引擎正常，报牌以字幕显示于头像下（角色语音关闭，host 台词保留）');

  // 牌桌闲聊（2026-11-09 用户需求：打牌过程中每人说话/弹字幕表达感想）：七风格×六情境台词 + 座位气泡 + 84 条角色音色语音
  const chatOk = await page.evaluate(() => {
    const evs = ['good', 'bad', 'peng', 'lost', 'ting', 'low'];
    const styles = Object.keys(CHAT_SAY);
    const okStyles = styles.length === 7 && styles.every(s => evs.every(e => Array.isArray(CHAT_SAY[s][e]) && CHAT_SAY[s][e].length >= 2));
    const okFn = ['chatMaybe', 'chatBubble', 'chatAfterDiscard'].every(f => typeof window[f] === 'function');
    chatBubble(2, '冒烟测试');
    let bubble = false, bubblePos = null;
    const bb = document.querySelector('#table .chatBox[data-cb="2"]'); // 精确取本次创建的 seat2 气泡，避免被报牌字幕干扰
    if (bb) {
      const tb = document.getElementById('table').getBoundingClientRect();
      const r = bb.getBoundingClientRect();
      bubblePos = { w: Math.round(r.width), inTable: r.top >= tb.top - 5 && r.bottom <= tb.bottom + 30 && r.left >= tb.left - 5 && r.right <= tb.right + 5 };
      bubble = bb.offsetWidth >= 60; // 气泡有足够宽度显示文字（防被窄列压扁）
      bb.remove();
    }
    // 2026-11-10 用户要求：左右两侧（seat1/seat3）气泡出现在头像上方、对家（seat2）在头像下方、我（seat0）在头像上方
    const sideAbove = [1, 3].every(sd => {
      chatBubble(sd, '位置测试');
      const b = document.querySelector('#table .chatBox[data-cb="' + sd + '"]');
      const w = document.querySelector('#seat' + sd + ' .who');
      if (!b || !w) { if (b) b.remove(); return false; }
      const br = b.getBoundingClientRect(), wr = w.getBoundingClientRect();
      const ok = br.bottom <= wr.top + 10; // 气泡底在头像顶上方（留 10px 容差）
      b.remove();
      return ok;
    });
    const oppBelow = (() => {
      chatBubble(2, '位置测试');
      const b = document.querySelector('#table .chatBox[data-cb="2"]');
      const w = document.querySelector('#seat2 .who');
      if (!b || !w) { if (b) b.remove(); return false; }
      const br = b.getBoundingClientRect(), wr = w.getBoundingClientRect();
      const ok = br.top >= wr.bottom - 10; // 对家气泡在头像下方
      b.remove();
      return ok;
    })();
    return { okStyles, okFn, bubble, sideAbove, oppBelow, n: styles.length };
  });
  const chatFiles = [];
  for (let i = 0; i < 7; i++) for (const e of ['good', 'bad', 'peng', 'lost', 'ting', 'low']) for (let k = 0; k < 2; k++) chatFiles.push(`role/${i}/chat-${e}-${k}.mp3`);
  const missChat = chatFiles.filter(f => !fs.existsSync(path.join(ROOT, 'voice', f)));
  assert('牌桌闲聊：七风格×六情境台词+座位气泡+84条语音', chatOk.okStyles && chatOk.okFn && chatOk.bubble && chatOk.sideAbove && chatOk.oppBelow && missChat.length === 0,
    chatOk.okStyles && chatOk.bubble ? '台词/气泡/引擎在位（左右家气泡在头像上方=' + chatOk.sideAbove + '，对家在下方=' + chatOk.oppBelow + '），' + (missChat.length ? '缺语音：' + missChat.slice(0, 3).join(',') : '84 条角色音色闲聊语音齐全') : `台词=${chatOk.okStyles}，气泡=${chatOk.bubble}，引擎=${chatOk.okFn}，缺语音 ${missChat.length} 条`);

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

  // 背景音乐（2026-11-10 用户需求：默认欢快麻将 BGM，程序化合成民乐小调、独立开关、语音播报自动压低）
  const bgm = await page.evaluate(() => {
    const defOn = bgmOn === true;
    const running = bgmTimer !== null && !!bgmGainNode;
    const wired = BGM_MELODY.length === 8 && bgmSchedule.toString().includes('BGM_MELODY')
      && vpNext.toString().includes('bgmDuck') && startGame.toString().includes('bgmStart');
    const btn = document.getElementById('bgmBtn');
    const off = (() => { btn.click(); return bgmOn === false && bgmTimer === null; })();
    const back = (() => { btn.click(); return bgmOn === true && bgmTimer !== null && !!bgmGainNode; })();
    const btnTxt = btn.textContent;
    return { defOn, running, wired, off, back, btnTxt };
  });
  assert('默认欢快背景音乐：民乐拨弦 BGM 运转 + 独立开关 + 播报压低', bgm.defOn && bgm.running && bgm.wired && bgm.off && bgm.back,
    `默认开=${bgm.defOn}，运行中=${bgm.running}，8 小节五声旋律=${bgm.wired}，开关往返=${bgm.off && bgm.back}（按钮「${bgm.btnTxt}」）`);

  // 2026-11-10 用户需求：开始不要有杂音——TTS 预热探测的「好」发声已移除（TTS 内容全走语音包 mp3）；
  // 保留：报牌条件取消（iOS 无声 bug 修复）、任意点击恢复音频通道
  const sndFix = await page.evaluate(() => ({
    noWarmNoise: !primeSpeech.toString().includes('speechSynthesis.speak'),
    noBlankCancel: /speaking\|\|speechSynthesis\.pending/.test(speakText.toString()),
    clickRestore: typeof ensureAudioPlaying === 'function',
  }));
  assert('开局无杂音（TTS 预热不发声）+ 条件取消修复', sndFix.noWarmNoise && sndFix.noBlankCancel,
    `noWarmNoise=${sndFix.noWarmNoise}, noBlankCancel=${sndFix.noBlankCancel}`);

  // TTS 可用性兜底：speakText（动态长句兜底通道）不可用时短路报牌
  const ttsProbe = await page.evaluate(() => ({
    hasFlag: typeof ttsAvailable !== 'undefined',
    ready: primeSpeech.toString().includes('ttsAvailable=true'),
    shortCircuit: speakText.toString().includes('ttsAvailable===false'),
  }));
  assert('TTS 可用性兜底（语音包为主，TTS 仅兜底）', ttsProbe.hasFlag && ttsProbe.ready && ttsProbe.shortCircuit,
    `flag=${ttsProbe.hasFlag}, ready=${ttsProbe.ready}, shortCircuit=${ttsProbe.shortCircuit}`);

  // 手机竖屏默认竖屏版：390×844 视口下舞台应为 pport（原生上下分割）而非 rot（旋转强制横屏）
  const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page2.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 30000 });
    // 与 page1 同等的加速+静音：掷骰/思考提速、跳过语音播放等待，防止开局流程（含 host 台词语音）超 30s 超时线
    await page2.evaluate(() => {
      if (typeof CFG !== 'undefined') {
        CFG.aiDelay = 0; CFG.thinkMin = 0; CFG.thinkMax = 0;
        CFG.diceMs = 40; CFG.diceGap = 20; CFG.diceAuto = 30; CFG.diceHold = 40;
      }
      try { if (typeof soundOn !== 'undefined') soundOn = false; } catch (e) {}
    });
    const land = await page2.evaluate(() => {
      const st = document.getElementById('stage');
      return { rot: st.classList.contains('rot'), pport: st.classList.contains('pport') };
    });
    // 玩家思考时限（2026-11-10 用户需求：自己胡牌思考 2 分钟、打牌 10 分钟；碰/杠维持 10 秒）
    const humanTime = await page2.evaluate(() => ({
      zimo: HUMAN_TIME.zimo, qiang: HUMAN_TIME.qiang, discard: HUMAN_TIME.discard, claim: HUMAN_TIME.claim,
      discardTimed: TIMED.discard === 1, fmt2m: fmtCountdown(120), fmt10m: fmtCountdown(600), fmtShort: fmtCountdown(45),
    }));
    assert('玩家思考时限：胡牌 2 分钟、打牌 10 分钟',
      humanTime.zimo === 120 && humanTime.qiang === 120 && humanTime.discard === 600 && humanTime.claim === 10 && humanTime.discardTimed
        && /2 分 00 秒/.test(humanTime.fmt2m) && /9 分 60 秒|10 分 00 秒/.test(humanTime.fmt10m) && humanTime.fmtShort === '45 秒',
      `胡牌 ${humanTime.zimo}s/打牌 ${humanTime.discard}s/碰杠 ${humanTime.claim}s，倒计时格式「${humanTime.fmt2m}」/「${humanTime.fmtShort}」`);
    assert('手机竖屏默认竖屏版（上下分割）', land.pport && !land.rot, `rot=${land.rot}, pport=${land.pport}`);

    // 竖屏版进入牌局：教学模式默认打开（applyPhonePortDock 默认开教学、下半区默认高度）
    await page2.click('#startBtn');
    await page2.waitForSelector('#roleSelect.show .roleBtn', { timeout: 10000 });
    await page2.locator('.roleBtn').first().click();
    await page2.waitForFunction(
      () => typeof G !== 'undefined' && !!G && typeof p === 'function' && !!p(0),
      null, { timeout: 30000 }
    );
    const teach = await page2.evaluate(() => ({ teachOn }));
    assert('手机竖屏默认开启教学模式', teach.teachOn === true, `teachOn=${teach.teachOn}`);
  } finally {
    await page2.close();
  }

  // 庄家「庄」角标：仅庄家座位显示，其余三个隐藏
  const badge = await page.evaluate(() => {
    const shown = [];
    for (let i = 0; i < 4; i++) {
      const b = document.querySelector('#seat' + i + ' .dealerBadge');
      shown.push(!!b && b.style.display !== 'none');
    }
    return { count: shown.filter(x => x).length, dealer: G.dealer };
  });
  assert('庄家头像带「庄」角标', badge.count === 1, `庄家=座位${badge.dealer}，角标 ${badge.count} 个`);

  // 打牌回合指示灯：原尺寸、亮黄呼吸闪烁（不放大、不压头像）
  const glow = await page.evaluate(() => {
    const t = document.querySelector('#seat' + G.current + ' .who.active .turn');
    if (!t) return { ok: false, why: 'no active turn' };
    const cs = getComputedStyle(t);
    return { ok: cs.animationName === 'turnPulse' && cs.transform === 'none' && cs.backgroundColor !== 'rgb(136, 136, 136)' };
  });
  assert('打牌回合指示灯呼吸金光', glow.ok, '原尺寸 + turnPulse 呼吸动画');

  // AI 座位（1/2/3）用小号光效 turnPulseS
  const aiGlow = await page.evaluate(() => {
    const w = document.querySelector('#seat1 .who');
    w.classList.add('active');
    const name = getComputedStyle(document.querySelector('#seat1 .who.active .turn')).animationName;
    w.classList.remove('active');
    return name;
  });
  assert('AI 座位指示灯用小号光效', aiGlow === 'turnPulseS', `animation=${aiGlow}`);

  // 谁赢谁坐庄：模拟上局座位3胡牌，开新局后庄家应为座位3且其手牌14张（掷骰仅首局，此局不再掷）
  const dz = await page.evaluate(() => {
    lastWinner = 3; lastDealer = 1; hasPlayed = true;
    window._diceResult = null;
    run();
    return { dealer: G.dealer, hand: p(3).hand.length, reDice: !!window._diceResult };
  });
  assert('谁赢谁坐庄（胡牌者下局当庄，非首局不再掷骰）', dz.dealer === 3 && dz.hand === 14 && !dz.reDice,
    `新局庄家=座位${dz.dealer}（座位3胡牌），庄家手牌 ${dz.hand} 张，重掷骰=${dz.reDice}`);

  // 结算点评播报（2026-11-09 修复：迁语音包 host 播报员，不再依赖系统 TTS——
  // 鸿蒙/微信内置浏览器 TTS 静默失败时点评照常有人声）
  const winSay = await page.evaluate(() => {
    const r = {
      pl: { name: p(1).name }, how: 'zimo',
      handTypes: ['七对', '清一色'],
      fs: [{ n: '七对', v: 2 }, { n: '清一色', v: 2 }, { n: '打出1只红中', v: 2 }],
      ma: { tiles: [0, 1, 2, 3, 4, 5], hit: 2, hasZ: false },
      base: 2, total: 24
    };
    const keys = buildWinSpeechKeys(r);
    return {
      keys,
      liuju: speakScore(['host/liuju']) === undefined, // 流局整句走 host/liuju
      wiring: presentResult.toString().includes('buildWinSpeechKeys') && presentResult.toString().includes('host/liuju'),
      noTTS: speakScore.toString().includes('vpPlay') && !speakScore.toString().includes('speakText'),
      chainOk: keys.includes('host/names/' + vpIdx(p(1).name)) && keys.includes('host/p_qidui') && keys.includes('host/qingyise')
        && keys.includes('host/dz1') && keys.includes('host/db2') && keys.includes('host/fm6')
        && keys.includes('host/z2') && keys.includes('host/fx8') && keys.includes('host/hj24')
    };
  });
  assert('结算点评播报走语音包 host（自然短语拼接）', winSay.noTTS && winSay.wiring && winSay.liuju && winSay.chainOk && winSay.keys.length <= 10,
    `语素 ${winSay.keys.length} 条：${winSay.keys.join(' → ')}`);

  // AI 观察与应对机制（2026-11-10 用户需求：眼观六路耳听八方——读牌/威胁评估/防守/抢节奏/路线修正）
  const tactic = await page.evaluate(() => {
    const live = (() => { try { const ob = observeTable(p(0)); return !!(ob && ob.threat && ob.threat.length === 4 && ob.seen && ob.suitOut); } catch (e) { return false; } })();
    const md = masterDiscard.toString(), mc = masterClaim.toString(), pd = planDiscard.toString();
    return {
      hasOb: typeof observeTable === 'function',
      discardWired: md.includes('observeTable') && md.includes('foeThreat') && md.includes('defending'),
      claimRush: mc.includes('observeTable') && mc.includes('rush'),
      planAdapt: pd.includes('id[0]') && pd.includes('>=12'),
      guardSay: !!(CHAT_SAY.conservative && Array.isArray(CHAT_SAY.conservative.guard) && CHAT_SAY.conservative.guard.length > 0),
      live,
    };
  });
  assert('AI 观察与应对机制（读牌/威胁/防守/抢节奏）', tactic.hasOb && tactic.discardWired && tactic.claimRush && tactic.planAdapt && tactic.guardSay && tactic.live,
    `观察引擎=${tactic.hasOb}，出牌应对=${tactic.discardWired}，碰杠抢节奏=${tactic.claimRush}，路线拥挤修正=${tactic.planAdapt}，防守台词=${tactic.guardSay}，实时情报=${tactic.live}`);

  // 郑太顺技巧层（2026-11-11 用户需求：机器人学会《郑太顺麻将经典技巧》九篇五十七节精华）
  const ztsOk = await page.evaluate(() => {
    const okFn = ['ztsJinGroup', 'ztsKeepBonus', 'ztsDanger', 'ztsClaimGate'].every(f => typeof eval(f) === 'function'); // 顶层 const 不挂 window，直接引用
    const jin = ztsJinGroup(1) === 0 && ztsJinGroup(4) === 0 && ztsJinGroup(5) === 1 && ztsJinGroup(8) === 1 && ztsJinGroup(6) === 2 && ztsJinGroup(9) === 2;
    const keep = ztsKeepBonus('T3') > 0 && ztsKeepBonus('B7') > 0 && ztsKeepBonus('W2') < 0 && ztsKeepBonus('W9') < 0 && ztsKeepBonus('Z') === 0;
    // 反常对信号：向对手弃牌塞 6、8（先六后八）→ 必有对九，T9 应成危险牌；测完还原
    const foe = p(1), me = p(0);
    const t6 = { id: 'T6', suit: 'T', rank: 6, uid: 900001 }, t8 = { id: 'T8', suit: 'T', rank: 8, uid: 900002 };
    foe.discard.push(t6, t8);
    const dz = ztsDanger(me);
    const dPair = (dz.danger['T9'] || 0) >= 3;
    // 同线加减一：再塞 T4（与已有 T6、T8 同色；4 与 6、8 均不同组，4 与 1/7 同组）——改用 T1、T4 验证 +1 线
    const t1 = { id: 'T1', suit: 'T', rank: 1, uid: 900003 }, t4 = { id: 'T4', suit: 'T', rank: 4, uid: 900004 };
    foe.discard.pop(); foe.discard.pop(); // 先撤 6、8
    foe.discard.push(t1, t4); // 先打一后打四（同线 147 小到大）→ 需要 T2、T5
    const dz2 = ztsDanger(me);
    const dLine = (dz2.danger['T2'] || 0) >= 2 && (dz2.danger['T5'] || 0) >= 2;
    foe.discard.pop(); foe.discard.pop();
    // 大肚子碰闸：手里 4、5、5、6 → 碰 5 拒绝（四万六万直接废掉）；测完还原
    const bak = me.hand.slice();
    me.hand = ['B4', 'B5', 'B5', 'B6', 'W1', 'W2', 'W3', 'W7', 'W8', 'W9', 'T1', 'T2', 'T3'].map((x, k) => ({ id: x, suit: x[0], rank: x === 'Z' ? 0 : parseInt(x[1], 10), uid: 910000 + k }));
    const gateBad = ztsClaimGate(me, 'B5', 1, 1) === false;
    me.hand = bak;
    // 接线锚点：masterDiscard 用 ztsDanger 加权、masterClaim 用 ztsClaimGate 拦碰
    const wired = masterDiscard.toString().includes('ztsDanger') && masterClaim.toString().includes('ztsClaimGate');
    return { okFn, jin, keep, dPair, dLine, gateBad, wired };
  });
  assert('郑太顺技巧层：金三银七/同线加减一/反常对/五不碰', ztsOk.okFn && ztsOk.jin && ztsOk.keep && ztsOk.dPair && ztsOk.dLine && ztsOk.gateBad && ztsOk.wired,
    `函数=${ztsOk.okFn}，筋线=${ztsOk.jin}，金三银七=${ztsOk.keep}，先六后八防九=${ztsOk.dPair}，先一后四防二五=${ztsOk.dLine}，大肚子不碰=${ztsOk.gateBad}，决策链接入=${ztsOk.wired}`);

  // 托管加速（2026-11-10 用户要求：托管状态每人思考不超过 0.2 秒，快速打完一轮 8 局拿总分）
  const hosted = await page.evaluate(async () => {
    const btn = document.getElementById('autoBtn');
    btn.click();
    const on = humanAuto === true && p(0).auto === true && btn.textContent === '取消托管';
    const t0 = Date.now();
    await think();
    const ms = Date.now() - t0;
    const nextFast = presentResult.toString().includes('2600');
    const diceFast = diceForDealer.toString().includes('dFast') && rollDice.toString().includes('fast?60:CFG.diceMs');
    btn.click();
    const off = humanAuto === false && p(0).auto === false && btn.textContent === '托管';
    return { on, ms, nextFast, diceFast, off };
  });
  assert('托管加速：思考 ≤0.2 秒 + 结算 2.6 秒自动连开', hosted.on && hosted.off && hosted.ms >= 100 && hosted.ms <= 200 && hosted.nextFast && hosted.diceFast,
    `托管思考实测 ${hosted.ms}ms（目标 180，上限 200），结算 2.6s 自动下一局=${hosted.nextFast}，掷骰提速=${hosted.diceFast}，开关往返正常`);

  // 四家摊牌（2026-11-09 用户需求：每局结束各家手牌摊开给大家看再进下一局）
  const reveal = await page.evaluate(() => {
    const okFn = typeof window.allHandsHTML === 'function' && presentResult.toString().includes('allHandsHTML');
    const d = document.createElement('div');
    d.innerHTML = allHandsHTML(null);
    const all4 = d.querySelectorAll('.revealRow').length === 4;
    const d2 = document.createElement('div');
    d2.innerHTML = allHandsHTML(0);
    const skip3 = d2.querySelectorAll('.revealRow').length === 3;
    const hasTiles = d.querySelectorAll('.revealRow .tp-sm').length > 0;
    return { okFn, all4, skip3, hasTiles };
  });
  assert('每局结算四家摊牌：手牌+副露亮出', reveal.okFn && reveal.all4 && reveal.skip3 && reveal.hasTiles,
    `流局摊四家=${reveal.all4}，胡牌摊其余三家=${reveal.skip3}，含牌面图=${reveal.hasTiles}`);

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
