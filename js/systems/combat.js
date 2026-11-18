/* ============================================================
   系统层 · combat.js
   伤害结算、护盾吸收、暴击、吸血、反伤、流血 DoT
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG, state, defendValue, shieldCap, floatNum, allyHost, foeHost } = G;

  /* =========================================================
     战斗核心
     ========================================================= */
  function dealDamage(target, dmg) {
    let d = dmg;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, d);
      target.shield -= absorbed;
      d -= absorbed;
    }
    target.hp = Math.max(0, target.hp - d);
    return d;   // 实际打到生命上的伤害
  }

  function healUnit(u, amount) {
    if (amount <= 0) return 0;
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + amount);
    return u.hp - before;
  }

  /** 护盾/治疗飘字统一走这里，双方都能看见自己的词条在生效 */
  function fxHost(u) {
    return u === state.player ? allyHost() : foeHost();
  }

  function strike(attacker, defender) {
    const A = attacker.agg, D = defender.agg;

    const effDef = defender.def * (1 - Math.min(60, A.pierce) / 100);
    let dmg = Math.max(attacker.atk - effDef, attacker.atk * 0.15);

    // 暴击为固定节拍：第 N 次攻击必定触发，双方都可精确预判
    let crit = false;
    attacker.strikes = (attacker.strikes || 0) + 1;
    if (A.crit > 0 && attacker.strikes % A.crit === 0) {
      dmg *= A.critMult;
      crit = true;
    }
    if (D.bulwark > 0) dmg *= (1 - Math.min(60, D.bulwark) / 100);
    // 狂暴：单场拖过 N 回合后怪物每回合增伤，避免双方治疗互抵后无限僵持
    if (attacker.isMon && state.round > CFG.rage.start) {
      dmg *= 1 + CFG.rage.per * (state.round - CFG.rage.start);
    }
    dmg = Math.max(1, Math.round(dmg));   // 无随机浮动，伤害恒定

    const shieldBefore = defender.shield;
    const applied = dealDamage(defender, dmg);

    // 吸血（攻击方）
    if (A.leech > 0 && applied > 0) {
      const h = healUnit(attacker, Math.floor(applied * A.leech / 100));
      if (h > 0) floatNum(fxHost(attacker), '+' + h, 'heal');
    }
    // 受伤回复（防守方）
    if (D.vamp > 0 && applied > 0 && defender.hp > 0) {
      const h = healUnit(defender, Math.max(1, Math.floor(applied * D.vamp / 100)));
      if (h > 0) floatNum(fxHost(defender), '+' + h, 'heal');
    }
    // 荆棘反伤：属于伤害，同样先由护盾吸收
    if (D.thorn > 0 && attacker.hp > 0) {
      const reflected = dealDamage(attacker, D.thorn);
      floatNum(fxHost(attacker), (reflected === 0 ? '格挡 ' : '') + '-' + (reflected === 0 ? D.thorn : reflected), reflected === 0 ? 'block' : 'hurt');
    }
    // 施加流血
    if (A.bleed && defender.hp > 0) {
      const mul = attacker.isMon ? CFG.mon.bleedMul : 1;
      const bd = Math.max(1, Math.round(A.bleed.dmg * mul));
      if (!defender.bleed || bd >= defender.bleed.dmg) {
        defender.bleed = { dmg: bd, turns: A.bleed.turns };
      } else {
        defender.bleed.turns = Math.max(defender.bleed.turns, A.bleed.turns);
      }
    }

    return { dmg, applied, crit, absorbed: shieldBefore > 0 && applied === 0 };
  }

  function doDefend(u) {
    const cap = shieldCap(u);
    const before = u.shield;
    u.shield = Math.min(cap, u.shield + defendValue(u));
    u.defended = true;
    return u.shield - before;   // 实际获得的护盾（可能被上限吃掉）
  }

  function tickBleed(u) {
    if (!u.bleed) return 0;
    let d = u.bleed.dmg;
    if (u.agg.dotres > 0) d = Math.max(1, Math.round(d * (1 - Math.min(80, u.agg.dotres) / 100)));
    u.hp = Math.max(0, u.hp - d);        // 流血无视护盾
    u.bleed.turns -= 1;
    if (u.bleed.turns <= 0) u.bleed = null;
    return d;
  }

  Object.assign(G, { dealDamage, healUnit, strike, doDefend, tickBleed });
})(window.ABYSS = window.ABYSS || {});
