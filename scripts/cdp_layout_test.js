/* CDP 冒烟：验证侧边栏移出画布后的布局 + 无运行时异常 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const __dirname2 = __dirname;
const PORT = 9227;
const chrome = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"';
const URL_ = 'file://' + path.normalize(__dirname2 + '/../index.html');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function evalJs(ws, expr) {
  const id = 1 + Math.floor(Math.random() * 1e6);
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener('message', onMsg);
        if (m.result && m.result.exceptionDetails) console.error('EVAL-ERR:', JSON.stringify(m.result.exceptionDetails).slice(0, 300));
        resolve(m.result && m.result.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    setTimeout(() => reject(new Error('eval timeout')), 5000);
  });
}

async function main() {
  const proc = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + __dirname2 + '/.chrome-tmp10',
    '--window-size=1440,900', 'about:blank'
  ], { shell: true, stdio: 'ignore' });

  await sleep(1800);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  await new Promise((resolve, reject) => {
    const id = 99;
    ws.addEventListener('message', function h(ev) {
      const m = JSON.parse(ev.data);
      if (m.id === id) { ws.removeEventListener('message', h); resolve(m); }
    });
    ws.send(JSON.stringify({ id, method: 'Page.navigate', params: { url: URL_ } }));
  });
  await sleep(1500);

  const errors = (await evalJs(ws, `window.__errs || []`)).value;
  console.log('runtime errors:', JSON.stringify(errors));

  const layout = (await evalJs(ws, `(() => {
    const s = document.getElementById('stage').getBoundingClientRect();
    const e = document.getElementById('eqSide').getBoundingClientRect();
    return { stageRight: Math.round(s.right), eqLeft: Math.round(e.left), eqTop: Math.round(e.top),
      eqWidth: Math.round(e.width), eqVisible: e.width > 0, overlap: e.left < s.right && e.right > s.left };
  })()`)).value;
  console.log('layout:', JSON.stringify(layout));

  // 开始游戏并跑 5 秒
  await evalJs(ws, `document.getElementById('restartBtn').click()`);
  await sleep(500);
  await evalJs(ws, `ABYSS.startRun && ABYSS.startRun()`);
  await sleep(5000);

  const inGame = (await evalJs(ws, `(() => {
    const s = ABYSS.state;
    return { phase: s.phase, foes: s.foes.filter(f=>!f.dead).length,
      eqHtml: document.getElementById('eqSide').innerHTML.length };
  })()`)).value;
  console.log('game:', JSON.stringify(inGame));

  // 截图
  const shot = await new Promise((resolve) => {
    const id = 42;
    ws.addEventListener('message', function h(ev) {
      const m = JSON.parse(ev.data);
      if (m.id === id) { ws.removeEventListener('message', h); resolve(m.result); }
    });
    ws.send(JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png' } }));
  });
  fs.writeFileSync(__dirname2 + '/../.shot_layout.png', Buffer.from(shot.data, 'base64'));

  ws.close();
  proc.kill();
  console.log('done');
}
main().catch(e => { console.error(e); process.exit(1); });
