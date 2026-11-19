/* CDP 真实浏览器冒烟：装备侧边栏渲染 / 陷阱与宝箱怪 / 无运行时异常 */
const { spawn } = require('child_process');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9343;
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
    `--remote-debugging-port=${PORT}`, '--user-data-dir=' + __dirname + '/.chrome-tmp8',
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
  const send = (method, params) => new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  async function evalJs(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('EVAL_ERR: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }

  await send('Runtime.enable', {});
  await send('Page.enable', {});
  await send('Page.navigate', { url: URL_ });
  await sleep(1800);

  console.log('== 侧边栏与升级节奏 ==');
  console.log(await evalJs(`JSON.stringify({
    sideLen: document.querySelector('#eqSide').innerHTML.length,
    sideHasStats: document.querySelector('#eqSide').innerHTML.indexOf('装备 · 属性') >= 0,
    modeEvery: ABYSS.CFG.levelup.modeEvery,
    nerfed: ABYSS.ATTR_META.hp.vals[4] === 108
  })`));

  console.log('== 模拟升级 → 选卡 → 侧边栏刷新 ==');
  const lv = await evalJs(`
    (function(){
      const p = ABYSS.state.player;
      ABYSS.state.pendingLevelUps = 1;
      ABYSS.showLevelUp();
      const card = ABYSS.makeLevelCards(p)[0];
      ABYSS.chooseLevelCard(card);
      return JSON.stringify({ sideLen: document.querySelector('#eqSide').innerHTML.length, phase: ABYSS.state.phase });
    })()
  `);
  console.log(lv);

  console.log('== 伪装陷阱链路 ==');
  const trap = await evalJs(`
    (function(){
      const st = ABYSS.state;
      const p = st.player;
      p.iframes = 0;
      st.obstacles = [{ x: p.x - 20, y: p.y - 20, w: 40, h: 40, trap: { armed: true, trigT: 0 } }];
      return { hp0: Math.round(p.hp) };
    })()
  `);
  await sleep(600);
  console.log(await evalJs(`JSON.stringify({
    hp0: ${trap.hp0},
    hpNow: Math.round(ABYSS.state.player.hp),
    disarmed: ABYSS.state.obstacles[0].trap.armed === false,
    revealed: ABYSS.state.obstacles[0].trap.trigT > 0
  })`));

  console.log('== 宝箱怪全链路 ==');
  const mim = await evalJs(`
    (function(){
      const st = ABYSS.state;
      st.chests = [];
      st.chests.push({ x: st.player.x + 10, y: st.player.y, opened: false, rarBonus: 1, t: 0, mimic: true });
      return 'armed';
    })()
  `);
  await sleep(700);
  console.log(await evalJs(`JSON.stringify({
    mimicAlive: ABYSS.state.foes.some(f => !f.dead && f.name === '宝箱怪'),
    phase: ABYSS.state.phase
  })`));
  await evalJs(`(function(){ const m = ABYSS.state.foes.find(f => f.name === '宝箱怪'); ABYSS.dealDamage(ABYSS.state.player, m, 99999); return 'killed'; })()`);
  await sleep(400);
  console.log(await evalJs(`JSON.stringify({
    realChest: ABYSS.state.chests.length > 0 && ABYSS.state.chests[0].mimic === false,
    banner: ABYSS.state.banner ? ABYSS.state.banner.text : null
  })`));

  console.log('== 10 秒常规战斗 ==');
  await sleep(10000);
  console.log(await evalJs(`JSON.stringify({ phase: ABYSS.state.phase, kills: ABYSS.state.kills, minute: ABYSS.state.wave })`));

  console.log('== 运行时异常 ==');
  const realErr = exceptions.filter(e => !/favicon/.test(e));
  console.log(realErr.length ? realErr.join('\n---\n') : '无异常 ✓');

  ws.close();
  chrome.kill();
  process.exit(realErr.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); try { chrome.kill(); } catch (_) {} process.exit(1); });
