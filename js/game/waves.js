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
     敌人装备
     ========================================================= */
  function equipFoe(u, wave, idx) {
    const M = CFG.mon;
    const n = Math.min(M.eqMax, M.eqBase + Math.floor((wave - 1) / M.eqEvery));
    const lv = Math.min(CFG.forge.maxLevel, 1 + Math.floor((wave - 1) / M.eqLvEvery));
    const baseRar = Math.floor(wave * M.rarK);

    for (let i = 0; i < n; i++) {
      // 槽位确定性轮换 + 每第 rarUpEvery 件稀有度 +1
      const slot = G.SLOTS[(idx + i) % G.SLOTS.length].key;
      const rar = Math.min(4, baseRar + ((i + idx) % M.rarUpEvery === M.rarUpEvery - 1 ? 1 : 0));
      const item = G.buildItem(slot, (idx * 2 + i) % G.ITEM_DEFS[slot].length, rar, lv);
      u.items.push(item);
    }
    G.refresh(u);
  }

  /* =========================================================
     出生点位：边缘均匀分布
     ========================================================= */
  function spawnPos(i, total) {
    const A = CFG.arena;
    const m = 60;
    // 沿左右两侧边缘交错分布
    const side = i % 2 === 0 ? 'left' : 'right';
    const t = total <= 1 ? 0.5 : i / (total - 1);
    const y = 100 + t * (A.h - 200);
    return { x: side === 'left' ? m : A.w - m, y };
  }

  /* =========================================================
     编成本波敌人
     ========================================================= */
  function composeWave(wave) {
    const foes = [];
    const count = waveCount(wave);
    const boss = isBossWave(wave);
    const pool = pick(G.MONSTER_POOL);

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

      const type = isBossUnit ? 'boss' : (i % 2 === 1 && count >= 3 ? 'ranged' : 'melee');
      const cfgT = isBossUnit ? CFG.boss : CFG[type];
      const meta = isBossUnit ? pick(G.BOSS_POOL) : { name: pick(pool.names) + (isElite ? '·精英' : ''), emoji: pool.emoji };

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
        ...spawnPos(i, count)
      });

      u.elite = isElite;
      u.strafeDir = i % 2 === 0 ? 1 : -1;

      // 词缀：真 BOSS 不带（保持 BOSS 战基准强度），其余确定性轮换
      const affix = isBossUnit ? null : affixFor(wave, i);
      if (affix) {
        u.affix = affix;
        affix.apply(u);
      }

      equipFoe(u, wave, i);
      G.refresh(u);

      // 开局护盾（守望类词条通用逻辑）
      u.shield = G.startShield(u);
      foes.push(u);
    }

    return foes;
  }

  Object.assign(G, { composeWave, waveCount, isBossWave, affixDue, curveHp, curveAtk });
})(window.ABYSS = window.ABYSS || {});
