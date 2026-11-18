/* ============================================================
   基础层 · utils.js
   DOM 选择器、延时、随机、数值格式化、向量/几何工具
   ============================================================ */
(function (G) {
  'use strict';

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function fmt(n) {
    const v = Math.round(n);
    if (!isFinite(v)) return '∞';
    return String(v);
  }

  /* ---------- 向量 / 几何 ---------- */
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

  function norm(dx, dy) {
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  }

  /** 点到矩形的最近距离是否小于 r（圆与矩形碰撞） */
  function circleRect(cx, cy, r, rect) {
    const nx = clamp(cx, rect.x, rect.x + rect.w);
    const ny = clamp(cy, rect.y, rect.y + rect.h);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  /** 把圆推出矩形（返回修正后的 {x, y}），用于实体与障碍物的碰撞 */
  function pushOutOfRect(u, rect) {
    const nx = clamp(u.x, rect.x, rect.x + rect.w);
    const ny = clamp(u.y, rect.y, rect.y + rect.h);
    let dx = u.x - nx, dy = u.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 >= u.r * u.r) return;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      u.x = nx + (dx / d) * u.r;
      u.y = ny + (dy / d) * u.r;
    } else {
      // 圆心在矩形内：沿最浅方向推出
      const l = u.x - rect.x, rr = rect.x + rect.w - u.x;
      const t = u.y - rect.y, b = rect.y + rect.h - u.y;
      const m = Math.min(l, rr, t, b);
      if (m === l) u.x = rect.x - u.r;
      else if (m === rr) u.x = rect.x + rect.w + u.r;
      else if (m === t) u.y = rect.y - u.r;
      else u.y = rect.y + rect.h + u.r;
    }
  }

  Object.assign(G, { $, sleep, pick, clamp, fmt, dist, norm, circleRect, pushOutOfRect });
})(window.ABYSS = window.ABYSS || {});
