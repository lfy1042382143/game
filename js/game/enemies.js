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

  const { state, CFG, clamp, pushOutOfPoly, dealDamage, healUnit } = G;

  /* =========================================================
     敌人之间的分离（避免叠成一团）
     ========================================================= */
  function separate(foes) {
    // 柔性分离：先累积每只敌人的推挤向量，统一限幅后应用。
    // 旧版逐对直接位移，密集时多邻域推力叠加过冲，表现为"拥挤抖动"。
    const Relax = 0.6;      // 每帧只修正 60% 的重叠量
    const MaxPush = 1.2;    // 单只敌人每帧最大位移（px），封顶防抖
    const n = foes.length;
    const px = new Float64Array(n), py = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = foes[i];
      if (a.dead) continue;
      for (let j = i + 1; j < n; j++) {
        const b = foes[j];
        if (b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const min = a.r + b.r;
        if (d < min && d > 0.001) {
          const push = (min - d) * Relax * 0.5;
          const nx = dx / d, ny = dy / d;
          px[i] -= nx * push; py[i] -= ny * push;
          px[j] += nx * push; py[j] += ny * push;
        }
      }
    }
    const A = CFG.world;
    for (let i = 0; i < n; i++) {
      const e = foes[i];
      if (e.dead) continue;
      const mag = Math.sqrt(px[i] * px[i] + py[i] * py[i]);
      const k = mag > MaxPush ? MaxPush / mag : 1;
      e.x = clamp(e.x + px[i] * k, e.r, A.w - e.r);
      e.y = clamp(e.y + py[i] * k, e.r, A.h - e.r);
    }
  }

  /* =========================================================
     移动公共步骤
     ========================================================= */
  /** 障碍绕行：前方探测到障碍 → 提前沿边缘切向偏转；已贴合 → 沿切线滑向目标一侧 */
  function avoidObstacles(e, n) {
    const obs = state.obstacles;
    if (!obs.length) return n;
    const look = e.r + 30;   // 前方探测距离
    for (const o of obs) {
      if (!o.pts || !o.pts.length) continue;   // 兼容异常障碍数据
      if (G.dist(e.x, e.y, o.x, o.y) > o.r + look + e.r) continue;
      const fx = e.x + n.x * look, fy = e.y + n.y * look;
      const inside = G.circlePoly(e.x, e.y, e.r + 2, o);
      const ahead = !inside && G.circlePoly(fx, fy, Math.max(4, e.r * 0.8), o);
      if (!inside && !ahead) continue;
      // 外向方向：贴身取最近边法线，前方拦截取探测点相对障碍中心
      let nx, ny;
      if (inside) {
        const near = G.nearestOnPoly(e.x, e.y, o.pts);
        nx = e.x - near.x; ny = e.y - near.y;
      } else {
        nx = fx - o.x; ny = fy - o.y;
      }
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      // 外向方向已朝向玩家 → 直接朝玩家走（贴身时带一点外推），打破绕圈
      const align = nx * n.x + ny * n.y;
      if (align > 0.25) {
        return inside ? G.norm(n.x * 0.75 + nx * 0.55, n.y * 0.75 + ny * 0.55) : n;
      }
      // 沿切线绕行：对同一障碍物记住绕行侧（防止对齐度相近时逐帧翻面抖动）；
      // 卡死强制绕行期间优先使用 detourSide
      const side = (e.detourT > 0 && e.detourSide)
        ? e.detourSide
        : (e.avoidObs === o && e.avoidSide
          ? e.avoidSide
          : ((-ny) * n.x + nx * n.y >= ny * n.x - nx * n.y ? 1 : -1));
      e.avoidObs = o;
      e.avoidSide = side;
      const tx = -ny * side, ty = nx * side;
      // 沿切线滑动为主，混入少量外推与原方向分量，避免贴墙抖动
      const w = inside ? 0.85 : 0.7;
      const mix = 1 - w;
      return G.norm(tx * w + nx * mix * 0.6 + n.x * mix * 0.4,
                    ty * w + ny * mix * 0.6 + n.y * mix * 0.4);
    }
    e.avoidObs = null;   // 脱离接触后重置，下次接触重新选侧
    return n;
  }

  function moveEnemy(e, n, dt, mul) {
    const A = CFG.world;
    // 减速箭：slowT 期间移动速度乘算 slowMul
    if (e.slowT > 0) {
      e.slowT -= dt;
      mul *= (e.slowMul !== undefined ? e.slowMul : 1);
    }
    // 卡死绕行计时
    if (e.detourT > 0) e.detourT -= dt;
    const spd = e.speed * (mul || 1) * (G.zoneSlowMul ? G.zoneSlowMul(e.x, e.y) : 1);
    // 障碍绕行转向（前方拦截 / 贴边滑行）
    const nav = avoidObstacles(e, n);
    const bx = e.x, by = e.y;
    e.x += nav.x * spd * dt;
    e.y += nav.y * spd * dt;
    e.x = clamp(e.x, e.r, A.w - e.r);
    e.y = clamp(e.y, e.r, A.h - e.r);
    for (const o of state.obstacles) pushOutOfPoly(e, o);
    // 卡死检测：想移动但实际位移极小 → 强制沿一侧绕行；一侧不通则换另一侧
    const moved = G.dist(bx, by, e.x, e.y);
    if (spd * dt > 0.005 && moved < spd * dt * 0.35) {
      e.stuckT = (e.stuckT || 0) + dt;
      if (e.stuckT > 0.4) {
        if (!e.detourSide) e.detourSide = Math.random() < 0.5 ? 1 : -1;
        else if (e.stuckT > 1.6) e.detourSide = -e.detourSide;   // 换向再试
        e.detourT = 0.9;
      }
    } else {
      e.stuckT = Math.max(0, (e.stuckT || 0) - dt * 2);
      if ((e.stuckT || 0) <= 0) e.detourSide = 0;
    }
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
    const AD = G.affixDataOf(e);
    const mul = AD && AD.speedMul ? AD.speedMul : 1;
    const n = G.norm(p.x - e.x, p.y - e.y);
    moveEnemy(e, n, dt, mul);
    tryMeleeHit(e, dt, CFG.melee.reach);
  }

  function updateRanged(e, dt) {
    const p = state.player;
    if (!p) return;
    const C = CFG.ranged;
    const d = G.dist(e.x, e.y, p.x, p.y);
    const AD = G.affixDataOf(e);
    const mul = AD && AD.speedMul ? AD.speedMul : 1;

    let n;
    if (d > C.keepMax + 140) {
      n = G.norm(p.x - e.x, p.y - e.y);          // 太远：冲刺追击
      moveEnemy(e, n, dt, mul * 2.6);
    } else if (d > C.keepMax) {
      n = G.norm(p.x - e.x, p.y - e.y);          // 距离带外：加速靠近
      moveEnemy(e, n, dt, mul * 1.7);
    } else if (d < C.keepMin) {
      // 太近：后撤——速度必须明显低于玩家，否则玩家靠近时会感觉敌人"加速暴涨"逃走
      n = G.norm(e.x - p.x, e.y - p.y);
      // 后撤速度 = 自身速度 × 0.8，且硬上限为玩家速度的 0.7（迅捷词缀也不豁免）
      const fleeCap = CFG.player.speed * 0.7;
      const fleeSpd = Math.min(e.speed * 0.8, fleeCap);
      moveEnemy(e, n, dt, fleeSpd / e.speed);
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
     法师：不能移动，但会周期性「闪现」到玩家附近的落点
     闪现有紫色预警前摇，位移后继续原地咏唱 AoE
     ========================================================= */
  /** 在玩家周围找一个不压障碍/不重叠其他敌人的闪现落点 */
  function findBlinkSpot(e) {
    const p = state.player, M = CFG.mage, A = CFG.world;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = M.blinkMin + Math.random() * (M.blinkMax - M.blinkMin);
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      if (x < 60 || y < 60 || x > A.w - 60 || y > A.h - 60) continue;
      if (state.obstacles.some(o => G.circlePoly(x, y, e.r + 12, o))) continue;
      let crowded = false;
      for (const f of state.foes) {
        if (f === e || f.dead) continue;
        if (G.dist(x, y, f.x, f.y) < f.r + e.r + 10) { crowded = true; break; }
      }
      if (!crowded) return { x, y };
    }
    return null;
  }

  function updateMage(e, dt) {
    const p = state.player;
    if (!p || p.dead) return;
    const M = CFG.mage;

    /* ---- 闪现前摇：预警期间不施法，结束后瞬移到锁定落点 ---- */
    if (e.blinkWarnT > 0) {
      e.blinkWarnT -= dt;
      if (e.blinkWarnT <= 0) {
        if (e.blinkTo) {
          e.x = e.blinkTo.x; e.y = e.blinkTo.y;
          e.lx = e.x; e.ly = e.y;   // 避免瞬移被记成超高速度（影响玩家预判）
          e.blinkTo = null;
          if (G.floatText) G.floatText(e, '闪现', '#c4b5fd', true);
        }
        e.blinkT = M.blinkCd;
      }
      return;
    }

    /* ---- 闪现判定：玩家跑出威胁环带时重新定位 ---- */
    if (e.blinkT === undefined) e.blinkT = M.blinkCd * (0.4 + Math.random() * 0.6);
    e.blinkT -= dt;
    if (e.blinkT <= 0) {
      const d = G.dist(e.x, e.y, p.x, p.y);
      if (d > M.blinkMax || d < M.blinkMin) {
        const spot = findBlinkSpot(e);
        if (spot) { e.blinkTo = spot; e.blinkWarnT = M.blinkWarn; return; }
      }
      e.blinkT = 1;   // 落点被占：稍后再试
    }

    /* ---- 原地咏唱 ---- */
    e.atkCd -= dt;
    if (e.atkCd <= 0) {
      e.atkCd = M.castCd;
      state.mageAoes.push({
        x: p.x, y: p.y,
        r: M.aoeR,
        warn: M.warn,
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

    // 半血狂暴：一次性触发，攻击/移速/技能频率全面强化
    if (!e.raged && e.hp <= e.maxHp * C.rageAt) {
      e.raged = true;
      e.atk = Math.round(e.atk * C.rageAtkMul);
      if (G.floatText) G.floatText(e, '狂暴!', '#f87171', true);
    }
    const raged = !!e.raged;

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
      if (e.bossDash.t <= 0) { e.bossDash = null; e.atkCd = C.skillCd * (raged ? C.rageSkillMul : 1); }
      return;
    }

    /* ---- 常规：缓慢追击 + 近身攻击 ---- */
    const BAD = G.affixDataOf(e);
    const mul = (BAD && BAD.speedMul ? BAD.speedMul : 1) * (raged ? C.rageSpeedMul : 1);
    const n = G.norm(p.x - e.x, p.y - e.y);
    moveEnemy(e, n, dt, mul);
    tryMeleeHit(e, dt, 4);

    /* ---- 技能轮换 ---- */
    e.atkCd -= dt;
    if (e.atkCd > 0) return;
    e.skillIdx = ((e.skillIdx || 0) + 1) % 4;

    if (e.skillIdx === 1) {
      // 全向环射：狂暴时 +4 发
      const count = C.ringCount + (raged ? C.rageRingAdd : 0);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        G.fireEnemyBullet(e, e.x + Math.cos(a) * 100, e.y + Math.sin(a) * 100, C.bulletSpeed);
      }
      e.atkCd = C.skillCd * (raged ? C.rageSkillMul : 1);
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
      e.atkCd = C.skillCd * (raged ? C.rageSkillMul : 1);
    } else {
      // 扇形弹幕（开场即放，之后每轮回归）
      const base = Math.atan2(p.y - e.y, p.x - e.x);
      for (let i = 0; i < C.spread; i++) {
        const a = base + (i - (C.spread - 1) / 2) * C.spreadGap;
        G.fireEnemyBullet(e, e.x + Math.cos(a) * 100, e.y + Math.sin(a) * 100, C.bulletSpeed);
      }
      e.atkCd = C.skillCd * (raged ? C.rageSkillMul : 1);
    }
  }

  /* =========================================================
     精英光环：精英存活时，半径内的小怪攻击提升（每帧刷新）
     ========================================================= */
  function applyEliteAura(foes) {
    const E = CFG.elite;
    const elites = foes.filter(f => !f.dead && f.elite);
    const r2 = E.auraRadius * E.auraRadius;
    for (const e of foes) {
      if (e.dead || e.elite) continue;
      let buff = 1;
      for (const a of elites) {
        if (G.dist(e.x, e.y, a.x, a.y) < E.auraRadius) { buff = E.auraAtkMul; break; }
      }
      e.auraAtkMul = buff;
    }
  }

  /* =========================================================
     主更新
     ========================================================= */
  function updateEnemies(dt) {
    const alive = state.foes.filter(f => !f.dead);
    if (!alive.length) return;

    applyEliteAura(alive);

    for (const e of alive) {
      // 记录本帧移动前的位置（供玩家预判瞄准用）
      e.lx = e.x; e.ly = e.y;

      // 再生词缀：数据驱动的回血节拍与比例
      const AD = G.affixDataOf(e);
      if (AD && AD.pct) {
        e.regenT = (e.regenT || 0) + dt;
        if (e.regenT >= AD.every) {
          e.regenT -= AD.every;
          healUnit(e, Math.max(1, Math.round(e.maxHp * AD.pct)));
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

  Object.assign(G, { updateEnemies, updateMageAoes, updateMimic, updateMage, findBlinkSpot, separateFromPlayer, applyEliteAura });
})(window.ABYSS = window.ABYSS || {});
