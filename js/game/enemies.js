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
    const spd = e.speed * (mul || 1) * (G.zoneSlowMul ? G.zoneSlowMul(e.x, e.y) : 1);
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
      n = G.norm(p.x - e.x, p.y - e.y);          // 太远：冲刺追击
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

  /* =========================================================
     法师：完全不动，原地咏唱小范围 AoE
     咏唱 → 玩家当前位置出现预警圈 → warn 后爆发（对圈内所有单位）
     ========================================================= */
  function updateMage(e, dt) {
    const p = state.player;
    if (!p || p.dead) return;
    e.atkCd -= dt;
    if (e.atkCd <= 0) {
      e.atkCd = CFG.mage.castCd;
      state.mageAoes.push({
        x: p.x, y: p.y,
        r: CFG.mage.aoeR,
        warn: CFG.mage.warn,
        t: 0,
        dmg: e.atk,
        owner: e
      });
    }
  }

  /** 法师 AoE 预警与爆发（只对玩家生效） */
  function updateMageAoes(dt) {
    for (let i = state.mageAoes.length - 1; i >= 0; i--) {
      const a = state.mageAoes[i];
      if (a.owner.dead) { state.mageAoes.splice(i, 1); continue; }
      a.t += dt;
      if (a.t < a.warn) continue;

      // 爆发：只命中玩家
      const p = state.player;
      if (p && !p.dead && G.dist(a.x, a.y, p.x, p.y) < a.r) {
        dealDamage(a.owner, p, a.dmg);
      }
      state.mageAoes.splice(i, 1);
    }
  }

  /* =========================================================
     宝箱怪：跳跃式攻击
     爬行接近 → 距离足够时锁定直线方向并预警 → 沿直线高速跳扑
     突进期间接触玩家造成一次伤害，然后进入冷却
     ========================================================= */
  function updateMimic(e, dt) {
    const p = state.player;
    if (!p || p.dead) { e.tele = null; e.dash = null; return; }
    const C = CFG.mimic;

    // 跳扑突进中：沿锁定方向直线冲
    if (e.dash) {
      e.dash.t -= dt;
      const n = e.dash.n;
      e.x += n.x * C.dashSpd * dt;
      e.y += n.y * C.dashSpd * dt;
      e.x = clamp(e.x, e.r, CFG.world.w - e.r);
      e.y = clamp(e.y, e.r, CFG.world.h - e.r);
      // 突进期间接触玩家造成一次伤害
      if (!e.dash.hitDone && G.dist(e.x, e.y, p.x, p.y) < e.r + p.r + 4) {
        dealDamage(e, p, e.atk * G.frenzyMul(e));
        e.dash.hitDone = true;
      }
      if (e.dash.t <= 0) { e.dash = null; e.lungeT = C.cd; }
      return;
    }

    // 预警阶段：方向已锁定，原地蓄力（硬直）
    if (e.tele) {
      e.tele.t -= dt;
      if (e.tele.t <= 0) {
        e.dash = { n: e.tele.n, t: C.dashDur, hitDone: false };
        e.tele = null;
        if (G.sfxHurt) G.sfxHurt();
      }
      return;
    }

    // 冷却阶段：缓慢爬行接近
    e.lungeT -= dt;
    const d = G.dist(e.x, e.y, p.x, p.y);
    if (d > 90) {
      const n = G.norm(p.x - e.x, p.y - e.y);
      moveEnemy(e, n, dt, 1);
    }
    if (e.lungeT <= 0 && d < C.triggerDist) {
      // 锁定当前朝向玩家的直线，进入预警（玩家可侧移躲开）
      e.tele = { t: C.tele, n: G.norm(p.x - e.x, p.y - e.y) };
    }
  }

  /* =========================================================
     BOSS：缓慢追击 + 技能轮换
     扇形弹幕 → 全向环射 → 预警冲撞 → 召唤援军 → 循环
     ========================================================= */
  /** 敌人与玩家不重叠：把敌人推出玩家圆（位移完全由敌人承担） */
  function separateFromPlayer(foes) {
    const p = state.player;
    if (!p || p.dead) return;
    for (const e of foes) {
      if (e.dead) continue;
      const d = G.dist(e.x, e.y, p.x, p.y);
      const min = e.r + p.r;
      if (d >= min) continue;
      if (d < 0.001) { e.x += e.r; continue; }   // 极端重合：直接抖开
      const n = G.norm(p.x - e.x, p.y - e.y);
      e.x = clamp(e.x - n.x * (min - d), e.r, CFG.world.w - e.r);
      e.y = clamp(e.y - n.y * (min - d), e.r, CFG.world.h - e.r);
    }
  }

  function updateBoss(e, dt) {
    const p = state.player;
    if (!p) return;
    const C = CFG.boss;

    /* ---- 冲撞阶段 ---- */
    if (e.bossDash) {
      // 蓄力预警：原地硬直（方向已锁定，玩家可侧移）
      if (e.bossDash.tele > 0) {
        e.bossDash.tele -= dt;
        return;
      }
      // 突进
      const n = e.bossDash.n;
      e.x = clamp(e.x + n.x * C.dashSpd * dt, e.r, CFG.world.w - e.r);
      e.y = clamp(e.y + n.y * C.dashSpd * dt, e.r, CFG.world.h - e.r);
      if (!e.bossDash.hitDone && G.dist(e.x, e.y, p.x, p.y) < e.r + p.r + 4) {
        dealDamage(e, p, e.atk * C.dashDmgMul * G.frenzyMul(e));
        e.bossDash.hitDone = true;
      }
      e.bossDash.t -= dt;
      if (e.bossDash.t <= 0) { e.bossDash = null; e.atkCd = C.skillCd; }
      return;
    }

    /* ---- 常规：缓慢追击 + 近身攻击 ---- */
    const mul = e.affix && e.affix.key === 'swift' ? 1.3 : 1;
    const n = G.norm(p.x - e.x, p.y - e.y);
    moveEnemy(e, n, dt, mul);
    tryMeleeHit(e, dt, 4);

    /* ---- 技能轮换 ---- */
    e.atkCd -= dt;
    if (e.atkCd > 0) return;
    e.skillIdx = ((e.skillIdx || 0) + 1) % 4;

    if (e.skillIdx === 1) {
      // 全向环射：一圈 16 发
      for (let i = 0; i < C.ringCount; i++) {
        const a = (i / C.ringCount) * Math.PI * 2;
        G.fireEnemyBullet(e, e.x + Math.cos(a) * 100, e.y + Math.sin(a) * 100, C.bulletSpeed);
      }
      e.atkCd = C.skillCd;
    } else if (e.skillIdx === 2) {
      // 预警冲撞：锁定当前朝向，蓄力后直线冲
      e.bossDash = { tele: C.dashTele, n: G.norm(p.x - e.x, p.y - e.y), t: C.dashDur, hitDone: false };
    } else if (e.skillIdx === 3) {
      // 召唤援军：在身边召唤 2 只普通怪（有场上上限）
      const alive = state.foes.filter(f => !f.dead).length;
      if (alive < C.summonCap) {
        for (let i = 0; i < C.summonCount; i++) {
          const minion = G.makeEnemy(state.wave, Math.floor(Math.random() * 10));
          const a = Math.random() * Math.PI * 2;
          minion.x = clamp(e.x + Math.cos(a) * (e.r + 50), 40, CFG.world.w - 40);
          minion.y = clamp(e.y + Math.sin(a) * (e.r + 50), 40, CFG.world.h - 40);
          state.foes.push(minion);
        }
        G.floatText(e, '召援!', '#f0abfc', true);
      }
      e.atkCd = C.skillCd;
    } else {
      // 扇形弹幕（开场即放，之后每轮回归）
      const base = Math.atan2(p.y - e.y, p.x - e.x);
      for (let i = 0; i < C.spread; i++) {
        const a = base + (i - (C.spread - 1) / 2) * C.spreadGap;
        G.fireEnemyBullet(e, e.x + Math.cos(a) * 100, e.y + Math.sin(a) * 100, C.bulletSpeed);
      }
      e.atkCd = C.skillCd;
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
      else if (e.type === 'mage') updateMage(e, dt);
      else if (e.type === 'mimic') updateMimic(e, dt);
      else if (e.type === 'boss') updateBoss(e, dt);

      // 帧末速度
      e.vx = (e.x - e.lx) / dt;
      e.vy = (e.y - e.ly) / dt;
    }

    updateMageAoes(dt);
    separate(alive);
    separateFromPlayer(alive);
  }

  Object.assign(G, { updateEnemies, updateMageAoes, updateMimic, updateMage, separateFromPlayer });
})(window.ABYSS = window.ABYSS || {});
