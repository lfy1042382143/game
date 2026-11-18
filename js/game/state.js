/* ============================================================
   游戏层 · state.js（实时版 · 经验升级 + 大地图）
   全局状态与实体工厂
   phase: boot | play | busy | levelup | loot | event | over
   ============================================================ */
(function (G) {
  'use strict';

  const { aggregate, recalc, CFG, pick } = G;

  /* =========================================================
     状态
     ========================================================= */
  const state = {
    wave: 1,
    phase: 'boot',     // boot | play | busy | levelup | loot | event | over
    paused: false,
    time: 0,           // 本局累计游戏时间（秒）

    player: null,
    foes: [],
    bullets: [],
    floaters: [],

    mapIdx: 0,             // 当前地图主题下标（按等级里程碑推进）
    obstacles: [],         // 动态障碍物（随玩家移动随机生成/移除）
    obsT: 0,               // 障碍物生成计时

    loots: [],
    lootSlots: [],
    kills: 0,
    pendingLevelUps: 0,    // 待处理的升级选项数（每级一张三选一）

    pendingElite: false,
    pendingRage: false,

    banner: null,

    best: 0
  };

  try { state.best = Number(localStorage.getItem('abyss_best') || 0); } catch (e) { state.best = 0; }

  function saveBest() {
    try { localStorage.setItem('abyss_best', String(state.best)); } catch (e) { /* 忽略 */ }
  }

  /* =========================================================
     实体工厂
     ========================================================= */
  function makeUnit(base) {
    const u = {
      baseHp: base.hp, baseAtk: base.atk, baseDef: base.def,
      items: [], shield: 0, bleed: null,
      strikes: 0,
      maxHp: 0, hp: 0, atk: 0, def: 0, agg: null, isMon: !!base.isMon,
      x: base.x || 0, y: base.y || 0,
      r: base.r || 13,
      speed: base.speed || 0,
      atkCd: 0,
      flashT: 0,
      iframes: 0,
      type: base.type || null,
      name: base.name || '',
      emoji: base.emoji || '',
      elite: false,
      affix: null,
      strafeDir: 1,
      xp: base.xp || 0,     // 击杀提供的经验
      orbitCd: 0,           // 被环绕飞刃命中的冷却
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
      x: CFG.world.w / 2, y: CFG.world.h / 2,
      r: C.r, speed: C.speed,
      name: '冒险者', emoji: '⚔️'
    });
    p.iframes = 0;
    p.atkT = C.atkCd * 0.5;
    // 等级与攻击方式
    p.level = 1;
    p.xp = 0;
    p.atkCdMul = 1;    // 攻速乘算系数（攻速提升卡）
    p.shots = 1;       // 每次射击的箭矢数（散射箭）
    p.pierce = 0;      // 箭矢贯穿数（贯穿箭）
    p.homing = 0;      // 追踪强度（追踪箭）
    p.orbits = 0;      // 环绕飞刃数量
    return p;
  }

  /* =========================================================
     动态障碍物
     ========================================================= */
  function rectsOverlap(a, b, gap) {
    gap = gap || 0;
    return a.x - gap < b.x + b.w && a.x + a.w + gap > b.x &&
           a.y - gap < b.y + b.h && a.y + a.h + gap > b.y;
  }

  function conflictsObstacles(rect) {
    return state.obstacles.some(o => rectsOverlap(rect, o, 40));
  }

  /** 在世界内随机生成 n 个障碍物（避开玩家与现有障碍） */
  function spawnObstaclesRandom(n) {
    const W = CFG.world;
    const C = CFG.obstacles;
    const p = state.player;
    let made = 0, tries = 0;
    while (made < n && tries++ < 200) {
      const size = C.sizeMin + Math.random() * (C.sizeMax - C.sizeMin);
      const rect = {
        x: 60 + Math.random() * (W.w - 120 - size),
        y: 60 + Math.random() * (W.h - 120 - size),
        w: size, h: size
      };
      if (p && G.circleRect(p.x, p.y, 250, rect)) continue;
      if (conflictsObstacles(rect)) continue;
      state.obstacles.push(rect);
      made++;
    }
    return made;
  }

  /** 玩家移动后：在附近随机生成一个障碍物（失败返回 false） */
  function spawnObstacleNearPlayer() {
    const W = CFG.world;
    const C = CFG.obstacles;
    const p = state.player;
    if (!p || state.obstacles.length >= C.cap) return false;

    for (let tries = 0; tries < 12; tries++) {
      const size = C.sizeMin + Math.random() * (C.sizeMax - C.sizeMin);
      const a = Math.random() * Math.PI * 2;
      const d = C.minDist + Math.random() * (C.maxDist - C.minDist);
      const cx = p.x + Math.cos(a) * d;
      const cy = p.y + Math.sin(a) * d;
      const rect = {
        x: Math.max(60, Math.min(W.w - 60 - size, cx - size / 2)),
        y: Math.max(60, Math.min(W.h - 60 - size, cy - size / 2)),
        w: size, h: size
      };
      if (G.circleRect(p.x, p.y, C.minDist * 0.7, rect)) continue;
      if (state.foes.some(f => !f.dead && G.circleRect(f.x, f.y, f.r + 50, rect))) continue;
      if (conflictsObstacles(rect)) continue;
      state.obstacles.push(rect);
      return true;
    }
    return false;
  }

  /** 移除离玩家太远的障碍物 */
  function cullObstacles() {
    const p = state.player;
    if (!p) return;
    const C = CFG.obstacles;
    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      if (G.dist(p.x, p.y, cx, cy) > C.cullDist) state.obstacles.splice(i, 1);
    }
  }

  Object.assign(G, {
    state, saveBest, makeUnit, makePlayer,
    spawnObstaclesRandom, spawnObstacleNearPlayer, cullObstacles, rectsOverlap
  });
})(window.ABYSS = window.ABYSS || {});
