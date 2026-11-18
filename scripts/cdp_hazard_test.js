/* CDP 真实浏览器冒烟测试：地图陷阱渲染 + 掩体数量 + 无运行时异常 */
const { spawn } = require('child_process');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
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
    `--remote-debugging-port=${PORT}`, '--user-data-dir=' + __dirname + '/.chrome-tmp6',
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
  await sleep(1800);

  console.log('== 开局 ==');
  console.log(await evalJs(`JSON.stringify({
    obstacles: ABYSS.state.obstacles.length, cap: ABYSS.CFG.obstacles.cap,
    zones: ABYSS.state.zones.length, kind: ABYSS.hazardKind(), phase: ABYSS.state.phase
  })`));

  console.log('== 依次切换到 4 张陷阱地图，各跑 4 秒 ==');
  for (const idx of [1, 2, 3, 4]) {
    const info = await evalJs(`
      (function(){
        ABYSS.switchMap(${idx});
        return JSON.stringify({ map: ABYSS.MAPS[${idx}].name, kind: ABYSS.hazardKind(), zones: ABYSS.state.zones.length });
      })()
    `);
    await sleep(4000);
    const after = await evalJs(`JSON.stringify({
      hazards: ABYSS.state.hazards.length,
      hazT: Number(ABYSS.state.hazT.toFixed(2)),
      foes: ABYSS.state.foes.filter(f => !f.dead).length
    })`);
    console.log(info, '→ 4s 后:', after);
  }

  console.log('== 运行时异常 ==');
  const realErr = exceptions.filter(e => !/favicon/.test(e));
  console.log(realErr.length ? realErr.join('\n---\n') : '无异常 ✓');

  ws.close();
  chrome.kill();
  process.exit(realErr.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); try { chrome.kill(); } catch (_) {} process.exit(1); });
