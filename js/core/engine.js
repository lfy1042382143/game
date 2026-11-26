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
    // 用 pointermove（带 pointerType）替代 mousemove：
    // 手机浏览器会在点按后补发"合成 mousemove"，曾把 mouse.active 置真、
    // 导致自动索敌失效（箭矢改射最后点击位置）。触屏/触控笔一律不接管瞄准。
    window.addEventListener('pointermove', onPointerMove);
  }

  /** 归一化移动向量（WASD / 方向键 / 触屏摇杆合并，未做幅度钳制） */
  function moveVec() {
    let dx = 0, dy = 0;
    if (keys.has('w') || keys.has('arrowup')) dy -= 1;
    if (keys.has('s') || keys.has('arrowdown')) dy += 1;
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if (keys.has('d') || keys.has('arrowright')) dx += 1;
    if (touchVec.active) { dx += touchVec.dx; dy += touchVec.dy; }
    return { dx, dy };
  }

  /* =========================================================
     鼠标输入：记录画布逻辑坐标（供玩家瞄准）
     ========================================================= */
  const mouse = { cx: 0, cy: 0, active: false };   // canvas 逻辑坐标（960×600）

  /* 触控输入：由 js/core/touch.js 写入（左半屏虚拟摇杆）
     dx/dy 已含死区与归一化，幅度 ≤1；键盘优先合并，由玩家侧钳制幅度 */
  const touchVec = { active: false, dx: 0, dy: 0 };

  /** 把客户端坐标换算成画布逻辑坐标（供玩家瞄准） */
  function setMouseFromClient(clientX, clientY) {
    try {
      const c = (typeof document !== 'undefined') && document.getElementById('canvas');
      if (!c || !c.getBoundingClientRect) return;
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      mouse.cx = (clientX - r.left) * (c.width / r.width);
      mouse.cy = (clientY - r.top) * (c.height / r.height);
      mouse.active = true;
    } catch (err) { /* 无头环境无 DOM，忽略 */ }
  }

  /** 仅真实鼠标接管瞄准；触屏/触控笔（pointerType 非 mouse）交给自动索敌 */
  function onPointerMove(e) {
    if (e && e.pointerType && e.pointerType !== 'mouse') return;
    setMouseFromClient(e.clientX, e.clientY);
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

  Object.assign(G, { engine: { STEP, keys, moveVec, mouse, touch: touchVec, pointerMove: onPointerMove, start } });
})(window.ABYSS = window.ABYSS || {});
