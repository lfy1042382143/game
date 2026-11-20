/* ============================================================
   游戏层 · waves.js（时间驱动版）
   敌人生成器：无波次，敌人按时间源源不断刷新，
   强度按「分钟阶段」缩放（minute = floor(存活时间/60)+1）。
   精英怪每分钟整点出现一只（每 bossEvery 分钟为 BOSS），
   击杀后原地掉落装备宝箱。
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, pick } = G;

  /** 平衡曲线（两分钟一档：档内恒定，怪物血量/攻击跨档指数增长，跟上玩家后期成长） */
  function curveTier(m) { return Math.floor((m - 1) / CFG.mon.tier); }
  function curveHp(m) { return Math.round(CFG.mon.hp0 * Math.pow(CFG.mon.hpGrowth, curveTier(m))); }
  function curveAtk(m) { return Math.round(CFG.mon.atk0 * Math.pow(CFG.mon.atkGrowth, curveTier(m))); }
  function curveDef(m) { return CFG.mon.dr0 + curveTier(m) * CFG.mon.drStep; }   // 减伤率%（敌人专用）

  /** 当前刷怪间隔（随分钟缩短） */
  function spawnInterval(minute) {
    const S = CFG.spawn;
    return Math.max(S.intervalMin, S.interval0 - (minute - 1) * S.intervalK);
  }

  /** 当前场上存活上限（随分钟增长） */
  function aliveCap(minute) {
    const S = CFG.spawn;
    return Math.min(S.capMax, Math.round(S.capBase + (minute - 1) * S.capK));
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
  function spawnNearPlayer() {
    const W = CFG.world, V = CFG.viewport, S = CFG.spawn;
    const p = state.player;
    const pc = p || { x: W.w / 2, y: W.h / 2 };
    const minD = Math.hypot(V.w / 2, V.h / 2) + (S.offscreen || 90);
    const maxD = minD + (S.offscreenSpan || 300);

    for (let tries = 0; tries < 16; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = minD + Math.random() * (maxD - minD);
      const x = Math.max(60, Math.min(W.w - 60, pc.x + Math.cos(a) * d));
      const y = Math.max(60, Math.min(W.h - 60, pc.y + Math.sin(a) * d));
      const onObstacle = state.obstacles.some(o => G.circlePoly(x, y, 40, o));
      if (!onObstacle) return { x, y };
    }
    return { x: pc.x + minD, y: pc.y };
  }

  /* =========================================================
     陷阱倍率（事件陷阱期间刷新的敌人更强）
     ========================================================= */
  function trapMul() {
    if (state.time < state.trapUntil) {
      return { hp: state.trapFoeHpMul, atk: state.trapFoeAtkMul };
    }
    return { hp: 1, atk: 1 };
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

  function makeEnemy(minute, idx, forceType) {
    const pool = pick(G.MONSTER_POOL);
    const boost = 1 + CFG.mon.mapBoost * state.mapIdx;   // 每张新地图敌人更强
    const trap = trapMul();

    // 类型分布：近战 50% / 远程 30% / 法师 20%（forceType 用于法师超上限时改刷其他类型）
    const roll = idx % 10;
    const type = forceType || (roll < 5 ? 'melee' : roll < 8 ? 'ranged' : 'mage');
    const cfgT = CFG[type];
    const pos = spawnNearPlayer();

    let hp = curveHp(minute) * boost * trap.hp * (cfgT.hpMul || 1);
    let atk = curveAtk(minute) * boost * trap.atk * (cfgT.atkMul || 1);
    if (state.pendingRage && type === 'melee') atk *= 1.3;   // 泉水事件副作用
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

    // 击杀经验：血量开方（怪物后期指数变强时经验不至于同步爆炸）+ 分钟加成；法师 ×2
    u.xp = Math.round((Math.sqrt(u.hp) * 1.6 + 1.2 * minute) * (type === 'ranged' ? 1.3 : type === 'mage' ? 2 : 1));
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
    const trap = trapMul();

    const type = boss ? 'boss' : (minute % 2 === 1 ? 'melee' : 'ranged');
    const cfgT = CFG[type];

    // 精英 ×2.0、BOSS ×8（BOSS 必须是持久战：高血量 + 狂暴阶段才有压迫感）
    const hpScale = boss ? (E.bossHpMul || 8) : E.hpMul;
    let hp = curveHp(minute) * hpScale * boost * (opts.hpMul || 1) * trap.hp * (cfgT.hpMul || 1);
    let atk = curveAtk(minute) * E.atkMul * boost * (opts.atkMul || 1) * trap.atk * (cfgT.atkMul || 1);
    if (state.pendingRage) atk *= 1.3;

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

  Object.assign(G, { curveHp, curveAtk, curveDef, spawnInterval, aliveCap, isBossMinute, makeEnemy, makeElite, spawnNearPlayer, sizeScale });
})(window.ABYSS = window.ABYSS || {});
