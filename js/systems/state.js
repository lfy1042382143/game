/* ============================================================
   系统层 · state.js
   全局状态与单位工厂
   ============================================================ */
(function (G) {
  'use strict';

  const { aggregate, recalc } = G;

  /* =========================================================
     状态
     ========================================================= */
  const state = {
    wave: 1,
    round: 0,
    phase: 'battle',   // battle | busy | upgrade | over
    paused: false,     // 详情面板打开时挂起，避免键盘误触出招
    player: null,
    monster: null,
    loot: null,        // 本波掉落的装备
    lootDone: false,   // 战利品是否已处理（装备/放弃）
    lootSlot: null,    // 本次战利品落入的槽位，用于高亮
    best: Number(localStorage.getItem('abyss_best') || 0)
  };

  function makeUnit(base) {
    const u = {
      baseHp: base.hp, baseAtk: base.atk, baseDef: base.def,
      items: [], shield: 0, bleed: null, defended: false,
      maxHp: 0, hp: 0, atk: 0, def: 0, agg: null, isMon: false
    };
    u.agg = aggregate(u.items);
    recalc(u);
    return u;
  }

  Object.assign(G, { state, makeUnit });
})(window.ABYSS = window.ABYSS || {});
