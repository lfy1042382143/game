/* ============================================================
   游戏层 · player.js
   玩家实体：WASD 移动、障碍碰撞、自动射击（散射/贯穿）、环绕飞刃
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp, pushOutOfPoly } = G;

  function effAtkCd(p) {
    const haste = (p.agg && p.agg.hastestone) || 0;   // 迅捷符：射击间隔缩短
    return Math.max(0.18, CFG.player.atkCd * p.atkCdMul * (1 - haste / 100));
  }

  function updatePlayer(dt) {
    const p = state.player;
    if (!p || p.dead) return;
    const W = CFG.world;

    /* ---------- 移动 ---------- */
    const mv = G.engine.moveVec();
    if (mv.dx || mv.dy) {
      const n = G.norm(mv.dx, mv.dy);
      // 减速泥潭（沼泽地图陷阱）：在泥潭中移动变慢
      const zslow = G.zoneSlowMul ? G.zoneSlowMul(p.x, p.y) : 1;
      const haste = p.hasteT > 0 ? (1 + clamp(p.agg && p.agg.haste ? p.agg.haste : 0, 0, 100) / 100) : 1;
      const spd = p.speed * (1 + clamp(p.agg.swiftstep, 0, 40) / 100) * haste * zslow;
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
    if (p.hasteT > 0) p.hasteT -= dt;   // 回响头盔受击加速剩余时间

    /* ---------- 蓄能甲：脱战 3 秒后回盾（上限 60） ---------- */
    if (p.agg && p.agg.charger > 0) {
      if (p.hurtT > 0) p.hurtT -= dt;
      else if (p.shield < 60) p.shield = Math.min(60, p.shield + p.agg.charger * dt);
    }

    /* ---------- 再生头环：每秒回复固定生命 ---------- */
    if (p.agg && p.agg.regen > 0 && p.hp < p.maxHp) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + p.agg.regen * dt);
      p.regenAcc = (p.regenAcc || 0) + (p.hp - before);
      if (p.regenAcc >= 5) {   // 每 5 点显示一次提示，避免刷屏
        G.floatText(p, '+' + Math.round(p.regenAcc), '#86efac');
        p.regenAcc = 0;
      }
    }

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

    /* ---------- 持续射击 ---------- */
    p.atkT -= dt;
    if (p.atkT <= 0) {
      // 无论是否有敌人都在攻击间隔到点时持续开火（朝鼠标方向；无鼠标时兜底最近敌人）
      fireVolley(p);
      p.atkT = effAtkCd(p);
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
    // 装备暴击节拍（裂风刃）
    if (p.agg.crit > 0 && p.strikes % p.agg.crit === 0) {
      crit = true;
      mult = p.agg.critMult;
    }
    // 卡片暴击节拍（暴击节奏）：与装备节拍独立判定，倍率取更高
    if (p.critEvery > 0 && p.strikes % p.critEvery === 0) {
      crit = true;
      mult = Math.max(mult, p.critMult);
    }
    // 鹰眼盔：暴击伤害加成
    if (crit && p.agg && p.agg.eagle > 0) {
      mult *= 1 + p.agg.eagle / 100;
    }

    const bSpd = CFG.player.bulletSpeed * p.bulletSpeedMul;
    const aim = aimPoint(p);
    const baseA = Math.atan2(aim.y - p.y, aim.x - p.x);

    const n = p.shots;
    const life = p.range / bSpd;   // 箭矢飞满射程即消失
    for (let i = 0; i < n; i++) {
      const a = baseA + (i - (n - 1) / 2) * 0.16;
      const v = { x: Math.cos(a), y: Math.sin(a) };
      state.bullets.push({
        x: p.x + v.x * (p.r + 4), y: p.y + v.y * (p.r + 4),
        vx: v.x * bSpd, vy: v.y * bSpd,
        r: 5, dmg: p.atk * mult * p.shotDmgMul, crit,
        side: 'p', life, owner: p,
        pierceLeft: p.pierce,
        hit: []
      });
    }
    G.sfxTick();
  }

  /* =========================================================
     环绕飞刃：绕玩家旋转，接触敌人造成伤害（每个敌人独立冷却）
     ========================================================= */
  const ORBIT_CD = 0.45;

  function updateOrbitBlades(p, dt) {
    if (!p.orbits) return;
    const blades = orbitPositions(p);

    for (const f of state.foes) {
      if (f.dead) continue;
      if (f.orbitCd > 0) { f.orbitCd -= dt; continue; }
      for (const b of blades) {
        if (G.dist(b.x, b.y, f.x, f.y) < 10 + f.r) {
          G.dealDamage(p, f, p.atk * p.orbitDmgMul, { tag: 'orbit' });
          f.orbitCd = ORBIT_CD;
          break;
        }
      }
    }
  }

  function orbitPositions(p) {
    const out = [];
    const n = p.orbits;
    const R = p.orbitR || 64;
    const spd = p.orbitSpd || 2.6;
    if (p.orbitDual) {
      // 双层：外圈 + 内圈各 6 枚
      for (let i = 0; i < n; i++) {
        const outer = i < n / 2;
        const idx = outer ? i : i - n / 2;
        const cnt = n / 2;
        const rr = outer ? R : R * 0.55;
        const a = state.time * spd * (outer ? 1 : -1.35) + (idx / cnt) * Math.PI * 2;
        out.push({ x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr });
      }
      return out;
    }
    for (let i = 0; i < n; i++) {
      const a = state.time * spd + (i / n) * Math.PI * 2;
      out.push({ x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R });
    }
    return out;
  }

  Object.assign(G, { updatePlayer, nearestFoe, fireVolley, orbitPositions, effAtkCd });
})(window.ABYSS = window.ABYSS || {});
