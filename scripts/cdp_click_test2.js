/* CDP 扩展场景：连升多级 / 胜利+升级 / 地图解锁 / 快速连点 */
const { spawn } = require('child_process');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const URL_ = 'file:///C:/Users/lfy10/Desktop/AI/game/index.html';

function getJson(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, '--user-data-dir=' + __dirname + '/.chrome-tmp2',
    'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try { targets = await getJson('/json'); break; } catch (e) {}
  }
  if (!targets) { console.log('CHROME_FAIL'); chrome.kill(); return; }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let msgId = 0;
  const pending = new Map();
  const exceptions = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      exceptions.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
  };
  function send(method, params) {
    return new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  }
  async function evalJs(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('EVAL_ERR: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }

  await send('Runtime.enable', {});
  await send('Page.enable', {});
  await send('Page.navigate', { url: URL_ });
  await sleep(1500);

  function snap(tag) {
    return evalJs(`JSON.stringify({
      phase: ABYSS.state.phase, pending: ABYSS.state.pendingLevelUps,
      loots: ABYSS.state.loots.length, wave: ABYSS.state.wave,
      level: ABYSS.state.player.level, mapIdx: ABYSS.state.mapIdx,
      overlay: document.getElementById('upgradeOverlay').className,
      cardCount: document.querySelectorAll('#cards .up-card').length
    })`).then(s => console.log(tag, s));
  }

  // ---- 场景 1：连升 3 级，逐张点击 ----
  console.log('---- 场景1: 连升3级 ----');
  await evalJs('ABYSS.gainXp(ABYSS.xpNeed(1)*3 + 30)');
  await sleep(400);
  await snap('S1 弹窗后:');
  for (let i = 0; i < 4; i++) {
    const r = await evalJs(`
      (function(){
        const cards = document.querySelectorAll('#cards .up-card');
        if (!cards.length) return 'NO_CARDS';
        cards[Math.floor(Math.random()*cards.length)].click();
        return 'clicked';
      })()
    `);
    await sleep(350);
    console.log('S1 click' + i + ':', r);
  }
  await snap('S1 完成后:');

  // ---- 场景 2：胜利时带升级（战利品挂起）----
  console.log('---- 场景2: 全灭+升级+战利品 ----');
  await evalJs(`
    ABYSS.gainXp(ABYSS.xpNeed(ABYSS.state.player.level)*2);
    ABYSS.state.foes.forEach(f => { f.hp = 1; });
    'killed-set'
  `);
  await sleep(600);
  await snap('S2 弹窗后:');
  for (let i = 0; i < 5; i++) {
    const r = await evalJs(`
      (function(){
        const cards = document.querySelectorAll('#cards .up-card');
        if (cards.length) { cards[0].click(); return 'clicked-card'; }
        const lootBtn = document.querySelector('#lootBox .loot-btn');
        if (lootBtn) { lootBtn.click(); return 'clicked-loot'; }
        const cont = document.querySelector('#cards .btn-again');
        if (cont) { cont.click(); return 'clicked-continue'; }
        return 'nothing';
      })()
    `);
    await sleep(300);
    console.log('S2 click' + i + ':', r);
  }
  await snap('S2 完成后:');

  // ---- 场景 3：快速连点同一批卡（双击/抖动）----
  console.log('---- 场景3: 快速连点 ----');
  await evalJs('ABYSS.gainXp(ABYSS.xpNeed(ABYSS.state.player.level))');
  await sleep(400);
  await evalJs(`
    (function(){
      const cards = document.querySelectorAll('#cards .up-card');
      for (let i = 0; i < 8 && i < cards.length * 3; i++) {
        const c = document.querySelectorAll('#cards .up-card')[0];
        if (!c) break;
        c.click();
      }
      return 'burst-done';
    })()
  `);
  await sleep(600);
  await snap('S3 完成后:');

  // ---- 场景 4：地图解锁边界（直接跳到里程碑等级）----
  console.log('---- 场景4: 地图解锁 ----');
  await evalJs(`
    const p = ABYSS.state.player;
    p.level = 3;
    ABYSS.gainXp(ABYSS.xpNeed(4));
    'leveled'
  `);
  await sleep(400);
  await snap('S4 升级后:');
  for (let i = 0; i < 2; i++) {
    await evalJs(`(function(){const c=document.querySelector('#cards .up-card'); if(c){c.click();return 'clicked';} return 'no-card';})()`);
    await sleep(300);
  }
  await snap('S4 完成后:');

  // 游戏循环存活检查
  const t0 = await evalJs('ABYSS.state.time');
  await sleep(1500);
  const t1 = await evalJs('ABYSS.state.time');
  console.log('循环存活: time增量 =', (t1 - t0).toFixed(3));

  console.log('== 异常 ==', exceptions.length ? exceptions : '无');
  ws.close();
  chrome.kill();
  process.exit(0);
})().catch(e => { console.error('SCRIPT_FAIL', e); process.exit(1); });
