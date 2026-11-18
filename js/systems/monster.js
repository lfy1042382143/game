/* ============================================================
   系统层 · monster.js
   按波次生成怪物属性、名称与随机装备
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG, SLOTS, MONSTER_POOL, BOSS_POOL, PREFIX, pick, clamp, makeUnit, randomItem, refresh, state, el } = G;

  /* =========================================================
     怪物
     ========================================================= */
  function makeMonster(wave) {
    const n = wave - 1;
    const C = CFG.mon;
    let maxHp = C.hp0 + C.hpK * n + C.hpQ * n * n;
    let atk = C.atk0 + C.atkK * n + C.atkQ * n * n;
    let def = C.def0 + C.defK * n;

    const isBoss = wave % 5 === 0;
    if (isBoss) {
      maxHp *= C.bossHp;
      atk *= C.bossAtk;
    }

    let name, emoji;
    if (isBoss) {
      const b = BOSS_POOL[(Math.floor(wave / 5) - 1) % BOSS_POOL.length];
      name = b.name;
      emoji = b.emoji;
    } else {
      const t = pick(MONSTER_POOL);
      name = pick(PREFIX) + pick(t.names);
      emoji = t.emoji;
    }

    const u = makeUnit({ hp: Math.round(maxHp), atk: Math.round(atk), def: Math.round(def) });
    u.isMon = true;
    u.boss = isBoss;
    u.name = name;
    u.emoji = emoji;

    // 随波次获得装备：第 1 波就有 1 件，之后每 eqEvery 波多一件
    const count = Math.min(C.eqMax, C.eqBase + Math.floor((wave - 1) / C.eqEvery));
    // 装备等级随波次提升，否则后期怪物的装备强度会被基础数值稀释成摆设
    const lv = clamp(1 + Math.floor((wave - 1) / C.eqLvEvery), 1, CFG.forge.maxLevel);
    const pool = SLOTS.map(s => s.key);
    for (let i = 0; i < count; i++) {
      const slotKey = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      // 稀有度基线按波次走，升档改为固定节拍（每 rarUpEvery 件升 1 档），不再掷骰
      const up = (wave + i) % C.rarUpEvery === 0 ? 1 : 0;
      const rar = clamp(Math.floor(wave * C.rarK) + up, 0, 4);
      u.items.push(randomItem(slotKey, rar, lv));
    }
    refresh(u);
    u.hp = u.maxHp;
    u.shield = 0;
    return u;
  }

  /** 生成一整队敌人（1~4 只）。多只时单只更脆、攻击更低，总血量略增 */
  function makeSquad(wave) {
    const S = CFG.squad;
    const count = Math.min(S.max, S.base + Math.floor((wave - 1) / S.every));
    const isBoss = wave % 5 === 0;

    const foes = [];
    for (let i = 0; i < count; i++) {
      // BOSS 波：i===0 是真首领（满倍率）；其余是随从（普通怪，非 BOSS 名）
      // 普通波：i===0 是精英（略强）；其余是普通小怪
      const isBossUnit = isBoss && i === 0;
      const isElite = !isBoss && i === 0 && count > 1;

      const u = makeMonster(wave);

      // 多敌人时的数值缩放：总血量/总攻击 ≈ 单怪，单只按数量均摊
      if (count > 1) {
        const hpMul = S.hpShare / count;
        const atkMul = S.atkShare / count;
        u.baseHp = Math.round(u.baseHp * hpMul);
        u.baseAtk = Math.round(u.baseAtk * atkMul);
      }

      // 精英比同波小怪更耐打（略强，用于"挑战精英"事件的回报感）
      if (isElite) {
        u.baseHp = Math.round(u.baseHp * S.eliteMul);
        u.elite = true;
      }

      // BOSS 波：只有 i===0 保留 BOSS 身份与倍率；随从去掉 BOSS 名与 boss 属性
      if (isBoss && i > 0) {
        u.boss = false;
        u.elite = false;
        const t = pick(MONSTER_POOL);
        u.name = pick(PREFIX) + pick(t.names);
        u.emoji = t.emoji;
        // 随从不享受 boss 生命/攻击倍率（makeMonster 已乘过，这里修正）
        u.baseHp = Math.round(u.baseHp / CFG.mon.bossHp);
        u.baseAtk = Math.round(u.baseAtk / CFG.mon.bossAtk);
      } else if (!isBoss && i > 0) {
        // 普通波小怪换名字
        const t = pick(MONSTER_POOL);
        u.name = pick(PREFIX) + pick(t.names);
        u.emoji = t.emoji;
      }

      u.idx = i;
      refresh(u);

      // 岔路事件：下波精英更强（生命 +30%）
      if (state.pendingElite && (u.elite || u.boss)) {
        u.baseHp = Math.round(u.baseHp * 1.3);
        refresh(u);
      }
      // 泉水事件：下波敌人攻击提升
      if (state.pendingRage) {
        u.baseAtk = Math.round(u.baseAtk * 1.25);
        refresh(u);
      }

      u.hp = u.maxHp;
      u.shield = 0;
      foes.push(u);
    }

    // 事件状态只影响一波，用后即清
    state.pendingElite = false;
    state.pendingRage = false;

    return foes;
  }

  function renderMonster() {
    // 敌人卡片的名称/头像由 renderFoes 统一维护（多敌人），
    // 这里仅保留兼容：无敌人时清空容器
    if (state.foes.length) return;
    if (el.foesBox) el.foesBox.innerHTML = '';
  }

  Object.assign(G, { makeMonster, makeSquad, renderMonster });
})(window.ABYSS = window.ABYSS || {});
