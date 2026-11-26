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
    // 飘字上限：移动端 lowFx 时减半，防止低端机刷屏掉帧
    const fCap = (CFG.perf && CFG.perf.lowFx)
      ? Math.max(8, Math.round((CFG.perf.floaterCap || 60) / 2))
      : (CFG.perf ? (CFG.perf.floaterCap || 60) : 60);
    if (state.floaters.length > fCap) state.floaters.splice(0, state.floaters.length - fCap);
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

    // 暴击被动（构筑）：玩家攻击敌人时按 pasCrit 概率触发，造成双倍伤害。
    // 与卡片的固定节拍暴击（调用方已在 amt 里乘过倍率、置 opts.crit）独立：
    // 已经暴击的一击不再重复掷骰，避免双重乘算。
    let critHit = !!opts.crit;
    if (!critHit && src === state.player && tgt.isMon && !opts.flat && src.pasCrit > 0
        && Math.random() < src.pasCrit) {
      dmg *= 2;
      critHit = true;
    }

    // 类型抗性/弱点：玩家攻击按 tag 匹配敌人抗性乘区（0 = 免疫，如飞行系免疫地雷；震荡波对飞行 ×0.5）
    if (src === state.player && tgt.isMon && opts.tag && tgt.res) {
      const m = tgt.res[opts.tag];
      if (m !== undefined) {
        if (m <= 0) {
          floatText(tgt, '免疫', '#94a3b8');
          return 0;
        }
        dmg *= m;
      }
    }

    // 精英光环：半径内小怪攻击提升（发射时已锁 dmg 的弹幕也在此统一结算）
    if (src && src.isMon && src.auraAtkMul && src.auraAtkMul > 1) dmg *= src.auraAtkMul;

    // 防御减免（flat 伤害不受防御影响）
    // 敌人：减伤率百分比（def 即减伤%）；玩家：减法防御
    if (!opts.flat) {
      const pierce = opts.pierce || 0;   // 调用方显式破甲（预留）
      if (tgt.isMon) {
        const dr = clamp(tgt.def, 0, 60) * (1 - clamp(pierce, 0, 80) / 100);
        dmg *= 1 - dr / 100;
      } else {
        const effDef = Math.max(0, tgt.def * (1 - clamp(pierce, 0, 80) / 100));
        dmg = Math.max(1, dmg - effDef);
      }
    }
    dmg = Math.max(1, Math.round(dmg));

    // 伤害上限 = 目标当前血量（溢出伤害不结算：敌 10 血吃 20 攻只掉 10）
    dmg = Math.min(dmg, Math.max(0, tgt.hp));

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
      floatText(tgt, dmg, critHit ? '#fbbf24' : (tgt === state.player ? '#f87171' : '#fff'), critHit);
      // 输出统计：按攻击方式归集玩家造成的伤害（opts.tag 由各攻击来源传入）
      if (opts.tag && src === state.player && tgt !== state.player && state.dmgStats) {
        state.dmgStats[opts.tag] = (state.dmgStats[opts.tag] || 0) + dmg;
      }
    }

    // 反伤（尖刺词缀）：反弹固定值，不受防御，不再连锁
    if (!opts.noThorn && src && !src.dead && dmg > 0) {
      const aThorn = affixDataOf(tgt);
      const affixThorn = aThorn && aThorn.thorn ? aThorn.thorn : 0;
      if (affixThorn > 0) dealDamage(tgt, src, affixThorn, { flat: true, noThorn: true, ignoreIframes: false });
    }

    // 受击音效
    if (tgt === state.player) G.sfxHurt();
    else G.sfxHit(critHit);

    // 任务增伤期（水晶任务失败惩罚）：敌人造成的伤害 ×1.15
    if (src && src.isMon && state.enemyRageT > 0) dmg *= 1.15;

    // 任务 NPC 伤害承受系数（使者被围攻时伤害减免，保证任务可完成）
    if (tgt.npcMul) dmg *= tgt.npcMul;

    // 死亡结算
    if (tgt.hp <= 0 && !tgt.dead) {
      tgt.hp = 0;
      tgt.dead = true;
      if (tgt.noKill) return dmg;   // 任务 NPC（使者/同伴等）：不计击杀/经验/掉落
      if (tgt !== state.player) {
        state.kills++;
        floatText(tgt, '✦', '#fbbf24', true);
        gainXp(tgt.xp);
        if (tgt.mimic && G.dropMimicLoot) G.dropMimicLoot(tgt);  // 宝箱怪掉真宝箱
        else if (tgt.elite && G.dropEliteLoot) G.dropEliteLoot(tgt);    // 精英原地掉宝箱
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
      dealDamage(null, u, b.dmg, { flat: true, noThorn: true, ignoreIframes: true });
    }
    if (b.t <= 0) u.bleed = null;
  }

  /* =========================================================
     经验与升级：击杀获得经验，满值自动升级
     - 不再自动成长三维（属性提升全部来自升级选卡）
     - 升级立即回复少量生命（CFG.levelup.healPct）
     - 每级累积一个待处理的升级选项（三选一，见 cards.js）
     - 每 N 级为「攻击方式」升级（cards.modeEvery），其余为属性三选一
     - 跨过等级里程碑时解锁新地图（见 flow.switchMap）
     ========================================================= */
  function xpNeed(level) {
    // 十级一档、档内恒定；跨档二次加速（怪物同步指数成长，等级高也有对应挑战）
    const X = CFG.xp;
    const tier = Math.floor((level - 1) / (X.tierSize || 10));
    return (X.tierBase || 30)
      + tier * (X.tierStep || 14)
      + tier * tier * (X.tierAccel || 14);
  }

  function gainXp(amount) {
    const p = state.player;
    if (!p || !amount) return;
    const gain = Math.max(1, Math.round(amount * (p.xpMul || 1)));
    p.xp += gain;
    floatText(p, '+' + gain + ' XP', '#c4b5fd');
    while (p.xp >= xpNeed(p.level)) {
      p.xp -= xpNeed(p.level);
      p.level++;
      levelUp(p);
    }
    G.ui.syncTopbar();
  }

  function levelUp(p) {
    G.refresh(p);
    G.healUnit(p, p.maxHp);   // 升级血量回满
    floatText(p, 'Lv.' + p.level + ' ↑', '#fbbf24', true);
    state.pendingLevelUps++;

    // 等级里程碑 → 解锁新地图
    const target = Math.min(G.MAPS.length - 1, Math.floor((p.level - 1) / CFG.maps.milestoneEvery));
    if (target > state.mapIdx && G.switchMap) G.switchMap(target);
  }

  /* =========================================================
     词缀数据统一读取：兼容 apply() 生成的 affixData 与直接赋 affix 的情况
     ========================================================= */
  function affixDataOf(u) {
    if (u.affixData) return u.affixData;
    return (u.affix && u.affix.data) || null;
  }

  /* =========================================================
     狂怒词缀：血量越低攻击越高
     ========================================================= */
  function frenzyMul(u) {
    if (!u.affix || u.affix.key !== 'frenzy') return 1;
    const D = affixDataOf(u);
    const bonus = D && D.maxAtkBonus ? D.maxAtkBonus : 0.8;
    return 1 + bonus * (1 - u.hp / Math.max(1, u.maxHp));
  }

  Object.assign(G, { floatText, healUnit, dealDamage, damagePlayer, applyBleed, tickBleeds, frenzyMul, affixDataOf, xpNeed, gainXp, levelUp });
})(window.ABYSS = window.ABYSS || {});
