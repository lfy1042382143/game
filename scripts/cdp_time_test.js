/* CDP 真实浏览器验证：时间驱动刷怪/分钟精英/原地宝箱/无追踪/地图解锁 */
const { spawn } = require('child_process');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
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
    `--remote-debugging-port=${PORT}`, '--user-data-dir=' + __dirname + '/.chrome-tmp4',
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

  console.log('== 开局（时间驱动） ==');
  console.log(await evalJs(`JSON.stringify({
    phase: ABYSS.state.phase, foes: ABYSS.state.foes.length,
    chests: ABYSS.state.chests.length, sites: ABYSS.state.sites.length,
    wave: ABYSS.state.wave, homingInPool: ABYSS.LEVEL_POOL.some(c => c.key === 'homing')
  })`));

  console.log('== 连续刷怪（4 秒观察） ==');
  await sleep(4000);
  console.log(await evalJs(`JSON.stringify({ foes: ABYSS.state.foes.length, time: Math.round(ABYSS.state.time) })`));

  console.log('== 分钟整点精英 ==');
  await evalJs(`ABYSS.state.eliteT = ABYSS.CFG.elite.every - 0.5; 'set'`);
  await sleep(1200);
  console.log(await evalJs(`JSON.stringify({
    elites: ABYSS.state.foes.filter(f => f.elite).length,
    eliteHp: ABYSS.state.foes.filter(f => f.elite).map(f => Math.round(f.hp)),
    eliteAffix: ABYSS.state.foes.filter(f => f.elite).map(f => f.affix && f.affix.key)
  })`));

  console.log('== 精英击杀 → 原地宝箱 ==');
  const drop = await evalJs(`
    (function(){
      const e = ABYSS.state.foes.filter(f => f.elite)[0];
      if (!e) return 'no-elite';
      const before = ABYSS.state.chests.length;
      ABYSS.dealDamage(ABYSS.state.player, e, 999999);
      const c = ABYSS.state.chests[ABYSS.state.chests.length - 1];
      return JSON.stringify({
        before, after: ABYSS.state.chests.length,
        atElite: c ? Math.round(Math.hypot(c.x - e.x, c.y - e.y)) : null,
        rarBonus: c ? c.rarBonus : null
      });
    })()
  `);
  console.log(drop);

  console.log('== 宝箱拾取 → 战利品弹窗（真实 DOM 点击） ==');
  await evalJs(`ABYSS.state.chests.push({ x: ABYSS.state.player.x, y: ABYSS.state.player.y, opened: false, rarBonus: 1, t: 0 }); 'placed'`);
  await sleep(400);
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
  console.log(await evalJs(`JSON.stringify({ phase: ABYSS.state.phase, items: ABYSS.state.player.items.length })`));

  console.log('== 地图解锁（4 级 → 第二张） ==');
  console.log(await evalJs(`
    (function(){
      const p = ABYSS.state.player;
      p.level = 3;
      ABYSS.gainXp(ABYSS.xpNeed(3));
      return JSON.stringify({ level: p.level, mapIdx: ABYSS.state.mapIdx, mapName: ABYSS.MAPS[ABYSS.state.mapIdx].name });
    })()
  `));

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
