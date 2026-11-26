/* ============================================================
   游戏层 · waves.js（时间驱动版）
   敌人生成器：无波次，敌人按时间源源不断刷新，
   强度按「分钟阶段」缩放（minute = floor(存活时间/60)+1）。
   精英怪每分钟整点出现一只（每 bossEvery 分钟为 BOSS），
   击杀后原地掉落强化宝箱。
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, pick } = G;

  /** 平衡曲线（对标 VS：随时间连续增长，取消两分钟档内恒定的断崖）
      连续档位 tier = (m-1)/tierSpan，档首（奇数分钟）锚点与原阶梯完全一致，
      档内逐分钟几何插值——每分钟都在涨，而不是每两分钟突然翻倍。 */
  function curveTier(m) { return (m - 1) / CFG.mon.tier; }
  function curveHp(m) { return Math.round(CFG.mon.hp0 * Math.pow(CFG.mon.hpGrowth, curveTier(m))); }
  function curveAtk(m) { return Math.round(CFG.mon.atk0 * Math.pow(CFG.mon.atkGrowth, curveTier(m))); }
  function curveDef(m) { return CFG.mon.dr0 + curveTier(m) * CFG.mon.drStep; }   // 减伤率%（敌人专用）

  /** 当前难度阶段（对标 VS 四阶段节奏） */
  function spawnPhase(minute) {
    const P = CFG.spawn.phases;
    for (let i = 0; i < P.length; i++) if (minute <= P[i].until) return i;
    return P.length - 1;
  }

  /** 当前阶段的单次成群数量区间 [min,max] */
  function spawnBatch(minute) {
    return CFG.spawn.phases[spawnPhase(minute)].batch;
  }

  /** 当前刷怪间隔（随分钟缩短 × 阶段倍率；怪潮任务期间大幅加速） */
  function spawnInterval(minute) {
    const S = CFG.spawn;
    const rate = S.phases[spawnPhase(minute)].rateMul;
    return Math.max(S.intervalMin, (S.interval0 - (minute - 1) * S.intervalK) * rate * (state.spawnRateMul || 1));
  }

  /** 当前场上存活上限（随分钟增长 × 阶段倍率） */
  function aliveCap(minute) {
    const S = CFG.spawn;
    const capMul = S.phases[spawnPhase(minute)].capMul;
    let cap = Math.max(1, Math.min(S.capMax, Math.round((S.capBase + (minute - 1) * S.capK) * capMul)));
    // 移动端性能降级：低端机敌人上限软降（桌面不受影响）
    if (CFG.perf && CFG.perf.lowFx && CFG.perf.capMaxMobile) {
      cap = Math.min(cap, CFG.perf.capMaxMobile);
    }
    return cap;
  }

  function isBossMinute(m) { return m % CFG.elite.bossEvery === 0; }

  /** 普通敌人是否带词缀（按分钟） */
  function affixFor(m, idx) {
    const A = CFG.affixes;
    if (m < A.firstAt || (m - A.firstAt) % A.every !== 0) return null;
    const slot = Math.floor((m - A.firstAt) / A.every);
    return G.AFFIXES[(slot + idx) % G.AFFIXES.length];
  }

  /* =========================================================
     出生点位：玩家「视口之外」的随机环带（生成后向玩家移动）
     环带内半径 > 视口对角线的一半 → 出生点必定在屏幕外
     ========================================================= */
  function spawnNearPlayer(angleHint) {
    const W = CFG.world, V = CFG.viewport, S = CFG.spawn;
    const p = state.player;
    const pc = p || { x: W.w / 2, y: W.h / 2 };
    const minD = Math.hypot(V.w / 2, V.h / 2) + (S.offscreen || 90);
    const maxD = minD + (S.offscreenSpan || 300);

    for (let tries = 0; tries < 16; tries++) {
      // 有方向提示时在该方向的扇区内出生（同一波怪分散到四周），否则全向随机
      const a = (angleHint == null)
        ? Math.random() * Math.PI * 2
        : angleHint + (Math.random() - 0.5) * 0.7;
      const d = minD + Math.random() * (maxD - minD);
      const x = Math.max(60, Math.min(W.w - 60, pc.x + Math.cos(a) * d));
      const y = Math.max(60, Math.min(W.h - 60, pc.y + Math.sin(a) * d));
      const onObstacle = state.obstacles.some(o => G.circlePoly(x, y, 40, o));
      if (!onObstacle) return { x, y };
    }
    return { x: pc.x + minD, y: pc.y };
  }

  /* =========================================================
     事件代价倍率：高风险选项期间刷新的敌人攻击提升（明码标价，不再随机触发）
     ========================================================= */
  function eventAtkMul() {
    return state.time < (state.eventFoeUntil || 0) ? (state.eventFoeAtkMul || 1) : 1;
  }

  /* =========================================================
     生成一只普通敌人（minute = 当前分钟阶段）
     ========================================================= */
  /** 体型系数：击杀所需箭数（敌人血量 / 玩家攻击）越多体型越大，
      同时兼顾敌人血量成长与玩家攻击成长（r = 基础半径 × 系数） */
  function sizeScale(hp) {
    const S = CFG.size;
    const p = state.player;
    const shots = hp / Math.max(1, p ? p.atk : 10);
    return Math.max(S.min, Math.min(S.max, Math.pow(shots / S.refShots, S.k)));
  }

  function makeEnemy(minute, idx, forceType, angleHint) {
    const pool = pick(G.MONSTER_POOL);
    const boost = 1 + CFG.mon.mapBoost * state.mapIdx;   // 每张新地图敌人更强
    const riskAtk = eventAtkMul();

    // 类型分布（每 100 只）：近战 45% / 重甲 10% / 飞行近战 20% / 法师 10% / 远程 5%
    // 远程射手占 5%（idx%20===6，每 20 只 1 只，间隔均匀）；飞行轰炸者已删除
    // 近战档覆盖 idx 0/1/2/6/7/8（其中 idx%20===6 改刷远程）
    // （forceType 用于法师超上限时改刷其他类型）
    const roll = idx % 10;
    const type = forceType || (
      idx % 20 === 6 ? 'ranged' :
      roll < 3 ? 'melee' :
      roll < 4 ? 'brute' :
      roll < 6 ? 'flyer' :
      roll < 9 ? 'melee' :     // 原 ranged(idx6)/bomber(idx8) 档 → 近战
      'mage'
    );
    const cfgT = CFG[type];
    const pos = spawnNearPlayer(angleHint);

    let hp = curveHp(minute) * boost * (cfgT.hpMul || 1);
    let atk = curveAtk(minute) * boost * riskAtk * (cfgT.atkMul || 1);
    // 减伤率%（敌人 def 即减伤率，上限 60% 由 combat 裁剪）
    const dr = Math.round(curveDef(minute) * (cfgT.defMul || 1));

    const u = G.makeUnit({
      hp: Math.round(hp),
      atk: Math.max(1, Math.round(atk)),
      def: dr,
      r: Math.round(cfgT.r * sizeScale(hp) * 10) / 10,
      speed: cfgT.speed,
      type,
      isMon: true,
      name: pick(pool.names),
      emoji: pool.emoji,
      x: pos.x, y: pos.y
    });

    // 击杀经验：血量开方（怪物后期指数变强时经验不至于同步爆炸）+ 分钟加成
    // 法师 ×2 / 远程 ×1.3 / 重甲 ×1.3
    u.xp = Math.round((Math.sqrt(u.hp) * 1.6 + 1.2 * minute) * (
      type === 'ranged' || type === 'brute' ? 1.3 :
      type === 'mage' ? 2 : 1
    ));
    // 类型抗性/弱点（按攻击方式 tag 乘区，见 enemies.js ENEMY_RES）
    if (G.ENEMY_RES && G.ENEMY_RES[type]) u.res = G.ENEMY_RES[type];
    // 飞行单位：无视障碍物（从空中飞过），渲染带悬浮起伏
    if (type === 'flyer') {
      u.fly = true;
      u.bob = Math.random() * Math.PI * 2;
      u.diveState = 'approach';   // 骚扰状态机：逼近 → 攻击 → 脱离 → 再逼近
      u.emoji = '🦇';
    } else if (type === 'brute') {
      u.emoji = '🗿';
    }
    u.strafeDir = Math.random() < 0.5 ? 1 : -1;
    // 法师闪现：错开初始冷却，避免所有法师同时瞬移
    if (type === 'mage') {
      u.blinkT = CFG.mage.blinkCd * (0.4 + Math.random() * 0.6);
      u.blinkWarnT = 0;
      u.blinkTo = null;
    }

    const affix = affixFor(minute, idx);
    if (affix) {
      u.affix = affix;
      affix.apply(u);
    }

    G.refresh(u);
    u.shield = G.startShield(u);
    return u;
  }

  /* =========================================================
     生成精英怪 / BOSS（每分钟整点；BOSS 不带词缀）
     opts: { hpMul, atkMul } 事件附加倍率
     击杀后由 combat 调 dropEliteLoot 原地掉宝箱
     ========================================================= */
  function makeElite(minute, opts) {
    opts = opts || {};
    const boss = isBossMinute(minute);
    const boost = 1 + CFG.mon.mapBoost * state.mapIdx;
    const E = CFG.elite;
    const riskAtk = eventAtkMul();

    const type = boss ? 'boss' : (minute % 2 === 1 ? 'melee' : 'ranged');
    const cfgT = CFG[type];

    // 精英 ×2.0、BOSS ×8（BOSS 必须是持久战：高血量 + 狂暴阶段才有压迫感）
    const hpScale = boss ? (E.bossHpMul || 8) : E.hpMul;
    let hp = curveHp(minute) * hpScale * boost * (opts.hpMul || 1) * (cfgT.hpMul || 1);
    let atk = curveAtk(minute) * E.atkMul * boost * (opts.atkMul || 1) * riskAtk * (cfgT.atkMul || 1);

    const meta = boss ? pick(G.BOSS_POOL) : pick(G.MONSTER_POOL);
    const pos = spawnNearPlayer();

    // 精英/BOSS 减伤率：类型减伤 ×1.4，上限 60%（避免后期刮痧）
    const dr = Math.min(60, Math.round(curveDef(minute) * (cfgT.defMul || 1) * 1.4));

    const u = G.makeUnit({
      hp: Math.round(hp),
      atk: Math.max(1, Math.round(atk)),
      def: dr,
      r: Math.round(cfgT.r * sizeScale(hp) * 10) / 10,
      speed: cfgT.speed,
      type,
      isMon: true,
      name: boss ? meta.name : '精英 · ' + pick(meta.names),
      emoji: meta.emoji,
      x: pos.x, y: pos.y
    });

    // 击杀经验：精英 ×5，BOSS ×12（奖励与战斗耗时匹配）
    u.xp = Math.round((6 + minute * 1.6) * (boss ? E.bossXpMul : E.xpMul));
    u.elite = true;
    u.strafeDir = Math.random() < 0.5 ? 1 : -1;

    // 词缀：BOSS 不带（保持首领战基准强度），精英必带一个
    const affix = boss ? null : G.AFFIXES[minute % G.AFFIXES.length];
    if (affix) {
      u.affix = affix;
      affix.apply(u);
    }

    G.refresh(u);
    u.shield = G.startShield(u);
    return u;
  }

  Object.assign(G, { curveHp, curveAtk, curveDef, spawnPhase, spawnBatch, spawnInterval, aliveCap, isBossMinute, makeEnemy, makeElite, spawnNearPlayer, sizeScale });
})(window.ABYSS = window.ABYSS || {});
