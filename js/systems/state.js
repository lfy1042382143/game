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
    monster: null,     // 当前主目标（foes[0]，兼容旧引用）
    foes: [],          // 本波全部敌人（1~4 只小队）
    target: 0,         // 玩家当前选中的敌人下标（foes 内）
    actPtr: 0,         // 敌方轮流行动的指针（多敌人时每回合部分敌人行动）
    loots: [],         // 本波掉落的装备（怪物身上有几件就掉几件）
                       // 每项形如 { item, done, result, slot }
    lootSlots: [],     // 本波实际入手的槽位，用于下一波高亮
    eventQueue: [],    // 待触发的场景事件（进入事件阶段前入队）
    eventLoot: null,   // 事件（商人）产出的装备，进入升级界面处理
    pendingElite: false,  // 下波是否出现更强精英（岔路事件）
    pendingRage: false,   // 下波敌人攻击是否提升（泉水事件）
    best: Number(localStorage.getItem('abyss_best') || 0)
  };

  function makeUnit(base) {
    const u = {
      baseHp: base.hp, baseAtk: base.atk, baseDef: base.def,
      items: [], shield: 0, bleed: null, defended: false,
      strikes: 0,        // 本波已出手次数，用于固定节拍暴击
      guardUsed: 0,      // 本波已举盾次数（怪物 AI 用）
      lastAct: '',       // 上一回合动作，避免连续举盾
      maxHp: 0, hp: 0, atk: 0, def: 0, agg: null, isMon: false,
      elite: false       // 是否为精英怪（小队中较强的一只）
    };
    u.agg = aggregate(u.items);
    recalc(u);
    return u;
  }

  Object.assign(G, { state, makeUnit });
})(window.ABYSS = window.ABYSS || {});
