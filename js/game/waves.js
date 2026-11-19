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

  /** 平衡曲线（参数为分钟阶段） */
  function curveHp(m) { return CFG.mon.hp0 + CFG.mon.hpK * (m - 1) + CFG.mon.hpQ * (m - 1) * (m - 1); }
  function curveAtk(m) { return CFG.mon.atk0 + CFG.mon.atkK * (m - 1) + CFG.mon.atkQ * (m - 1) * (m - 1); }
  function curveDef(m) { return CFG.mon.def0 + CFG.mon.defK * (m - 1); }

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
     出生点位：玩家周围随机环带（随机出现）
     ========================================================= */
  function spawnNearPlayer() {
    const W = CFG.world;
    const p = state.player;
    const pc = p || { x: W.w / 2, y: W.h / 2 };
    const minD = 380, maxD = 680;

    for (let tries = 0; tries < 16; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = minD + Math.random() * (maxD - minD);
      const x = Math.max(40, Math.min(W.w - 40, pc.x + Math.cos(a) * d));
      const y = Math.max(40, Math.min(W.h - 40, pc.y + Math.sin(a) * d));
      const onObstacle = state.obstacles.some(o => G.circleRect(x, y, 40, o));
      if (!onObstacle) return { x, y };
    }
    return { x: W.w / 2, y: 80 };
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
  /** 体型系数：血量越高体型越大（r = 基础半径 × 系数） */
  function sizeScale(hp) {
    const S = CFG.size;
    return Math.max(S.min, Math.min(S.max, Math.pow(hp / S.refHp, S.k)));
  }

  function makeEnemy(minute, idx) {
    const pool = pick(G.MONSTER_POOL);
    const boost = 1 + CFG.mon.mapBoost * state.mapIdx;   // 每张新地图敌人更强
    const trap = trapMul();

    // 类型分布：近战 50% / 远程 30% / 法师 20%
    const roll = idx % 10;
    const type = roll < 5 ? 'melee' : roll < 8 ? 'ranged' : 'mage';
    const cfgT = CFG[type];
    const pos = spawnNearPlayer();

    let hp = curveHp(minute) * boost * trap.hp;
    let atk = curveAtk(minute) * boost * trap.atk * (cfgT.atkMul || 1);
    if (state.pendingRage && type === 'melee') atk *= 1.3;   // 泉水事件副作用
    const def = Math.round(curveDef(minute) * (cfgT.defMul || 1));

    const u = G.makeUnit({
      hp: Math.round(hp),
      atk: Math.max(1, Math.round(atk)),
      def,
      r: Math.round(cfgT.r * sizeScale(hp) * 10) / 10,
      speed: cfgT.speed,
      type,
      isMon: true,
      name: pick(pool.names),
      emoji: pool.emoji,
      x: pos.x, y: pos.y
    });

    // 击杀经验：近战为基准，远程 ×1.3，法师 ×1.6
    u.xp = Math.round((6 + minute * 1.6) * (type === 'ranged' ? 1.3 : type === 'mage' ? 1.6 : 1));
    u.strafeDir = Math.random() < 0.5 ? 1 : -1;

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

    let hp = curveHp(minute) * E.hpMul * boost * (opts.hpMul || 1) * trap.hp;
    let atk = curveAtk(minute) * E.atkMul * boost * (opts.atkMul || 1) * trap.atk;
    if (state.pendingRage) atk *= 1.3;
    if (boss) { hp *= 1.2; }

    const meta = boss ? pick(G.BOSS_POOL) : pick(G.MONSTER_POOL);
    const pos = spawnNearPlayer();

    const u = G.makeUnit({
      hp: Math.round(hp),
      atk: Math.max(1, Math.round(atk)),
      def: Math.round(curveDef(minute) * 1.4),
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

  Object.assign(G, { curveHp, curveAtk, spawnInterval, aliveCap, isBossMinute, makeEnemy, makeElite, spawnNearPlayer, sizeScale });
})(window.ABYSS = window.ABYSS || {});
