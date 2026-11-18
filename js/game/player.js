/* ============================================================
   游戏层 · player.js
   玩家实体：WASD/方向键移动、竞技场与柱子碰撞、自动射击
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp, pushOutOfRect } = G;

  function updatePlayer(dt) {
    const p = state.player;
    if (!p || p.dead) return;
    const A = CFG.arena;

    /* ---------- 移动 ---------- */
    const mv = G.engine.moveVec();
    if (mv.dx || mv.dy) {
      const n = G.norm(mv.dx, mv.dy);
      const spd = p.speed * (1 + clamp(p.agg.swiftstep, 0, 40) / 100);
      p.x += n.x * spd * dt;
      p.y += n.y * spd * dt;
    }

    // 竞技场边界
    p.x = clamp(p.x, p.r, A.w - p.r);
    p.y = clamp(p.y, p.r, A.h - p.r);

    // 柱子碰撞
    for (const o of state.obstacles) pushOutOfRect(p, o);

    /* ---------- 无敌帧 ---------- */
    if (p.iframes > 0) p.iframes -= dt;

    /* ---------- 自动射击 ---------- */
    p.atkT -= dt;
    if (p.atkT <= 0) {
      const t = nearestFoe(p);
      if (t) {
        G.firePlayerBullet(p, t.x, t.y);
        p.atkT = CFG.player.atkCd;
      } else {
        p.atkT = 0.08;   // 无目标时稍后重试
      }
    }
  }

  function nearestFoe(p) {
    let best = null, bd = CFG.player.range;
    for (const f of state.foes) {
      if (f.dead) continue;
      const d = G.dist(p.x, p.y, f.x, f.y);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  Object.assign(G, { updatePlayer, nearestFoe });
})(window.ABYSS = window.ABYSS || {});
