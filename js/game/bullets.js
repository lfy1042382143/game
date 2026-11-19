/* ============================================================
   游戏层 · bullets.js
   弹幕：玩家箭矢（散射/贯穿，命中触发流血/吸血/反伤）与敌人弹幕
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

  function updateBullets(dt) {
    const p = state.player;
    const W = CFG.world;

    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      let dead = b.life <= 0 || hitObstacle(b);

      // 反弹箭：玩家弹幕碰到地图墙壁后反弹（次数 = 反弹层数），超出次数则消散
      if (!dead && b.side === 'p' && (b.x < 0 || b.x > W.w || b.y < 0 || b.y > W.h)) {
        const maxBounce = (p && p.bounce) || 0;
        if ((b.bounces || 0) < maxBounce) {
          b.bounces = (b.bounces || 0) + 1;
          if (b.x < 0 || b.x > W.w) { b.vx = -b.vx; b.x = clamp(b.x, 2, W.w - 2); }
          if (b.y < 0 || b.y > W.h) { b.vy = -b.vy; b.y = clamp(b.y, 2, W.h - 2); }
        } else {
          dead = true;
        }
      } else if (b.x < 0 || b.x > W.w || b.y < 0 || b.y > W.h) {
        dead = true;
      }

      if (!dead && b.side === 'p') {
        for (const f of state.foes) {
          if (f.dead || b.hit.indexOf(f) >= 0) continue;
          if (G.dist(b.x, b.y, f.x, f.y) < b.r + f.r) {
            // 贯穿衰减：每次穿透后伤害 ×0.7（首目标全额，后续逐层递减）
            const falloff = Math.pow(0.7, b.pierceHits || 0);
            const dealt = dealDamage(p, f, Math.max(1, Math.round(b.dmg * falloff)), { crit: b.crit });
            // 血刃：命中附加流血（多件只取最强，聚合时已处理）
            if (dealt > 0 && p.agg.bleed) applyBleed(f, p.agg.bleed);
            // 吸血箭：命中按伤害比例回血
            if (dealt > 0 && p.cardLeech > 0) G.healUnit(p, Math.max(1, Math.round(dealt * p.cardLeech / 100)));
            // 减速箭：命中减速
            if (dealt > 0 && p.cardSlow > 0) {
              f.slowT = 1.6;
              f.slowMul = 1 - p.cardSlow * 0.18;
            }

            if (b.pierceLeft > 0) {
              // 贯穿：穿过这个敌人继续飞
              b.pierceLeft--;
              b.pierceHits = (b.pierceHits || 0) + 1;
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
