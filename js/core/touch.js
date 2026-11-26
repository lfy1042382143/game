/* ============================================================
   核心层 · touch.js（移动端触控）
   左半屏动态虚拟摇杆：
   - pointerdown（非鼠标）在左 55% 屏出现摇杆，拖动输出归一化向量
   - 死区 + 幅度 ≤1（玩家侧再钳制），支持缓速走位
   - 弹窗/顶栏/按钮上的触点不接管；仅 play 阶段生效
   - 桌面（无触点设备）完全不启用，键盘体验零影响
   摇杆 DOM 动态创建，样式见 arena.css（.joy-base / .joy-knob）
   ============================================================ */
(function (G) {
  'use strict';

  const DEAD = 0.14;       // 死区（相对摇杆最大半径的比例）
  const BASE_R = 58;       // 摇杆基座半径（px）
  const ZONE = 0.55;       // 左侧屏幕比例 = 摇杆区

  const stick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
  let baseEl = null;
  let knobEl = null;

  /** 是否触屏设备（无头/桌面返回 false，不启用） */
  function isTouchDevice() {
    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
    if (typeof window !== 'undefined' && window.matchMedia &&
        window.matchMedia('(pointer: coarse)').matches) return true;
    return false;
  }

  function gamePhaseOk() {
    const st = G.state;
    return !!(st && st.phase === 'play');
  }

  /** 弹窗/顶栏/按钮上的触点不接管（closest 缺失时放行） */
  function blockedTarget(t) {
    return !!(t && t.closest && t.closest('.overlay, .topbar, .banner, .dmg-side, .eq-side, button'));
  }

  function ensureDom() {
    if (baseEl || typeof document === 'undefined' || !document.createElement) return;
    baseEl = document.createElement('div');
    baseEl.className = 'joy-base';
    knobEl = document.createElement('div');
    knobEl.className = 'joy-knob';
    baseEl.appendChild(knobEl);
    baseEl.style.display = 'none';
    document.body.appendChild(baseEl);
  }

  function showStick(x, y) {
    if (!baseEl) return;
    baseEl.style.display = 'block';
    baseEl.style.left = (x - BASE_R) + 'px';
    baseEl.style.top = (y - BASE_R) + 'px';
    if (knobEl) knobEl.style.transform = 'translate(0px, 0px)';
  }

  function moveKnob(x, y) {
    if (!knobEl) return;
    let kx = x - stick.ox, ky = y - stick.oy;
    const d = Math.hypot(kx, ky);
    if (d > BASE_R) { kx = kx / d * BASE_R; ky = ky / d * BASE_R; }
    knobEl.style.transform = 'translate(' + kx.toFixed(1) + 'px,' + ky.toFixed(1) + 'px)';
  }

  /** 纯函数：摇杆偏移 → 输入向量（死区 + 归一化，幅度 0~1） */
  function stickVector(rx, ry) {
    const d = Math.hypot(rx, ry);
    if (d < 1e-6) return { dx: 0, dy: 0 };
    const n = d / BASE_R;
    if (n < DEAD) return { dx: 0, dy: 0 };
    const k = Math.min(1, (n - DEAD) / (1 - DEAD));
    return { dx: rx / d * k, dy: ry / d * k };
  }

  function hideStick() {
    stick.active = false;
    stick.id = null;
    stick.dx = 0; stick.dy = 0;
    if (baseEl) baseEl.style.display = 'none';
    const t = G.engine && G.engine.touch;
    if (t) { t.active = false; t.dx = 0; t.dy = 0; }
  }

  function onDown(e) {
    if (e.pointerType === 'mouse') return;
    if (!gamePhaseOk() || blockedTarget(e.target)) return;
    if (typeof e.clientX !== 'number') return;
    if (typeof window !== 'undefined' && e.clientX > window.innerWidth * ZONE) return;
    ensureDom();
    stick.active = true;
    stick.id = e.pointerId;
    stick.ox = e.clientX;
    stick.oy = e.clientY;
    stick.dx = 0; stick.dy = 0;
    showStick(e.clientX, e.clientY);
    if (e.preventDefault) e.preventDefault();
  }

  function onMove(e) {
    if (!stick.active || e.pointerId !== stick.id) return;
    const v = stickVector(e.clientX - stick.ox, e.clientY - stick.oy);
    stick.dx = v.dx; stick.dy = v.dy;
    moveKnob(e.clientX, e.clientY);
    const t = G.engine && G.engine.touch;
    if (t) { t.active = true; t.dx = v.dx; t.dy = v.dy; }
    if (e.preventDefault) e.preventDefault();
  }

  function onUp(e) {
    if (stick.active && e.pointerId === stick.id) hideStick();
  }

  /** 初始化：仅触屏设备绑定；返回是否启用（供性能降级判断） */
  function init() {
    if (!isTouchDevice()) return false;
    ensureDom();
    if (typeof window === 'undefined' || !window.addEventListener) return false;
    window.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onUp, { passive: false });
    return true;
  }

  Object.assign(G, {
    touch: {
      init, isTouchDevice, stickVector,
      /** 测试/调试：直接读摇杆状态 */
      state: stick,
      /** 测试/调试：强制收起摇杆 */
      release: hideStick
    }
  });
})(window.ABYSS = window.ABYSS || {});
