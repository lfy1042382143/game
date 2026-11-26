/* ============================================================
   游戏层 · bullets.js
   弹幕：玩家箭矢（散射/贯穿，命中触发流血/吸血/反伤）与敌人弹幕
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp, circlePoly, dealDamage } = G;

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
      if (circlePoly(b.x, b.y, b.r, o)) return true;
    }
    return false;
  }

  /** 反弹箭：弹幕从障碍物上弹开（沿最近面法线反射，并把弹幕推出碰撞） */
  function reflectOffObstacle(b) {
    for (const o of state.obstacles) {
      if (!circlePoly(b.x, b.y, b.r, o)) continue;
      if (o.pts) {
        // 不规则多边形：取最近边的法线反射
        const near = G.nearestOnPoly(b.x, b.y, o.pts);
        let nx = b.x - near.x, ny = b.y - near.y;
        let d = Math.hypot(nx, ny);
        if (d < 0.0001) { nx = b.x - o.x; ny = b.y - o.y; d = Math.hypot(nx, ny) || 1; }
        nx /= d; ny /= d;
        b.x = near.x + nx * (b.r + 2);
        b.y = near.y + ny * (b.r + 2);
        const dot = b.vx * nx + b.vy * ny;
        b.vx -= 2 * dot * nx;
        b.vy -= 2 * dot * ny;
      } else {
        // 兼容旧矩形
        const cx = clamp(b.x, o.x, o.x + o.w);
        const cy = clamp(b.y, o.y, o.y + o.h);
        const dx = b.x - cx, dy = b.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          b.x = cx + (dx / d) * (b.r + 2);
          b.y = cy + (dy / d) * (b.r + 2);
          if (Math.abs(dx) > Math.abs(dy)) b.vx = -b.vx;
          else b.vy = -b.vy;
        } else {
          b.x -= b.vx * 0.03; b.y -= b.vy * 0.03;
          if (Math.abs(b.vx) > Math.abs(b.vy)) b.vx = -b.vx;
          else b.vy = -b.vy;
        }
      }
      return true;
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

      let dead = b.life <= 0;

      // 障碍物碰撞：玩家弹幕有反弹次数则弹开，否则消散；敌人弹幕直接消散
      if (!dead && hitObstacle(b)) {
        const maxBounce = (b.side === 'p' && p && p.bounce) || 0;
        if ((b.bounces || 0) < maxBounce && reflectOffObstacle(b)) {
          b.bounces = (b.bounces || 0) + 1;
        } else {
          dead = true;
        }
      }

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
            // 贯穿衰减：每次穿透后伤害 ×0.7（首目标全额，后续逐层递减）；终极·贯穿诸天不衰减
            const falloff = b.ultPierceNoDecay ? 1 : Math.pow(0.7, b.pierceHits || 0);
            // 输出统计归集：浮游炮子弹 / 玩家箭矢
            const tag = b.skill === 'drone' ? 'drone' : 'arrow';
            dealDamage(p, f, Math.max(1, Math.round(b.dmg * falloff)), { crit: b.crit, tag });
            // 减速箭（技能卡）
            if (p.cardSlow > 0) {
              f.slowT = 1.6;
              const cardMul = 1 - p.cardSlow * 0.18;
              f.slowMul = Math.min(f.slowMul === undefined ? 1 : f.slowMul, cardMul);
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
        // 浮游炮拦截：停留在玩家周围的浮游炮可抵消敌方弹幕
        if (p && !p.dead && p.skills && p.skills.drone && p.sk && p.sk.drone.active > 0) {
          const d = p.sk.drone;
          for (let di = 0; di < d.count; di++) {
            const dp = G.dronePos(p, di, d.count);
            if (G.dist(b.x, b.y, dp.x, dp.y) < 15 + b.r) { dead = true; break; }
          }
        }
        // 护送使者被弹幕命中
        const tk = state.task;
        if (!dead && tk && tk.kind === 'escort' && tk.npc && !tk.npc.dead &&
            G.dist(b.x, b.y, tk.npc.x, tk.npc.y) < b.r + tk.npc.r) {
          dealDamage(b.owner, tk.npc, b.dmg);
          dead = true;
        }
        // 同伴被流弹命中
        const cp = state.companion;
        if (!dead && cp && !cp.dead && G.dist(b.x, b.y, cp.x, cp.y) < b.r + cp.r) {
          dealDamage(b.owner, cp, b.dmg);
          dead = true;
        }
        if (!dead && p && !p.dead && G.dist(b.x, b.y, p.x, p.y) < b.r + p.r) {
          dealDamage(b.owner, p, b.dmg);
          dead = true;
        }
      }

      if (dead) state.bullets.splice(i, 1);
    }
  }

  Object.assign(G, { fireEnemyBullet, updateBullets });
})(window.ABYSS = window.ABYSS || {});
