/* ============================================================
   游戏层 · state.js（实时版）
   全局状态与实体工厂
   phase: boot | play | busy | upgrade | event | over
   ============================================================ */
(function (G) {
  'use strict';

  const { aggregate, recalc, CFG, pick } = G;

  /* =========================================================
     状态
     ========================================================= */
  const state = {
    wave: 1,
    phase: 'boot',     // boot | play | busy | upgrade | event | over
    paused: false,     // 弹窗期间挂起 update
    time: 0,           // 本局累计游戏时间（秒）

    player: null,
    foes: [],          // 本波敌人（实时实体）
    bullets: [],       // 双方弹幕
    floaters: [],      // 飘字（伤害/治疗数字）

    // 竞技场障碍物（柱子，阻挡移动与弹幕）
    obstacles: [],

    loots: [],         // 本波掉落装备 { item, done, result, slot }
    lootSlots: [],
    kills: 0,

    pendingElite: false,  // 岔路事件：下波精英增强
    pendingRage: false,   // 泉水事件：下波敌人攻击提升

    banner: null,      // { text, sub, t } 开波提示

    best: 0
  };

  try { state.best = Number(localStorage.getItem('abyss_best') || 0); } catch (e) { state.best = 0; }

  function saveBest() {
    try { localStorage.setItem('abyss_best', String(state.best)); } catch (e) { /* 无痕模式忽略 */ }
  }

  /* =========================================================
     实体工厂
     ========================================================= */
  /** 基础战斗单位（玩家与敌人通用） */
  function makeUnit(base) {
    const u = {
      baseHp: base.hp, baseAtk: base.atk, baseDef: base.def,
      items: [], shield: 0, bleed: null,
      strikes: 0,          // 出手计数（固定节拍暴击）
      maxHp: 0, hp: 0, atk: 0, def: 0, agg: null, isMon: !!base.isMon,
      // 实体字段
      x: base.x || 0, y: base.y || 0,
      r: base.r || 14,
      speed: base.speed || 0,
      atkCd: 0,            // 攻击冷却（秒）
      flashT: 0,           // 受击闪白
      iframes: 0,          // 无敌时间（玩家用）
      // 敌人字段
      type: base.type || null,        // melee | ranged | boss
      name: base.name || '',
      emoji: base.emoji || '',
      elite: false,
      affix: null,         // { key, name, icon, ... }
      strafeDir: 1,        // 远程敌人环绕方向（确定性）
      dead: false
    };
    u.agg = aggregate(u.items);
    recalc(u);
    return u;
  }

  function makePlayer() {
    const C = CFG.player;
    const p = makeUnit({
      hp: C.hp, atk: C.atk, def: C.def,
      x: CFG.arena.w / 2, y: CFG.arena.h / 2,
      r: C.r, speed: C.speed,
      name: '冒险者', emoji: '⚔️'
    });
    p.iframes = 0;
    p.atkT = C.atkCd * 0.5;   // 开局很快打出第一箭
    return p;
  }

  /** 竞技场障碍物：4 根对称柱子 */
  function makeObstacles() {
    const A = CFG.arena;
    const s = 56;
    return [
      { x: A.w * 0.5 - 230 - s / 2, y: A.h * 0.5 - 120 - s / 2, w: s, h: s },
      { x: A.w * 0.5 + 230 - s / 2, y: A.h * 0.5 - 120 - s / 2, w: s, h: s },
      { x: A.w * 0.5 - 230 - s / 2, y: A.h * 0.5 + 120 - s / 2, w: s, h: s },
      { x: A.w * 0.5 + 230 - s / 2, y: A.h * 0.5 + 120 - s / 2, w: s, h: s }
    ];
  }

  Object.assign(G, { state, saveBest, makeUnit, makePlayer, makeObstacles });
})(window.ABYSS = window.ABYSS || {});
