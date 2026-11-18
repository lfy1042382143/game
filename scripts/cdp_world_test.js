/* CDP 真实浏览器验证：宝箱拾取/战利品/事件地点/射程卡/升级降频 */
const { spawn } = require('child_process');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
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
    `--remote-debugging-port=${PORT}`, '--user-data-dir=' + __dirname + '/.chrome-tmp3',
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

  console.log('== 开局 ==');
  console.log(await evalJs(`JSON.stringify({
    phase: ABYSS.state.phase, chests: ABYSS.state.chests.length,
    sites: ABYSS.state.sites.length, foeItems: ABYSS.state.foes.every(f => f.items.length === 0)
  })`));

  console.log('== 宝箱拾取 ==');
  await evalJs(`ABYSS.state.chests.push({ x: ABYSS.state.player.x, y: ABYSS.state.player.y, opened: false, t: 0 }); 'placed'`);
  await sleep(400);
  console.log(await evalJs(`JSON.stringify({ phase: ABYSS.state.phase, loots: ABYSS.state.loots.length })`));
  // 处理战利品（真实 DOM 点击）
  for (let i = 0; i < 4; i++) {
    const r = await evalJs(`
      (function(){
        const lootBtn = document.querySelector('#lootBox .loot-btn:not([disabled])');
        if (lootBtn) { lootBtn.click(); return 'loot'; }
        const cont = document.querySelector('#cards .btn-again');
        if (cont) { cont.click(); return 'continue'; }
        return 'none';
      })()
    `);
    if (r === 'none') break;
    await sleep(250);
  }
  console.log('战利品处理后:', await evalJs(`JSON.stringify({ phase: ABYSS.state.phase, items: ABYSS.state.player.items.length, wave: ABYSS.state.wave })`));

  console.log('== 事件地点触发 ==');
  await evalJs(`
    ABYSS.state.sites.push({ x: ABYSS.state.player.x, y: ABYSS.state.player.y, evt: ABYSS.EVENTS[2], used: false });
    'placed'
  `);   // 商人
  await sleep(400);
  console.log(await evalJs(`JSON.stringify({ phase: ABYSS.state.phase })`));
  await evalJs(`(function(){ const b = document.querySelector('#eventOpts .event-opt'); if (b) { b.click(); return 'clicked'; } return 'none'; })()`);
  await sleep(400);
  console.log(await evalJs(`JSON.stringify({ phase: ABYSS.state.phase, siteUsed: ABYSS.state.sites.every(s => s.used), hp: Math.round(ABYSS.state.player.hp) })`));

  console.log('== 射程卡（真实卡池点击） ==');
  await evalJs(`
    const p = ABYSS.state.player;
    ABYSS.state.pendingLevelUps = 1;
    ABYSS.showLevelUp();
    const cards = document.querySelectorAll('#cards .up-card');
    let found = -1;
    cards.forEach((c, i) => { if (c.textContent.includes('射程')) found = i; });
    if (found >= 0) { cards[found].click(); } else { document.querySelectorAll('#cards .up-card')[0].click(); }
    JSON.stringify({ foundRangeCard: found >= 0 })
  `);
  await sleep(300);
  console.log(await evalJs(`JSON.stringify({ range: ABYSS.state.player.range, rangeMul: ABYSS.state.player.rangeMul, phase: ABYSS.state.phase })`));

  console.log('== 升级降频（二次曲线） ==');
  console.log(await evalJs(`JSON.stringify([ABYSS.xpNeed(1), ABYSS.xpNeed(3), ABYSS.xpNeed(6), ABYSS.xpNeed(10)])`));

  // 游戏循环存活
  await sleep(300);
  const t0 = await evalJs('ABYSS.state.time');
  await sleep(1500);
  const t1 = await evalJs('ABYSS.state.time');
  console.log('循环存活: time增量 =', (t1 - t0).toFixed(3));

  console.log('== 异常 ==', exceptions.length ? exceptions : '无');
  ws.close();
  chrome.kill();
  process.exit(0);
})().catch(e => { console.error('SCRIPT_FAIL', e); process.exit(1); });
