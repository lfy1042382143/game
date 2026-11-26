/* ============================================================
   游戏层 · state.js（实时版 · 经验升级 + 大地图）
   全局状态与实体工厂
   phase: boot | play | busy | levelup | loot | event | over
   ============================================================ */
(function (G) {
  'use strict';

  const { recalc, CFG, pick, polyBounds } = G;

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

    mines: [],             // 感应地雷
    fireballs: [],         // 火球（武器线）
    boomerangs: [],        // 回旋镖（武器线）
    skillFx: [],           // 技能特效

    loots: [],
    lootSlots: [],
    kills: 0,
    pendingLevelUps: 0,    // 待处理的升级选项数（每级一张三选一）

    chests: [],            // 精英掉落的宝箱（走近开启 → 装备战利品）
    sites: [],             // 事件地点（走近触发，一次性）
    siteT: 0,              // 地点刷新计时
    lastEventKey: null,    // 上次刷出的事件（加权随机时避免立刻重复）
    activeSite: null,      // 正在交互的事件地点
    eventPick: false,      // 商人定向强化弹窗进行中

    spawnT: 0,             // 普通敌人刷怪计时
    eliteT: 0,             // 精英怪计时（每分钟整点一只）

    // 事件代价（明码标价）：期间刷新的敌人攻击倍率与失效时间
    eventFoeAtkMul: 1,
    eventFoeUntil: 0,

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
      shield: 0, bleed: null,
      strikes: 0,
      maxHp: 0, hp: 0, atk: 0, def: 0, agg: {}, isMon: !!base.isMon,
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
    recalc(u);
    return u;
  }

  function makePlayer(startLine) {
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
    p.orbitDmgMul = 1.1;   // 环绕飞刃单次伤害系数（applySkillBuild 会重算；不易命中故数值偏高）
    p.luck = 0;            // 幸运值（幸运卡：提升升级选项高稀有度权重）
    p.xpMul = 1;           // 经验获取倍率（升级效率卡）
    p.rangeMul = 1;        // 射程乘算系数（射程提升卡）
    p.range = C.range;     // 当前射程（nearestFoe 与箭矢寿命都用它）
    p.arrowRangeMul = 1;   // 箭矢专属射程乘数（终极·贯穿诸天 ×1.55），applySkillBuild 覆盖
    p.critEvery = 0;       // 暴击节拍（0 = 无；每 N 发必暴）
    p.critMult = 1;        // 暴击倍率
    p.bulletSpeedMul = 1;  // 弹速乘算系数（弹速提升卡）
    p.bounce = 0;          // 弹幕碰墙反弹次数（反弹箭卡）
    p.hasteT = 0;          // 回响头盔：受击后加速剩余时间
    p.hurtT = 0;           // 蓄能甲：脱战计时
    p.cardSlow = 0;        // 减速箭：命中减速层数
    // 构筑系统：武器8级+被动+进化（内部会初始化 p.skills/p.sd 并调用 applySkillBuild）
    if (G.initBuild) G.initBuild(p, startLine);
    else if (G.initSkills) G.initSkills(p, startLine);   // 兼容回退
    p.shieldEvery = 0;     // 护盾生成节拍（0 = 无；每 N 秒）
    p.shieldVal = 0;       // 护盾生成量
    p.shieldT = 0;         // 护盾生成计时
    p.SHIELD_CAP = 30;     // 生成护盾的上限
    return p;
  }

  /* =========================================================
     动态障碍物
     ========================================================= */
  /** 生成一枚不规则凸多边形（岩块）：形心 cx,cy，半径 r，顶点数 n */
  function makePoly(cx, cy, r, n) {
    const pts = [];
    const rot = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const rr = r * (0.72 + Math.random() * 0.42);
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
    const b = polyBounds(pts);
    return { x: cx, y: cy, pts, r, w: b.w, h: b.h };
  }

  /** 当前地图的障碍物类型列表；返回 null 表示该地图无障碍物（沼泽） */
  function currentObTypes() {
    const map = G.MAPS[state.mapIdx % G.MAPS.length];
    return map && map.obType ? map.obType : null;
  }

  /** 当前地图的障碍密度倍率（火山等地图更密），默认 1 */
  function obDensity() {
    const map = G.MAPS[state.mapIdx % G.MAPS.length];
    return (map && map.obDensity) || 1;
  }

  /**
   * 生成一条障碍脉：沿随机折线排布若干块。
   * 形状按地图主题变化：森林=树根/石头混合，白骨=骨堆，冰川=冰柱，火山=熔岩块。
   * 每块带 obType；冰柱额外带 hp（可击碎）。
   */
  function makeVein(cx, cy) {
    const C = CFG.obstacles;
    const types = currentObTypes();
    if (!types || !types.length) return [];   // 沼泽无障碍物
    const type = types[Math.floor(Math.random() * types.length)];
    const isRoot = type === 'root';
    const count = isRoot ? (2 + Math.floor(Math.random() * 2)) : (1 + Math.floor(Math.random() * 2));
    const baseR = C.sizeMin * 0.55 + Math.random() * (C.sizeMax - C.sizeMin) * 0.3;
    const dir = Math.random() * Math.PI * 2;
    const curve = (Math.random() - 0.5) * (isRoot ? 1.6 : 0.6);
    const veinId = 'v' + (state.veinSeq = (state.veinSeq || 0) + 1);
    const out = [];
    let x = cx, y = cy, a = dir;
    for (let i = 0; i < count; i++) {
      const r = baseR * (0.8 + Math.random() * 0.5);
      const n = type === 'ice' ? 6 : (type === 'root' ? 4 + Math.floor(Math.random() * 3) : 5 + Math.floor(Math.random() * 3));
      const poly = makePoly(x, y, r, n);
      poly.obType = type;
      poly.veinId = veinId;
      if (type === 'ice') poly.hp = C.iceHp;
      if (type === 'lava') poly.touchT = 0;
      if (type === 'bone') poly.spawnT = Math.random() * C.boneSpawnCd;
      out.push(poly);
      a += curve + (Math.random() - 0.5) * 0.5;
      const step = r * (isRoot ? 1.35 : 1.6);
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
    }
    return out;
  }

  /** 岩块是否与已有障碍/实体冲突（包围盒快速判断 + 距离） */
  function polyConflict(poly, minGap) {
    return state.obstacles.some(o => {
      const dx = poly.x - o.x, dy = poly.y - o.y;
      return dx * dx + dy * dy < (poly.r + (o.r || Math.max(o.w, o.h) / 2) + (minGap || 0)) ** 2;
    });
  }

  function rectsOverlap(a, b, gap) {
    gap = gap || 0;
    return a.x - gap < b.x + b.w && a.x + a.w + gap > b.x &&
           a.y - gap < b.y + b.h && a.y + a.h + gap > b.y;
  }

  function conflictsObstacles(rect) {
    return state.obstacles.some(o => rectsOverlap(rect, o, 40));
  }

  /**
   * 沿方向 a 到视口边缘的距离 + 岩块半径 + 余量。
   * 玩家恒定位于视口中心，故射线与视口矩形的交点即为屏幕边界；
   * 生成点取此距离之外，障碍物就不会在屏幕内凭空出现。
   */
  function screenOutsideDist(a) {
    const C = CFG.obstacles, V = CFG.viewport;
    const hx = V.w / 2, hy = V.h / 2;
    const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
    const tx = ca < 1e-6 ? Infinity : hx / ca;
    const ty = sa < 1e-6 ? Infinity : hy / sa;
    return Math.min(tx, ty) + (C.sizeMax || 88) + (C.screenMargin || 60);
  }

  /** 在玩家附近生成 n 条岩脉（无边界地图；生成点一律在视口之外） */
  function spawnObstaclesRandom(n) {
    const W = CFG.world;
    const p = state.player;
    const cx = p ? p.x : W.w / 2;
    const cy = p ? p.y : W.h / 2;
    const C = CFG.obstacles;
    let made = 0, tries = 0;
    if (!currentObTypes()) return 0;   // 沼泽等无障碍物地图
    while (made < n && tries++ < 240) {
      const a = Math.random() * Math.PI * 2;
      const dMin = screenOutsideDist(a);
      const d = dMin + Math.random() * Math.max(60, C.maxDist - dMin);
      const vx = Math.max(120, Math.min(W.w - 120, cx + Math.cos(a) * d));
      const vy = Math.max(120, Math.min(W.h - 120, cy + Math.sin(a) * d));
      // 世界边缘 clamp 把生成点拉回屏幕内则放弃本次
      if (G.dist(cx, cy, vx, vy) < dMin - 1) continue;
      const vein = makeVein(vx, vy);
      if (!vein.length) continue;
      if (polyConflict(vein[0], 40)) continue;
      vein.forEach(poly => state.obstacles.push(poly));
      made++;
    }
    return made;
  }

  /** 玩家移动后：在附近生成一条新岩脉（失败返回 false） */
  function spawnObstacleNearPlayer() {
    const W = CFG.world;
    const C = CFG.obstacles;
    const p = state.player;
    if (!p || state.obstacles.length >= C.cap * 4 * obDensity()) return false;
    if (!currentObTypes()) return false;   // 无障碍物地图

    for (let tries = 0; tries < 16; tries++) {
      const a = Math.random() * Math.PI * 2;
      const dMin = screenOutsideDist(a);
      const d = dMin + Math.random() * Math.max(60, C.maxDist - dMin);
      const vx = Math.max(120, Math.min(W.w - 120, p.x + Math.cos(a) * d));
      const vy = Math.max(120, Math.min(W.h - 120, p.y + Math.sin(a) * d));
      // 世界边缘 clamp 把生成点拉回屏幕内则放弃本次
      if (G.dist(p.x, p.y, vx, vy) < dMin - 1) continue;
      const vein = makeVein(vx, vy);
      if (!vein.length) continue;
      if (state.foes.some(f => !f.dead && G.circlePoly(f.x, f.y, f.r + 50, vein[0]))) continue;
      if (polyConflict(vein[0], 40)) continue;
      vein.forEach(poly => state.obstacles.push(poly));
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
    spawnObstaclesRandom, spawnObstacleNearPlayer, cullObstacles, rectsOverlap,
    makePoly, makeVein, polyConflict, screenOutsideDist, obDensity
  });
})(window.ABYSS = window.ABYSS || {});
