/* ============================================================
   系统层 · equipment.js
   装备实例构建、属性聚合、生命/攻击/防御重算、词条描述
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG, RARITY, SLOTS, ITEM_DEFS, clamp } = G;

  /* =========================================================
     装备逻辑
     ========================================================= */
  function rarOf(idx) { return RARITY[clamp(idx, 0, 4)]; }

  function buildItem(slotKey, defIdx, rarIdx, level) {
    const def = ITEM_DEFS[slotKey][defIdx];
    const slot = SLOTS.find(s => s.key === slotKey);
    const L0 = level - 1;
    const item = {
      slot: slotKey,
      slotName: slot.name,
      def: def,
      key: def.k,
      name: def.name,
      icon: def.icon,
      rarity: clamp(rarIdx, 0, 4),
      level: level,
      statK: def.stat ? (def.statK || slot.statK) : null,
      statV: def.stat ? Math.round(def.stat[clamp(rarIdx, 0, 4)] + (def.step || 0) * L0) : 0,
      eff: def.mk(clamp(rarIdx, 0, 4), L0)
    };
    item.c = rarOf(item.rarity).c;
    return item;
  }

  function randomItem(slotKey, rarIdx) {
    return buildItem(slotKey, Math.floor(Math.random() * ITEM_DEFS[slotKey].length), rarIdx, 1);
  }

  /** 复制一件装备为独立实例（掉落时用，避免与怪物共享引用） */
  function cloneItem(it) {
    return buildItem(it.slot, ITEM_DEFS[it.slot].indexOf(it.def), it.rarity, it.level);
  }

  /** 现有装备的进阶方向：先强化等级，满级后升华稀有度 */
  function upgradePath(it) {
    const defIdx = ITEM_DEFS[it.slot].indexOf(it.def);
    if (it.level < CFG.forge.maxLevel) {
      return { kind: 'upgrade', item: buildItem(it.slot, defIdx, it.rarity, it.level + 1) };
    }
    if (it.rarity < RARITY.length - 1) {
      return { kind: 'ascend', item: buildItem(it.slot, defIdx, it.rarity + 1, 1) };
    }
    return { kind: 'max', item: it };
  }

  function itemDesc(item) {
    const d = item.def.desc(item.eff, item);
    const statLine = item.statV > 0
      ? '<em>+' + item.statV + ' ' + { atk: '攻击', def: '防御', hp: '生命' }[item.statK] + '</em>'
      : '';
    return statLine ? statLine + '<br>' + d : d;
  }

  function itemDescText(item) {
    return itemDesc(item).replace(/<br>/g, '，').replace(/<\/?em>/g, '');
  }

  function aggregate(items) {
    const A = {
      atkFlat: 0, defFlat: 0, hpFlat: 0,
      bleed: null, crit: 0, critMult: 1.6, leech: 0, thorn: 0,
      guard: 0, bulwark: 0, vamp: 0, dotres: 0, shieldstart: 0, pierce: 0
    };
    items.forEach(it => {
      if (it.statK === 'atk') A.atkFlat += it.statV;
      else if (it.statK === 'def') A.defFlat += it.statV;
      else if (it.statK === 'hp') A.hpFlat += it.statV;

      const e = it.eff;
      switch (it.key) {
        case 'bleed':
          if (!A.bleed || e.dmg > A.bleed.dmg) A.bleed = { dmg: e.dmg, turns: e.turns };
          break;
        case 'crit':
          // 多件暴击装备只取最快节拍（数值更小 = 更频繁）
          A.crit = A.crit ? Math.min(A.crit, e.every) : e.every;
          A.critMult = Math.max(A.critMult, e.mult);
          break;
        case 'leech': A.leech += e.pct; break;
        case 'thorn': A.thorn += e.dmg; break;
        case 'guard': A.guard += e.shield; break;
        case 'bulwark': A.bulwark += e.pct; break;
        case 'vamp': A.vamp += e.pct; break;
        case 'dotres': A.dotres += e.pct; break;
        case 'shieldstart': A.shieldstart += e.shield; break;
        case 'pierce': A.pierce += e.pct; break;
      }
    });
    return A;
  }

  function recalc(u) {
    const oldMax = u.maxHp || 0;
    u.atk = u.baseAtk + u.agg.atkFlat;
    u.def = u.baseDef + u.agg.defFlat;
    u.maxHp = u.baseHp + u.agg.hpFlat;
    if (oldMax > 0) {
      if (u.maxHp > oldMax) u.hp += (u.maxHp - oldMax);
      u.hp = Math.min(u.hp, u.maxHp);
    } else {
      u.hp = u.maxHp;
    }
  }

  function refresh(u) {
    u.agg = aggregate(u.items);
    recalc(u);
  }

  function itemAt(u, slotKey) {
    return u.items.find(i => i.slot === slotKey) || null;
  }

  /** 防御时获得的护盾值：基础 + 防御成长 + 壁垒甲加成 */
  function defendValue(u) {
    return Math.round(CFG.defend.base + u.def * CFG.defend.defMul + u.agg.guard);
  }

  Object.assign(G, { rarOf, buildItem, randomItem, cloneItem, upgradePath, itemDesc, itemDescText, aggregate, recalc, refresh, itemAt, defendValue });
})(window.ABYSS = window.ABYSS || {});
