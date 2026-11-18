/* ============================================================
   游戏层 · bullets.js
   弹幕：玩家箭矢（命中触发流血/吸血/反伤结算）与敌人弹幕
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp, circleRect, dealDamage, applyBleed } = G;

  /* =========================================================
     发射
     ========================================================= */

  /** 玩家箭矢：出手时结算固定节拍暴击，命中时附加流血 */
  function firePlayerBullet(p, tx, ty) {
    p.strikes++;
    let dmg = p.atk;
    let crit = false;
    if (p.agg.crit > 0 && p.strikes % p.agg.crit === 0) {
      dmg *= p.agg.critMult;
      crit = true;
    }
    const v = G.norm(tx - p.x, ty - p.y);
    state.bullets.push({
      x: p.x + v.x * (p.r + 4), y: p.y + v.y * (p.r + 4),
      vx: v.x * CFG.player.bulletSpeed, vy: v.y * CFG.player.bulletSpeed,
      r: 5, dmg, crit, side: 'p', life: 2, owner: p
    });
    G.sfxTick();
  }

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
    const A = CFG.arena;

    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      let dead = b.life <= 0
        || b.x < 0 || b.x > A.w || b.y < 0 || b.y > A.h
        || hitObstacle(b);

      if (!dead && b.side === 'p') {
        // 命中敌人
        for (const f of state.foes) {
          if (f.dead) continue;
          if (G.dist(b.x, b.y, f.x, f.y) < b.r + f.r) {
            const dealt = dealDamage(p, f, b.dmg, { crit: b.crit });
            // 血刃：命中附加流血（多件只取最强，聚合时已处理）
            if (dealt > 0 && p.agg.bleed) applyBleed(f, p.agg.bleed);
            dead = true;
            break;
          }
        }
      } else if (!dead && b.side === 'e') {
        // 命中玩家
        if (p && !p.dead && G.dist(b.x, b.y, p.x, p.y) < b.r + p.r) {
          dealDamage(b.owner, p, b.dmg);
          dead = true;
        }
      }

      if (dead) state.bullets.splice(i, 1);
    }
  }

  Object.assign(G, { firePlayerBullet, fireEnemyBullet, updateBullets });
})(window.ABYSS = window.ABYSS || {});
