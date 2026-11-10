// 天胡/地胡计分端到端测试（临时）：npm 不挂，直接 node scripts/_tmp-tianhu.mjs
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('file:///D:/2-workbuddy/5-红中麻将/hongzhong-mahjong/index.html', { waitUntil: 'load' });
await page.evaluate(() => { CFG.diceAuto = 100; CFG.diceMs = 50; CFG.diceGap = 40; CFG.diceHold = 50; });
await page.click('#startBtn');
await page.locator('.roleBtn').first().click();
await page.waitForFunction(() => typeof G !== 'undefined' && !!G, null, { timeout: 20000 });
const r = await page.evaluate(async () => {
  window.__mk = (id, uid) => ({ id, uid, suit: id[0], rank: parseInt(id[1], 10) });
  const me = p(0);
  const winHand = ['W1','W1','W1','W2','W2','W2','W3','W3','W3','W4','W4','W4','W5','W5'].map((x, i) => window.__mk(x, 800000 + i));
  const results = {};
  for (const how of ['tianhu', 'dihu', 'zimo']) {
    me.hand = winHand.slice(); me.melds = []; me.discard = [];
    G.over = false;
    showWin(0, how, { win: true, sevenPairs: false, allPong: false, qingyise: false, deluxeSeven: false });
    await new Promise(rs => setTimeout(rs, 250));
    const modal = document.querySelector('#stage > .mask:last-child');
    const html = modal ? modal.innerHTML : '';
    const fan = how === 'tianhu' ? '<span>天胡</span><span>×4</span>' : how === 'dihu' ? '<span>地胡</span><span>×2</span>' : '<span>不存在</span>';
    const score = (html.match(/本局胡牌得分<\/span><span class="plus">(\d+)<\/span>/) || [])[1];
    const title = (html.match(/<h3[^>]*>([^<]*)</) || [])[1];
    results[how] = { hasFan: html.includes(fan), score: Number(score), title };
    // 折叠开关（2026-11-10 结算弹窗瘦身）：点头部应切换 .open
    if (how === 'zimo') {
      const fold = modal ? modal.querySelector('#wpFold') : null;
      const btn = modal ? modal.querySelector('#wpFoldBtn') : null;
      const before = fold ? fold.classList.contains('open') : null;
      if (btn) btn.click();
      results.wpFold = { exists: !!fold && !!btn, toggles: fold ? fold.classList.contains('open') !== before : false };
    }
    const close = modal ? modal.querySelector('#mClose') : null; if (close) close.click();
    await new Promise(rs => setTimeout(rs, 120));
  }
  return results;
});
console.log(JSON.stringify(r, null, 1));
const okTian = r.tianhu.hasFan && r.dihu.hasFan && r.tianhu.score === r.dihu.score * 2 && r.dihu.score === r.zimo.score * 2 && r.tianhu.title === '天胡！' && r.dihu.title === '地胡！';
const okFold = r.wpFold && r.wpFold.exists && r.wpFold.toggles;
console.log(okTian ? '✓ 天胡×4/地胡×2 计分链路正确（自摸基线 ' + r.zimo.score + ' → 地胡 ' + r.dihu.score + ' → 天胡 ' + r.tianhu.score + '）' : '✗ 计分异常');
console.log(okFold ? '✓ 师傅讲解折叠开关正常' : '✗ 折叠开关异常');
await browser.close();
process.exit(okTian && okFold ? 0 : 1);
