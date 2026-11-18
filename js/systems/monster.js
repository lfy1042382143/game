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
    const pool = SLOTS.map(s => s.key);
    for (let i = 0; i < count; i++) {
      const slotKey = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      // 稀有度基线按波次走，升档改为固定节拍（每 rarUpEvery 件升 1 档），不再掷骰
      const up = (wave + i) % C.rarUpEvery === 0 ? 1 : 0;
      const rar = clamp(Math.floor(wave * C.rarK) + up, 0, 4);
      u.items.push(randomItem(slotKey, rar));
    }
    refresh(u);
    u.hp = u.maxHp;
    u.shield = 0;
    return u;
  }

  function renderMonster() {
    const m = state.monster;
    el.foeName.textContent = m.name;
    el.foeAvatar.textContent = m.emoji;
    el.foeCrown.style.display = m.boss ? '' : 'none';
    el.foe.classList.toggle('boss', !!m.boss);
  }

  Object.assign(G, { makeMonster, renderMonster });
})(window.ABYSS = window.ABYSS || {});
