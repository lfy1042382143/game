/* ============================================================
   游戏层 · combat.js
   实时伤害结算：防御/破甲/减伤/护盾/吸血/反伤/流血
   无概率：暴击走固定节拍（射击时判定），狂怒走血量曲线
   ============================================================ */
(function (G) {
  'use strict';

  const { state, clamp, CFG } = G;

  /* =========================================================
     飘字
     ========================================================= */
  function floatText(u, text, color, big) {
    state.floaters.push({
      x: u.x + (Math.random() * 16 - 8),
      y: u.y - u.r - 6,
      text: String(text),
      c: color || '#fff',
      t: 0.9,
      big: !!big
    });
    if (state.floaters.length > 60) state.floaters.splice(0, state.floaters.length - 60);
  }

  /* =========================================================
     治疗
     ========================================================= */
  function healUnit(u, amt) {
    if (u.dead || amt <= 0) return 0;
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + amt);
    const got = Math.round(u.hp - before);
    if (got > 0) floatText(u, '+' + got, '#4ade80');
    return got;
  }

  /* =========================================================
     伤害入口（一切伤害都走这里）
     opts: { pierce, noThorn, ignoreIframes, flat, crit }
     ========================================================= */
  function dealDamage(src, tgt, amt, opts) {
    opts = opts || {};
    if (!tgt || tgt.dead || amt <= 0) return 0;

    // 玩家无敌帧：受击后的躲避窗口
    if (tgt === state.player && tgt.iframes > 0 && !opts.ignoreIframes) return 0;

    let dmg = amt;

    // 防御减免（flat 词缀如反伤不受防御影响）
    if (!opts.flat) {
      const pierce = opts.pierce !== undefined
        ? opts.pierce
        : (src && src.agg ? src.agg.pierce : 0);
      const effDef = Math.max(0, tgt.def * (1 - clamp(pierce, 0, 80) / 100));
      dmg = Math.max(1, dmg - effDef);
    }

    // 减伤（龙鳞甲）
    if (tgt.agg && tgt.agg.bulwark > 0) {
      dmg *= 1 - Math.min(60, tgt.agg.bulwark) / 100;
    }
    dmg = Math.max(1, Math.round(dmg));

    // 护盾优先吸收
    if (tgt.shield > 0) {
      const absorbed = Math.min(tgt.shield, dmg);
      tgt.shield -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0) floatText(tgt, '盾-' + absorbed, '#7dd3fc');
    }

    // 扣血
    if (dmg > 0) {
      tgt.hp -= dmg;
      tgt.flashT = 0.12;
      // 玩家受击后获得短暂无敌帧（躲避窗口），期间免疫一切伤害
      if (tgt === state.player) tgt.iframes = G.CFG.player.iframes;
      floatText(tgt, dmg, opts.crit ? '#fbbf24' : (tgt === state.player ? '#f87171' : '#fff'), opts.crit);
    }

    // 吸血（攻击方）
    if (src && src.agg && dmg > 0) {
      const leech = Math.round(dmg * clamp(src.agg.leech, 0, 100) / 100);
      if (leech > 0) healUnit(src, leech);
      const vamp = Math.round(dmg * clamp(src.agg.vamp, 0, 100) / 100);
      if (vamp > 0) healUnit(src, vamp);
    }

    // 反伤（尖刺词缀 / 荆棘甲）：反弹固定值，不受防御，不再连锁
    if (!opts.noThorn && src && !src.dead && dmg > 0) {
      const affixThorn = tgt.affix && tgt.affix.key === 'spikes' ? 3 : 0;
      const thorn = Math.max(tgt.agg ? Math.round(tgt.agg.thorn) : 0, affixThorn);
      if (thorn > 0) dealDamage(tgt, src, thorn, { flat: true, noThorn: true, ignoreIframes: false });
    }

    // 受击音效
    if (tgt === state.player) G.sfxHurt();
    else G.sfxHit(!!opts.crit);

    // 死亡结算
    if (tgt.hp <= 0 && !tgt.dead) {
      tgt.hp = 0;
      tgt.dead = true;
      if (tgt !== state.player) {
        state.kills++;
        floatText(tgt, '✦', '#fbbf24', true);
        gainXp(tgt.xp);
      }
    }

    return dmg;
  }

  /** 玩家受伤统一入口（近战接触 / 弹幕 / 反伤） */
  function damagePlayer(src, amt, opts) {
    return dealDamage(src, state.player, amt, opts);
  }

  /* =========================================================
     流血 DoT：每秒跳一次，持续 eff.turns 秒
     ========================================================= */
  function applyBleed(tgt, eff) {
    if (!tgt || tgt.dead || !eff) return;
    tgt.bleed = { dmg: eff.dmg, t: eff.turns, tick: 1 };
  }

  function tickBleeds(u, dt) {
    if (!u.bleed || u.dead) return;
    const b = u.bleed;
    b.t -= dt;
    b.tick -= dt;
    if (b.tick <= 0) {
      b.tick += 1;
      const res = u.agg ? clamp(u.agg.dotres, 0, 90) / 100 : 0;
      dealDamage(null, u, b.dmg * (1 - res), { flat: true, noThorn: true, ignoreIframes: true });
    }
    if (b.t <= 0) u.bleed = null;
  }

  /* =========================================================
     经验与升级：击杀获得经验，满值自动升级
     - 三维属性自动成长（CFG.growth）
     - 立即回复部分生命
     - 每级累积一个待处理的升级选项（三选一，见 cards.js）
     - 跨过等级里程碑时解锁新地图（见 flow.switchMap）
     ========================================================= */
  function xpNeed(level) {
    // 逐层递增：基础 + 线性 + 二次加速项（升级节奏随等级明显放缓）
    const X = CFG.xp;
    const l = level - 1;
    return Math.round(X.base + l * X.perLevel + l * l * (X.accel || 0));
  }

  function gainXp(amount) {
    const p = state.player;
    if (!p || !amount) return;
    p.xp += amount;
    floatText(p, '+' + amount + ' XP', '#c4b5fd');
    while (p.xp >= xpNeed(p.level)) {
      p.xp -= xpNeed(p.level);
      p.level++;
      levelUp(p);
    }
    G.ui.syncTopbar();
  }

  function levelUp(p) {
    const g = CFG.growth;
    p.baseHp += g.hp;
    p.baseAtk += g.atk;
    p.baseDef += g.def;
    G.refresh(p);
    G.healUnit(p, Math.round(p.maxHp * g.healPct));
    floatText(p, 'Lv.' + p.level + ' ↑', '#fbbf24', true);
    state.pendingLevelUps++;

    // 等级里程碑 → 解锁新地图
    const target = Math.min(G.MAPS.length - 1, Math.floor((p.level - 1) / CFG.maps.milestoneEvery));
    if (target > state.mapIdx && G.switchMap) G.switchMap(target);
  }

  /* =========================================================
     狂怒词缀：血量越低攻击越高（最高 +80%）
     ========================================================= */
  function frenzyMul(u) {
    if (!u.affix || u.affix.key !== 'frenzy') return 1;
    return 1 + 0.8 * (1 - u.hp / Math.max(1, u.maxHp));
  }

  Object.assign(G, { floatText, healUnit, dealDamage, damagePlayer, applyBleed, tickBleeds, frenzyMul, xpNeed, gainXp, levelUp });
})(window.ABYSS = window.ABYSS || {});
