/* ============================================================
   游戏层 · enemies.js
   敌人 AI：
   - 近战：追击玩家，接触后近身攻击（狂怒词缀血量越低攻击越高）
   - 远程：保持距离带，侧向环绕，朝玩家发射弹幕
   - BOSS：缓慢追击 + 扇形弹幕
   词缀行为：迅捷加速、再生回血、狂怒增伤、尖刺反伤（结算在 combat）
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp, pushOutOfRect, dealDamage, healUnit } = G;

  /* =========================================================
     敌人之间的分离（避免叠成一团）
     ========================================================= */
  function separate(foes) {
    for (let i = 0; i < foes.length; i++) {
      for (let j = i + 1; j < foes.length; j++) {
        const a = foes[i], b = foes[j];
        if (a.dead || b.dead) continue;
        const d = G.dist(a.x, a.y, b.x, b.y);
        const min = a.r + b.r;
        if (d < min && d > 0.001) {
          const push = (min - d) / 2;
          const n = G.norm(b.x - a.x, b.y - a.y);
          a.x -= n.x * push; a.y -= n.y * push;
          b.x += n.x * push; b.y += n.y * push;
        }
      }
    }
  }

  /* =========================================================
     移动公共步骤
     ========================================================= */
  function moveEnemy(e, n, dt, mul) {
    const A = CFG.world;
    // 减速箭：slowT 期间移动速度乘算 slowMul
    if (e.slowT > 0) {
      e.slowT -= dt;
      mul *= (e.slowMul !== undefined ? e.slowMul : 1);
    }
    const spd = e.speed * (mul || 1);
    e.x += n.x * spd * dt;
    e.y += n.y * spd * dt;
    e.x = clamp(e.x, e.r, A.w - e.r);
    e.y = clamp(e.y, e.r, A.h - e.r);
    for (const o of state.obstacles) pushOutOfRect(e, o);
  }

  /* =========================================================
     近战攻击
     ========================================================= */
  function tryMeleeHit(e, dt, reach) {
    e.atkCd -= dt;
    const p = state.player;
    if (!p || p.dead) return;
    if (G.dist(e.x, e.y, p.x, p.y) < e.r + p.r + reach && e.atkCd <= 0) {
      dealDamage(e, p, e.atk * G.frenzyMul(e));
      e.atkCd = CFG.melee.atkCd;
    }
  }

  /* =========================================================
     各类型 AI
     ========================================================= */
  function updateMelee(e, dt) {
    const p = state.player;
    if (!p) return;
    const mul = e.affix && e.affix.key === 'swift' ? 1.45 : 1;
    const n = G.norm(p.x - e.x, p.y - e.y);
    moveEnemy(e, n, dt, mul);
    tryMeleeHit(e, dt, CFG.melee.reach);
  }

  function updateRanged(e, dt) {
    const p = state.player;
    if (!p) return;
    const C = CFG.ranged;
    const d = G.dist(e.x, e.y, p.x, p.y);
    const mul = e.affix && e.affix.key === 'swift' ? 1.45 : 1;

    let n;
    if (d > C.keepMax + 140) {
      n = G.norm(p.x - e.x, p.y - e.y);          // 太远：冲刺追击（打破风筝死锁）
      moveEnemy(e, n, dt, mul * 2.6);
    } else if (d > C.keepMax) {
      n = G.norm(p.x - e.x, p.y - e.y);          // 距离带外：加速靠近
      moveEnemy(e, n, dt, mul * 1.7);
    } else if (d < C.keepMin) {
      n = G.norm(e.x - p.x, e.y - p.y);          // 太近：后撤
      moveEnemy(e, n, dt, mul * 1.25);
    } else {
      // 距离带内：侧向环绕
      const perp = { x: (p.y - e.y) * e.strafeDir, y: (e.x - p.x) * e.strafeDir };
      n = G.norm(perp.x, perp.y);
      moveEnemy(e, n, dt, mul * 0.55);
    }

    // 发射弹幕
    e.atkCd -= dt;
    if (e.atkCd <= 0) {
      G.fireEnemyBullet(e, p.x, p.y, C.bulletSpeed);
      e.atkCd = C.shootCd;
    }
  }

  function updateBoss(e, dt) {
    const p = state.player;
    if (!p) return;
    const C = CFG.boss;
    const mul = e.affix && e.affix.key === 'swift' ? 1.3 : 1;
    const n = G.norm(p.x - e.x, p.y - e.y);
    moveEnemy(e, n, dt, mul);
    tryMeleeHit(e, dt, 4);

    // 扇形弹幕
    e.atkCd -= dt;
    if (e.atkCd <= 0) {
      const base = Math.atan2(p.y - e.y, p.x - e.x);
      const spread = C.spread;
      for (let i = 0; i < spread; i++) {
        const a = base + (i - (spread - 1) / 2) * 0.28;
        G.fireEnemyBullet(e, e.x + Math.cos(a) * 100, e.y + Math.sin(a) * 100, C.bulletSpeed);
      }
      e.atkCd = C.shootCd;
    }
  }

  /* =========================================================
     主更新
     ========================================================= */
  function updateEnemies(dt) {
    const alive = state.foes.filter(f => !f.dead);
    if (!alive.length) return;

    for (const e of alive) {
      // 记录本帧移动前的位置（供玩家预判瞄准用）
      e.lx = e.x; e.ly = e.y;

      // 再生词缀：每 3 秒回复 8% 生命
      if (e.affix && e.affix.key === 'regen') {
        e.regenT = (e.regenT || 0) + dt;
        if (e.regenT >= 3) {
          e.regenT -= 3;
          healUnit(e, Math.max(1, Math.round(e.maxHp * 0.08)));
        }
      }
      G.tickBleeds(e, dt);
      if (e.dead) continue;

      if (e.type === 'melee') updateMelee(e, dt);
      else if (e.type === 'ranged') updateRanged(e, dt);
      else if (e.type === 'boss') updateBoss(e, dt);

      // 帧末速度（供玩家预判瞄准）
      e.vx = (e.x - e.lx) / dt;
      e.vy = (e.y - e.ly) / dt;
    }

    separate(alive);
  }

  Object.assign(G, { updateEnemies });
})(window.ABYSS = window.ABYSS || {});
