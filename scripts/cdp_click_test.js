/* CDP 驱动真实 Chrome 复现「点击升级卡」流程，捕获未捕获异常 */
const { spawn } = require('child_process');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
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
    `--remote-debugging-port=${PORT}`, '--user-data-dir=' + __dirname + '/.chrome-tmp',
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
  const consoleErrs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      exceptions.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrs.push(m.params.args.map(a => a.value || a.description || '').join(' '));
    }
  };
  function send(method, params) {
    return new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  }
  async function evalJs(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('EVAL_ERR: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }

  await send('Runtime.enable', {});
  await send('Page.enable', {});
  await send('Page.navigate', { url: URL_ });
  await sleep(1500);

  console.log('== 初始状态 ==');
  console.log('phase =', await evalJs('ABYSS.state.phase'));

  // 触发升级（模拟击杀获得大量经验）
  await evalJs('ABYSS.gainXp(ABYSS.xpNeed(ABYSS.state.player.level) + 5)');
  await sleep(500);
  console.log('升级后 phase =', await evalJs('ABYSS.state.phase'),
    'pendingLevelUps =', await evalJs('ABYSS.state.pendingLevelUps'),
    'level =', await evalJs('ABYSS.state.player.level'));

  // 模拟点击第一张升级卡（真实 DOM click）
  console.log('== 点击升级卡 ==');
  await evalJs(`
    (function(){
      const cards = document.querySelectorAll('#cards .up-card');
      if (!cards.length) return 'NO_CARDS';
      cards[0].click();
      return 'CLICKED:' + cards[0].querySelector('.card-name').textContent;
    })()
  `);
  await sleep(800);
  console.log('点击后 phase =', await evalJs('ABYSS.state.phase'),
    'pending =', await evalJs('ABYSS.state.pendingLevelUps'),
    'overlayShow =', await evalJs('document.getElementById("upgradeOverlay").className'));

  // 再跑 2 秒游戏，看是否还在正常更新
  const t0 = await evalJs('ABYSS.state.time');
  await sleep(2000);
  const t1 = await evalJs('ABYSS.state.time');
  console.log('2 秒后 state.time 增量 =', (t1 - t0).toFixed(3), '(>0 说明游戏循环存活)');

  console.log('== 异常 ==');
  console.log('uncaught exceptions:', exceptions.length ? exceptions : '无');
  console.log('console.error:', consoleErrs.length ? consoleErrs : '无');

  ws.close();
  chrome.kill();
  process.exit(0);
})().catch(e => { console.error('SCRIPT_FAIL', e); process.exit(1); });
