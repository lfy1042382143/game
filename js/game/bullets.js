/* ============================================================
   游戏层 · bullets.js
   弹幕：玩家箭矢（散射/贯穿/追踪，命中触发流血/吸血/反伤）与敌人弹幕
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp, circleRect, dealDamage, applyBleed } = G;

  /* =========================================================
     发射
     ========================================================= */

  /** 敌人弹幕 */
  function fireEnemyBullet(e, tx, ty, speed) {
    const v = G.norm(tx - e.x, ty - e.y);
    state.bullets.push({
      x: e.x + v.x * (e.r + 4), y: e.y + v.y * (e.r + 4),
      vx: v.x * speed, vy: v.y * speed,
      r: 6, dmg: e.atk, side: 'e', life: 4, owner: e
    });
  }

  /* =========================================================
     更新
     ========================================================= */
  function hitObstacle(b) {
    for (const o of state.obstacles) {
      if (circleRect(b.x, b.y, b.r, o)) return true;
    }
    return false;
  }

  /** 追踪箭：朝最近的存活敌人快速转向（转向足够快才有战术价值） */
  function steerHoming(b, dt) {
    if (!b.homing || b.side !== 'p') return;
    let best = null, bd = 520;
    for (const f of state.foes) {
      if (f.dead) continue;
      const d = G.dist(b.x, b.y, f.x, f.y);
      if (d < bd) { bd = d; best = f; }
    }
    if (!best) return;
    const cur = Math.atan2(b.vy, b.vx);
    const want = Math.atan2(best.y - b.y, best.x - b.x);
    let diff = want - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const rate = 4.8 * b.homing * dt;
    const turn = clamp(diff, -rate, rate);
    const spd = Math.hypot(b.vx, b.vy);
    const na = cur + turn;
    b.vx = Math.cos(na) * spd;
    b.vy = Math.sin(na) * spd;
  }

  function updateBullets(dt) {
    const p = state.player;
    const W = CFG.world;

    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];

      steerHoming(b, dt);

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      let dead = b.life <= 0
        || b.x < 0 || b.x > W.w || b.y < 0 || b.y > W.h
        || hitObstacle(b);

      if (!dead && b.side === 'p') {
        for (const f of state.foes) {
          if (f.dead || b.hit.indexOf(f) >= 0) continue;
          if (G.dist(b.x, b.y, f.x, f.y) < b.r + f.r) {
            const dealt = dealDamage(p, f, b.dmg, { crit: b.crit });
            // 血刃：命中附加流血（多件只取最强，聚合时已处理）
            if (dealt > 0 && p.agg.bleed) applyBleed(f, p.agg.bleed);

            if (b.pierceLeft > 0) {
              // 贯穿：穿过这个敌人继续飞
              b.pierceLeft--;
              b.hit.push(f);
            } else {
              dead = true;
            }
            break;
          }
        }
      } else if (!dead && b.side === 'e') {
        if (p && !p.dead && G.dist(b.x, b.y, p.x, p.y) < b.r + p.r) {
          dealDamage(b.owner, p, b.dmg);
          dead = true;
        }
      }

      if (dead) state.bullets.splice(i, 1);
    }
  }

  Object.assign(G, { fireEnemyBullet, updateBullets });
})(window.ABYSS = window.ABYSS || {});
