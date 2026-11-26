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

  /* ---------- 不规则多边形障碍（岩脉）---------- */
  /** 点到线段最近点 */
  function nearestOnSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return { x: ax + dx * t, y: ay + dy * t };
  }

  /** 点是否在多边形内（射线法） */
  function pointInPoly(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > py) !== (b.y > py) && px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  /** 点到多边形边界最近点 + 距离平方（异常输入兜底返回不可达，避免崩溃/NaN 传染） */
  function nearestOnPoly(px, py, pts) {
    if (!pts || !pts.length || !isFinite(px) || !isFinite(py)) {
      return { x: px, y: py, d2: Infinity };
    }
    let best = null, bestD2 = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const q = nearestOnSeg(px, py, a.x, a.y, b.x, b.y);
      const d2 = (px - q.x) * (px - q.x) + (py - q.y) * (py - q.y);
      if (isFinite(d2) && d2 < bestD2) { bestD2 = d2; best = q; }
    }
    if (!best) return { x: px, y: py, d2: Infinity };
    return { x: best.x, y: best.y, d2: bestD2 };
  }

  /** 圆与多边形障碍是否相交（兼容旧矩形 rect） */
  function circlePoly(cx, cy, r, o) {
    if (o.pts) {
      if (pointInPoly(cx, cy, o.pts)) return true;
      return nearestOnPoly(cx, cy, o.pts).d2 < r * r;
    }
    return circleRect(cx, cy, r, o);
  }

  /** 两条线段是否相交（标准跨立试验） */
  function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }

  /** 线段是否穿过某障碍物（多边形或旧矩形） */
  function segHitsObstacle(x1, y1, x2, y2, o) {
    let pts = o.pts;
    if (!pts) {
      // 旧矩形 → 四条边
      pts = [
        { x: o.x, y: o.y }, { x: o.x + o.w, y: o.y },
        { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h }
      ];
    }
    if (!pts || pts.length < 3) return false;
    if (pointInPoly(x1, y1, pts) || pointInPoly(x2, y2, pts)) return true;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if (segCross(x1, y1, x2, y2, pts[j].x, pts[j].y, pts[i].x, pts[i].y)) return true;
    }
    return false;
  }

  /** 两点之间是否被障碍物挡住（闪电/震荡波等「不能穿墙」判定用） */
  function losBlocked(x1, y1, x2, y2) {
    const obs = G.state && G.state.obstacles;
    if (!obs || !obs.length) return false;
    for (const o of obs) {
      if (segHitsObstacle(x1, y1, x2, y2, o)) return true;
    }
    return false;
  }

  /** 把圆推出多边形障碍（兼容旧矩形） */
  function pushOutOfPoly(u, o) {
    if (!o.pts) { pushOutOfRect(u, o); return; }
    const near = nearestOnPoly(u.x, u.y, o.pts);
    const inside = pointInPoly(u.x, u.y, o.pts);
    if (!inside && near.d2 >= u.r * u.r) return;
    let nx = u.x - near.x, ny = u.y - near.y;
    let d = Math.sqrt(near.d2);
    if (inside || d < 0.0001) {
      // 圆心在多边形内：朝远离形心的方向推出到最近边外
      nx = near.x - o.x; ny = near.y - o.y;
      d = Math.hypot(nx, ny) || 1;
      u.x = near.x + (nx / d) * u.r;
      u.y = near.y + (ny / d) * u.r;
    } else {
      u.x = near.x + (nx / d) * u.r;
      u.y = near.y + (ny / d) * u.r;
    }
  }

  /** 多边形包围盒（用于生成避让 / 小地图） */
  function polyBounds(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  Object.assign(G, { $, sleep, pick, clamp, fmt, dist, norm, circleRect, pushOutOfRect,
    nearestOnSeg, pointInPoly, nearestOnPoly, circlePoly, pushOutOfPoly, polyBounds,
    segCross, segHitsObstacle, losBlocked });
})(window.ABYSS = window.ABYSS || {});
