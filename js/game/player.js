/* ============================================================
   游戏层 · player.js
   玩家实体：WASD 移动、障碍碰撞、自动射击（散射/贯穿）、环绕飞刃
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp, pushOutOfPoly } = G;

  function effAtkCd(p) {
    return Math.max(0.18, CFG.player.atkCd * p.atkCdMul);
  }

  function updatePlayer(dt) {
    const p = state.player;
    if (!p || p.dead) return;
    const W = CFG.world;

    /* ---------- 移动（键盘全速；触屏摇杆支持模拟量缓速走位） ---------- */
    const mv = G.engine.moveVec();
    const mag = Math.hypot(mv.dx, mv.dy);
    if (mag > 0.01) {
      const n = G.norm(mv.dx, mv.dy);
      // 减速泥潭（沼泽地图陷阱）：在泥潭中移动变慢
      const zslow = G.zoneSlowMul ? G.zoneSlowMul(p.x, p.y) : 1;
      // 幅度钳制到 1：键盘对角=全速（与旧版一致），摇杆小幅度=按比例缓速
      // 移速只来自构筑被动
      const moveBuff = 1 + (p.pasMoveSpeed || 0);
      const spd = p.speed * Math.min(1, mag) * moveBuff * zslow;
      p.x += n.x * spd * dt;
      p.y += n.y * spd * dt;
    }

    // 世界边界
    p.x = clamp(p.x, p.r, W.w - p.r);
    p.y = clamp(p.y, p.r, W.h - p.r);

    // 障碍物碰撞
    for (const o of state.obstacles) pushOutOfPoly(p, o);

    // 伪装陷阱障碍：靠近时尖刺弹出（伤害固定值、现形后失效）
    for (const o of state.obstacles) {
      const t = o.trap;
      if (!t || !t.armed) continue;
      if (G.circlePoly(p.x, p.y, p.r + 6, o)) {
        t.armed = false;
        t.trigT = CFG.obstacles.trigT;
        const dmg = Math.round(CFG.obstacles.trapDmg0 + (state.wave - 1) * CFG.obstacles.trapDmgK);
        G.dealDamage(null, p, dmg, { flat: true, noThorn: true });
        G.floatText(p, '陷阱!', '#f87171', true);
      }
    }

    /* ---------- 无敌帧 ---------- */
    if (p.iframes > 0) p.iframes -= dt;

    /* ---------- 护盾生成（护盾生成卡）：每 shieldEvery 秒获得护盾 ---------- */
    if (p.shieldEvery > 0) {
      p.shieldT += dt;
      if (p.shieldT >= p.shieldEvery) {
        p.shieldT -= p.shieldEvery;
        if (p.shield < p.SHIELD_CAP) {
          p.shield = Math.min(p.SHIELD_CAP, p.shield + p.shieldVal);
          G.floatText(p, '盾+' + p.shieldVal, '#7dd3fc');
        }
      }
    }

    /* ---------- 持续射击（仅箭矢线解锁后） ---------- */
    if (p.skills && p.skills.arrow) {
      p.atkT -= dt;
      if (p.atkT <= 0) {
        // 无论是否有敌人都在攻击间隔到点时持续开火（朝鼠标方向；无鼠标时兜底最近敌人）
        fireVolley(p);
        p.atkT = effAtkCd(p);
      }
    }

    /* ---------- 环绕飞刃 ---------- */
    updateOrbitBlades(p, dt);
  }

  function nearestFoe(p) {
    let best = null, bd = p.range;
    for (const f of state.foes) {
      if (f.dead) continue;
      const d = G.dist(p.x, p.y, f.x, f.y);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  /** 瞄准点：鼠标方向优先（画布逻辑坐标 + 相机偏移 = 世界坐标）；
      无鼠标环境（触屏/无头测试）兜底最近敌人 */
  function aimPoint(p) {
    const m = G.engine.mouse;
    if (m && m.active) {
      const cam = G.camera || { x: 0, y: 0 };
      return { x: m.cx + cam.x, y: m.cy + cam.y };
    }
    const t = nearestFoe(p);
    return t ? { x: t.x, y: t.y } : { x: p.x + 1, y: p.y };
  }

  /** 一次射击：shots 支箭矢朝鼠标方向扇形散开，暴击节拍整轮共享 */
  function fireVolley(p) {
    p.strikes++;
    let crit = false;
    let mult = 1;
    // 卡片暴击节拍（暴击节奏）
    if (p.critEvery > 0 && p.strikes % p.critEvery === 0) {
      crit = true;
      mult = Math.max(mult, p.critMult);
    }

    const bSpd = CFG.player.bulletSpeed * p.bulletSpeedMul;
    const aim = aimPoint(p);
    const baseA = Math.atan2(aim.y - p.y, aim.x - p.x);

    const n = p.shots;
    // 箭矢飞满射程即消失；终极·贯穿诸天用专属乘数放大攻击范围，不影响全局 p.range
    const life = p.range * (p.arrowRangeMul || 1) / bSpd;
    for (let i = 0; i < n; i++) {
      const a = baseA + (i - (n - 1) / 2) * 0.16;
      const v = { x: Math.cos(a), y: Math.sin(a) };
      state.bullets.push({
        x: p.x + v.x * (p.r + 4), y: p.y + v.y * (p.r + 4),
        vx: v.x * bSpd, vy: v.y * bSpd,
        r: 5, dmg: p.atk * mult * p.shotDmgMul, crit,
        side: 'p', life, owner: p,
        pierceLeft: p.pierce,
        ultPierceNoDecay: !!p.ultPierceNoDecay,   // 终极·贯穿诸天：穿透不衰减
        hit: []
      });
    }
    G.sfxTick();
  }

  /* =========================================================
     环绕飞刃：绕玩家旋转，接触敌人造成伤害（每个敌人独立冷却）
     ========================================================= */
  const ORBIT_CD = 0.45;

  /**
   * 飞刃对某敌人的命中判定半径。
   * 飞行单位（flyer）体型小(r≈11)、移速快且做蛇形机动，贴身骚扰时飞刃外圈很难扫到，
   * 因此对飞行单位额外放大判定——让飞刃真正起到「保护玩家不被贴身怪骚扰」的作用。
   */
  function orbitHitRadiusFor(p, f) {
    let r = (p.orbitHitRadius || 14) + f.r;
    if (f.fly) r += (p.orbitHitRadius || 14) * 0.8 + 10;   // 飞行单位：判定半径约翻倍再 +10
    return r;
  }

  function updateOrbitBlades(p, dt) {
    if (!p.orbits) return;
    const blades = orbitPositions(p);
    const triple = !!p.orbitTriple;

    for (const f of state.foes) {
      if (f.dead) continue;
      const reach = orbitHitRadiusFor(p, f);
      if (!triple) {
        // 普通飞刃：单环，每个敌人一个命中冷却
        if (f.orbitCd > 0) { f.orbitCd -= dt; continue; }
        for (const b of blades) {
          if (G.dist(b.x, b.y, f.x, f.y) < reach) {
            G.dealDamage(p, f, p.atk * p.orbitDmgMul, { tag: 'orbit' });
            f.orbitCd = ORBIT_CD;
            break;
          }
        }
        continue;
      }
      // 终极三层刀阵：每层独立冷却，同一敌人每 0.45s 最多吃三段（每层各一段）
      if (!f.orbitRingCd || f.orbitRingCd.length < 3) f.orbitRingCd = [0, 0, 0];
      for (let r = 0; r < 3; r++) if (f.orbitRingCd[r] > 0) f.orbitRingCd[r] -= dt;
      for (const b of blades) {
        const ring = b.ring || 0;
        if (f.orbitRingCd[ring] > 0) continue;
        if (G.dist(b.x, b.y, f.x, f.y) < reach) {
          G.dealDamage(p, f, p.atk * p.orbitDmgMul, { tag: 'orbit' });
          f.orbitRingCd[ring] = ORBIT_CD;
          // 不 break：三层可在同一帧各命中一次，形成多段
        }
      }
    }
  }

  function orbitPositions(p) {
    const out = [];
    const R = p.orbitR || 64;
    const spd = p.orbitSpd || 2.6;
    if (p.orbitTriple) {
      // 终极·无尽刃环：三层反向刀阵
      // 主环(ring0) 约半数刀刃正转；外环(ring1)/内环(ring2) 数量较少、反向旋转
      // 17 枚 → 主 9 / 外 4 / 内 4；每层带 ring 与 dir 供命中冷却与渲染使用
      const n = p.orbits;
      const nMain = Math.round(n * 0.5), nOuter = Math.round(n * 0.25);
      const layers = [
        { ring: 0, cnt: nMain,                 rr: R,          dir:  1, mul: 1.0  },
        { ring: 1, cnt: nOuter,                rr: R * 1.32,   dir: -1, mul: 0.72 },
        { ring: 2, cnt: n - nMain - nOuter,    rr: R * 0.5,    dir: -1, mul: 1.45 }
      ];
      for (const L of layers) {
        if (L.cnt <= 0) continue;
        for (let i = 0; i < L.cnt; i++) {
          const a = state.time * spd * L.mul * L.dir + (i / L.cnt) * Math.PI * 2;
          out.push({
            x: p.x + Math.cos(a) * L.rr, y: p.y + Math.sin(a) * L.rr,
            ring: L.ring, dir: L.dir
          });
        }
      }
      return out;
    }
    const n = p.orbits;
    for (let i = 0; i < n; i++) {
      const a = state.time * spd + (i / n) * Math.PI * 2;
      out.push({ x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R, ring: 0, dir: 1 });
    }
    return out;
  }

  Object.assign(G, { updatePlayer, nearestFoe, fireVolley, orbitPositions, updateOrbitBlades, orbitHitRadiusFor, effAtkCd });
})(window.ABYSS = window.ABYSS || {});
