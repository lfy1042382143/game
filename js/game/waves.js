/* ============================================================
   游戏层 · waves.js
   波次编成：数量曲线、精英/BOSS、敌人装备、词缀确定性分配、出生点位
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, pick } = G;

  /** 平衡曲线 */
  function curveHp(wave) { return CFG.mon.hp0 + CFG.mon.hpK * (wave - 1) + CFG.mon.hpQ * (wave - 1) * (wave - 1); }
  function curveAtk(wave) { return CFG.mon.atk0 + CFG.mon.atkK * (wave - 1) + CFG.mon.atkQ * (wave - 1) * (wave - 1); }
  function curveDef(wave) { return CFG.mon.def0 + CFG.mon.defK * (wave - 1); }

  /** 本波敌人数量 */
  function waveCount(wave) {
    const S = CFG.squad;
    return Math.min(S.max, S.base + Math.floor((wave - 1) / S.every));
  }

  function isBossWave(wave) { return wave % CFG.mon.bossEvery === 0; }

  /** 波次是否普遍带词缀 */
  function affixDue(wave) {
    const A = CFG.affixes;
    return wave >= A.firstAt && (wave - A.firstAt) % A.every === 0;
  }

  function affixFor(wave, idx) {
    if (!affixDue(wave)) return null;
    const A = CFG.affixes;
    const slot = Math.floor((wave - A.firstAt) / A.every);
    return G.AFFIXES[(slot + idx) % G.AFFIXES.length];
  }

  /* =========================================================
     （装备已改为地图宝箱掉落，敌人不再携带装备）
     ========================================================= */

  /* =========================================================
     出生点位：玩家周围随机环带（随机出现，可预判性来自可见的刷新提示）
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
     编成本波敌人
     ========================================================= */
  function composeWave(wave) {
    const foes = [];
    const count = waveCount(wave);
    const boss = isBossWave(wave);
    const pool = pick(G.MONSTER_POOL);
    const boost = 1 + CFG.mon.mapBoost * state.mapIdx;   // 每张新地图敌人更强

    // 强度均摊：多敌人时总血量/总攻击 ≈ 单怪强度
    const share = count > 1 ? CFG.squad.hpShare : 1;
    const atkShare = count > 1 ? CFG.squad.atkShare : 1;

    for (let i = 0; i < count; i++) {
      const isBossUnit = boss && i === 0;
      const isElite = !boss && count > 1 && i === 0;

      let hp = curveHp(wave) * share / (boss ? (1 + (count - 1) * 0.4) : count);
      let atk = curveAtk(wave) * atkShare / (boss ? (1 + (count - 1) * 0.6) : count);

      if (isBossUnit) { hp *= CFG.mon.bossHp; atk *= CFG.mon.bossAtk; }
      if (isElite) hp *= CFG.squad.eliteMul;
      if (state.pendingElite) hp *= 1.5;
      if (state.pendingRage) atk *= 1.3;
      hp *= boost;
      atk *= boost;

      const type = isBossUnit ? 'boss' : (i % 2 === 1 && count >= 3 ? 'ranged' : 'melee');
      const cfgT = isBossUnit ? CFG.boss : CFG[type];
      const meta = isBossUnit ? pick(G.BOSS_POOL) : { name: pick(pool.names) + (isElite ? '·精英' : ''), emoji: pool.emoji };

      const pos = spawnNearPlayer();
      const u = G.makeUnit({
        hp: Math.round(hp),
        atk: Math.max(1, Math.round(atk)),
        def: Math.round(curveDef(wave)),
        r: cfgT.r,
        speed: cfgT.speed,
        type,
        isMon: true,
        name: meta.name,
        emoji: meta.emoji,
        x: pos.x, y: pos.y
      });

      // 击杀经验：近战为基准，远程 ×1.3，精英 ×1.5，BOSS ×4
      let xp = 6 + wave * 1.6;
      if (type === 'ranged') xp *= 1.3;
      if (isElite) xp *= 1.5;
      if (isBossUnit) xp *= 4;
      u.xp = Math.round(xp);

      u.elite = isElite;
      u.strafeDir = i % 2 === 0 ? 1 : -1;

      // 词缀：真 BOSS 不带（保持 BOSS 战基准强度），其余确定性轮换
      const affix = isBossUnit ? null : affixFor(wave, i);
      if (affix) {
        u.affix = affix;
        affix.apply(u);
      }

      G.refresh(u);

      // 开局护盾（守望类词条通用逻辑）
      u.shield = G.startShield(u);
      foes.push(u);
    }

    return foes;
  }

  Object.assign(G, { composeWave, waveCount, isBossWave, affixDue, curveHp, curveAtk });
})(window.ABYSS = window.ABYSS || {});
