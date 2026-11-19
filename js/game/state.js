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
    wave: 1,           // 分钟阶段 = floor(存活时间/60)+1（沿用字段名以兼容缩放公式）
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
    mageAoes: [],          // 法师 AoE 预警/爆发列表

    hazards: [],           // 地图陷阱实例（火球/骨刺：预警→爆发）
    zones: [],             // 持久陷阱区域（泥潭/引力裂隙）
    hazT: 0,               // 周期灾害生成计时

    loots: [],
    lootSlots: [],
    kills: 0,
    pendingLevelUps: 0,    // 待处理的升级选项数（每级一张三选一）

    chests: [],            // 精英掉落的宝箱（走近开启 → 装备战利品）
    sites: [],             // 事件地点（走近触发，一次性）
    siteT: 0,              // 地点刷新计时
    siteSeq: 0,            // 地点事件种类轮换序号
    activeSite: null,      // 正在交互的事件地点

    spawnT: 0,             // 普通敌人刷怪计时
    eliteT: 0,             // 精英怪计时（每分钟整点一只）

    pendingRage: false,    // 泉水事件副作用：下一只精英攻击 +30%

    // 陷阱（事件选择后概率触发）：影响陷阱期间刷新的敌人
    trapFoeHpMul: 1,       // 敌人生命倍率
    trapFoeAtkMul: 1,      // 敌人攻击倍率
    trapUntil: 0,          // 陷阱失效时间（state.time，秒）

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
    p.atkCdMul = 1;        // 攻速乘算系数（攻速提升卡）
    p.shots = 1;           // 每次射击的箭矢数（散射箭）
    p.shotDmgMul = 1;      // 多箭时的单箭伤害系数（散射箭：0.7）
    p.pierce = 0;          // 箭矢贯穿数（贯穿箭）
    p.orbits = 0;          // 环绕飞刃数量
    p.orbitDmgMul = 0.6;   // 环绕飞刃单次伤害系数（随卡数递减）
    p.luck = 0;            // 幸运值（幸运卡：提升升级选项高稀有度权重）
    p.xpMul = 1;           // 经验获取倍率（升级效率卡）
    p.rangeMul = 1;        // 射程乘算系数（射程提升卡）
    p.range = C.range;     // 当前射程（nearestFoe 与箭矢寿命都用它）
    p.critEvery = 0;       // 暴击节拍（0 = 无；每 N 发必暴）
    p.critMult = 1;        // 暴击倍率
    p.bulletSpeedMul = 1;  // 弹速乘算系数（弹速提升卡）
    p.cardLeech = 0;       // 吸血箭：箭矢伤害回血百分比
    p.cardSlow = 0;        // 减速箭：命中减速层数
    p.shieldEvery = 0;     // 护盾生成节拍（0 = 无；每 N 秒）
    p.shieldVal = 0;       // 护盾生成量
    p.shieldT = 0;         // 护盾生成计时
    p.SHIELD_CAP = 30;     // 生成护盾的上限
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

  /** 新障碍物按概率携带尖刺陷阱（外观与普通掩体完全一致，靠近才触发） */
  function maybeTrap(rect) {
    const C = CFG.obstacles;
    if (Math.random() < (C.trapChance || 0)) {
      rect.trap = { armed: true, trigT: 0 };
    }
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
      maybeTrap(rect);
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
      maybeTrap(rect);
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
    spawnObstaclesRandom, spawnObstacleNearPlayer, cullObstacles, rectsOverlap, maybeTrap
  });
})(window.ABYSS = window.ABYSS || {});
