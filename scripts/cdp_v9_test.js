/* CDP 真实浏览器验证 v9：卡池分流/新攻击方式卡/陷阱/初始属性 */
const { spawn } = require('child_process');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
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
    `--remote-debugging-port=${PORT}`, '--user-data-dir=' + __dirname + '/.chrome-tmp5',
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

  console.log('== 初始属性（玩家已削弱） ==');
  console.log(await evalJs(`JSON.stringify({
    hp: ABYSS.CFG.player.hp, atk: ABYSS.CFG.player.atk, atkCd: ABYSS.CFG.player.atkCd,
    growthDeleted: ABYSS.CFG.growth === undefined,
    modeEvery: ABYSS.CFG.levelup.modeEvery,
    modeCards: ABYSS.MODE_POOL.length, trapChance: ABYSS.CFG.events.trapChance
  })`));

  console.log('== 卡池分流：3 级全属性卡 / 10 级全攻击方式卡 ==');
  console.log(await evalJs(`
    (function(){
      const p = ABYSS.state.player;
      p.level = 3;
      const c3 = ABYSS.makeLevelCards(p).map(c => c.kind);
      p.level = 10;
      const c10 = ABYSS.makeLevelCards(p).map(c => c.kind);
      p.level = 1;
      return JSON.stringify({ lv3: c3, lv10: c10 });
    })()
  `));

  console.log('== 新攻击方式卡效果（真实 DOM 升级弹窗点击） ==');
  const cardR = await evalJs(`
    (function(){
      const p = ABYSS.state.player;
      ABYSS.state.pendingLevelUps = 1;
      ABYSS.showLevelUp();
      // 用卡池里的暴击节奏卡直接走 chooseLevelCard（与点击同一函数）
      const card = ABYSS.MODE_POOL.find(c => c.key === 'crit');
      ABYSS.chooseLevelCard(card);
      return JSON.stringify({ critEvery: p.critEvery, critMult: p.critMult, phase: ABYSS.state.phase });
    })()
  `);
  console.log(cardR);

  console.log('== 陷阱全链路（真实 DOM 事件弹窗 → 陷阱弹窗 → 承受） ==');
  const trapR = await evalJs(`
    (function(){
      const st = ABYSS.state;
      ABYSS.CFG.events.trapChance = 1;
      st.sites.push({ x: st.player.x, y: st.player.y, evt: ABYSS.EVENTS[0], used: false });
      return 'armed';
    })()
  `);
  await sleep(600);
  // 点击事件选项（真实 DOM）
  await evalJs(`(function(){ const b = document.querySelector('#eventOpts .event-opt'); if (b) { b.click(); return 'clicked'; } return 'no-btn'; })()`);
  await sleep(400);
  const trapShown = await evalJs(`JSON.stringify({ phase: ABYSS.state.phase, trapIcon: document.querySelector('#eventIcon').textContent })`);
  console.log('陷阱弹窗:', trapShown);
  await evalJs(`(function(){ const b = document.querySelector('#eventOpts .event-opt'); if (b) { b.click(); return 'ok'; } return 'no'; })()`);
  await sleep(400);
  console.log(await evalJs(`JSON.stringify({
    phase: ABYSS.state.phase, trapFoeHpMul: ABYSS.state.trapFoeHpMul,
    trapUntilActive: ABYSS.state.trapUntil > ABYSS.state.time,
    trapE: (function(){ const e = ABYSS.makeEnemy(1, 0); ABYSS.state.trapUntil = 0; const n = ABYSS.makeEnemy(1, 0); return { trapHp: e.hp, normHp: n.hp }; })()
  })`));

  console.log('== 吸血箭/减速箭命中链路（真实战斗） ==');
  console.log(await evalJs(`
    (function(){
      const p = ABYSS.state.player;
      p.cardLeech = 20; p.cardSlow = 1;
      p.hp = Math.max(1, Math.round(p.maxHp * 0.5));
      const f = ABYSS.makeEnemy(1, 0);
      ABYSS.state.foes.push(f);
      f.x = p.x + 120; f.y = p.y;
      const h0 = p.hp, fh0 = f.hp;
      ABYSS.state.bullets.push({ x: p.x, y: p.y, vx: 250, vy: 0, r: 5, dmg: 10, crit: false, side: 'p', life: 2, owner: p, pierceLeft: 0, hit: [] });
      return new Promise(res => setTimeout(() => {
        res(JSON.stringify({ healed: p.hp > h0, slowed: f.slowT > 0 && f.slowMul < 1, foeHurt: f.hp < fh0, phase: ABYSS.state.phase }));
      }, 600));
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
