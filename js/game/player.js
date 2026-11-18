/* ============================================================
   游戏层 · player.js
   玩家实体：WASD 移动、障碍碰撞、自动射击（散射/贯穿/追踪）、环绕飞刃
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp, pushOutOfRect } = G;

  function effAtkCd(p) {
    return Math.max(0.18, CFG.player.atkCd * p.atkCdMul);
  }

  function updatePlayer(dt) {
    const p = state.player;
    if (!p || p.dead) return;
    const W = CFG.world;

    /* ---------- 移动 ---------- */
    const mv = G.engine.moveVec();
    if (mv.dx || mv.dy) {
      const n = G.norm(mv.dx, mv.dy);
      const spd = p.speed * (1 + clamp(p.agg.swiftstep, 0, 40) / 100);
      p.x += n.x * spd * dt;
      p.y += n.y * spd * dt;
    }

    // 世界边界
    p.x = clamp(p.x, p.r, W.w - p.r);
    p.y = clamp(p.y, p.r, W.h - p.r);

    // 障碍物碰撞
    for (const o of state.obstacles) pushOutOfRect(p, o);

    /* ---------- 无敌帧 ---------- */
    if (p.iframes > 0) p.iframes -= dt;

    /* ---------- 自动射击 ---------- */
    p.atkT -= dt;
    if (p.atkT <= 0) {
      const t = nearestFoe(p);
      if (t) {
        fireVolley(p, t);
        p.atkT = effAtkCd(p);
      } else {
        p.atkT = 0.08;
      }
    }

    /* ---------- 环绕飞刃 ---------- */
    updateOrbitBlades(p, dt);
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

  /** 一次射击：shots 支箭矢扇形散开，暴击节拍整轮共享
      瞄准带预判提前量（按目标当前速度外推），否则打不中侧向环绕的敌人 */
  function fireVolley(p, target) {
    p.strikes++;
    let crit = false;
    let mult = 1;
    if (p.agg.crit > 0 && p.strikes % p.agg.crit === 0) {
      crit = true;
      mult = p.agg.critMult;
    }

    // 预判：两次迭代求提前量（飞行时间 × 目标速度）
    let ax = target.x, ay = target.y;
    for (let k = 0; k < 2; k++) {
      const tof = G.dist(p.x, p.y, ax, ay) / CFG.player.bulletSpeed;
      ax = target.x + (target.vx || 0) * tof;
      ay = target.y + (target.vy || 0) * tof;
    }

    const baseA = Math.atan2(ay - p.y, ax - p.x);
    const n = p.shots;
    for (let i = 0; i < n; i++) {
      const a = baseA + (i - (n - 1) / 2) * 0.16;
      const v = { x: Math.cos(a), y: Math.sin(a) };
      state.bullets.push({
        x: p.x + v.x * (p.r + 4), y: p.y + v.y * (p.r + 4),
        vx: v.x * CFG.player.bulletSpeed, vy: v.y * CFG.player.bulletSpeed,
        r: 5, dmg: p.atk * mult, crit,
        side: 'p', life: 2.2, owner: p,
        pierceLeft: p.pierce,
        homing: p.homing,
        hit: []
      });
    }
    G.sfxTick();
  }

  /* =========================================================
     环绕飞刃：绕玩家旋转，接触敌人造成伤害（每个敌人独立冷却）
     ========================================================= */
  const ORBIT_R = 64;
  const ORBIT_SPD = 2.6;
  const ORBIT_DMG_MUL = 0.6;
  const ORBIT_CD = 0.5;

  function updateOrbitBlades(p, dt) {
    if (!p.orbits) return;
    const blades = orbitPositions(p);

    for (const f of state.foes) {
      if (f.dead) continue;
      if (f.orbitCd > 0) { f.orbitCd -= dt; continue; }
      for (const b of blades) {
        if (G.dist(b.x, b.y, f.x, f.y) < 10 + f.r) {
          G.dealDamage(p, f, p.atk * ORBIT_DMG_MUL);
          f.orbitCd = ORBIT_CD;
          break;
        }
      }
    }
  }

  function orbitPositions(p) {
    const out = [];
    for (let i = 0; i < p.orbits; i++) {
      const a = state.time * ORBIT_SPD + (i / p.orbits) * Math.PI * 2;
      out.push({ x: p.x + Math.cos(a) * ORBIT_R, y: p.y + Math.sin(a) * ORBIT_R });
    }
    return out;
  }

  Object.assign(G, { updatePlayer, nearestFoe, fireVolley, orbitPositions, effAtkCd });
})(window.ABYSS = window.ABYSS || {});
