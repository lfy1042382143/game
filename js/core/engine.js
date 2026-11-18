/* ============================================================
   核心层 · engine.js
   固定时间步长游戏循环 + 键盘输入
   逻辑（update）与渲染（render）分离：
   - update 仅在 phase === 'play' 且未暂停时以固定 1/60s 步进
     （弹窗阶段游戏自动暂停）
   - render 每帧执行
   不直接引用 DOM/canvas，可在无头环境测试
   ============================================================ */
(function (G) {
  'use strict';

  const STEP = 1 / 60;

  /* =========================================================
     键盘输入
     ========================================================= */
  const keys = new Set();

  const MOVE_KEYS = new Set([
    'w', 'a', 's', 'd',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright'
  ]);

  function onKeyDown(e) {
    const k = e.key.toLowerCase();
    if (MOVE_KEYS.has(k)) e.preventDefault();
    if (!e.repeat) keys.add(k);
    else keys.add(k);
    if (G.onKeyDown && !e.repeat) G.onKeyDown(k);
  }
  function onKeyUp(e) {
    keys.delete(e.key.toLowerCase());
  }
  function onBlur() { keys.clear(); }

  function initInput() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }

  /** 归一化移动向量（WASD / 方向键） */
  function moveVec() {
    let dx = 0, dy = 0;
    if (keys.has('w') || keys.has('arrowup')) dy -= 1;
    if (keys.has('s') || keys.has('arrowdown')) dy += 1;
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if (keys.has('d') || keys.has('arrowright')) dx += 1;
    return { dx, dy };
  }

  /* =========================================================
     主循环
     ========================================================= */
  let rafId = 0;
  let last = 0;
  let acc = 0;
  let updateFn = null;
  let renderFn = null;

  function frame(t) {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    acc += dt;

    let steps = 0;
    while (acc >= STEP && steps < 5) {
      acc -= STEP;
      steps++;
      const st = G.state;
      if (st && st.phase === 'play' && !st.paused && updateFn) updateFn(STEP);
    }

    if (renderFn) renderFn(dt);
    rafId = requestAnimationFrame(frame);
  }

  function start(update, render) {
    updateFn = update;
    renderFn = render;
    initInput();
    last = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  Object.assign(G, { engine: { STEP, keys, moveVec, start } });
})(window.ABYSS = window.ABYSS || {});
