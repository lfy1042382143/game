/* ============================================================
   游戏层 · build.js（吸血鬼幸存者式构筑系统）
   - 武器：槽位数 = 武器池数量的 2/3（动态），每把固定 8 级路线（levels[lv-1] 为该级累计维度值）
   - 被动：槽位数 = 被动池数量的 2/3（动态），每个固定 5 级，提供全局增益
   - 进化：武器 Lv8 + 指定被动 Lv5 → 自动进化为超级武器
     （每局可进化多把：每把满级武器配满对应配方被动即各自进化）
   - 适配层：把构筑等级写入 p.sd（维度）/全局属性，战斗逻辑沿用原有实现
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG } = G;

  const WEAPON_MAX = 8;
  const PASSIVE_MAX = 5;

  /**
   * 槽位数随池子大小动态变化：池子数量的 2/3（四舍五入，至少 1，不超过池子数）。
   * 例：6 件 → 4 格；8 件 → 5 格；10 件 → 7 格。
   * 后续增删武器/被动时槽位自动跟随，无需手改常量。
   */
  function slotCount(poolSize) {
    return Math.max(1, Math.min(poolSize, Math.round(poolSize * 2 / 3)));
  }

  /* =========================================================
     武器 8 级成长表：每级给出该武器的维度值（累计值，非增量）
     Lv1 = 解锁基础；Lv8 = 满级。维度 key 对应 skills.js 的 dims
     ========================================================= */
  const WEAPON_LEVELS = {
    arrow: [
      { count: 0, rate: 0, bounce: 0, pierce: 0 },
      { count: 1, rate: 0, bounce: 0, pierce: 0 },
      { count: 1, rate: 1, bounce: 0, pierce: 0 },
      { count: 2, rate: 1, bounce: 0, pierce: 0 },
      { count: 2, rate: 2, bounce: 0, pierce: 0 },
      { count: 2, rate: 2, bounce: 0, pierce: 1 },
      { count: 3, rate: 2, bounce: 0, pierce: 1 },
      { count: 3, rate: 3, bounce: 1, pierce: 2 }
    ],
    chain: [
      { jumps: 0, dmg: 0, rate: 0, bolts: 0 },
      { jumps: 1, dmg: 0, rate: 0, bolts: 0 },
      { jumps: 1, dmg: 1, rate: 0, bolts: 0 },
      { jumps: 2, dmg: 1, rate: 0, bolts: 0 },
      { jumps: 2, dmg: 2, rate: 0, bolts: 0 },
      { jumps: 2, dmg: 2, rate: 1, bolts: 0 },
      { jumps: 3, dmg: 2, rate: 1, bolts: 0 },
      { jumps: 4, dmg: 4, rate: 2, bolts: 1 }
    ],
    shock: [
      { range: 0, dmg: 0, rate: 0, echo: 0 },
      { range: 1, dmg: 0, rate: 0, echo: 0 },
      { range: 1, dmg: 1, rate: 0, echo: 0 },
      { range: 2, dmg: 1, rate: 0, echo: 0 },
      { range: 2, dmg: 2, rate: 0, echo: 0 },
      { range: 2, dmg: 2, rate: 1, echo: 0 },
      { range: 3, dmg: 2, rate: 1, echo: 1 },
      { range: 4, dmg: 4, rate: 2, echo: 2 }
    ],
    orbit: [
      { count: 0, rate: 0, range: 0, dmg: 0 },
      { count: 1, rate: 0, range: 0, dmg: 0 },
      { count: 1, rate: 0, range: 1, dmg: 0 },
      { count: 2, rate: 0, range: 1, dmg: 1 },
      { count: 2, rate: 1, range: 1, dmg: 1 },
      { count: 2, rate: 1, range: 2, dmg: 2 },
      { count: 3, rate: 1, range: 2, dmg: 3 },
      { count: 4, rate: 2, range: 3, dmg: 4 }
    ],
    drone: [
      { count: 0, dmg: 0, life: 0 },
      { count: 1, dmg: 0, life: 0 },
      { count: 1, dmg: 1, life: 0 },
      { count: 2, dmg: 1, life: 0 },
      { count: 2, dmg: 2, life: 0 },
      { count: 2, dmg: 2, life: 1 },
      { count: 2, dmg: 3, life: 1 },
      { count: 3, dmg: 4, life: 2 }
    ],
    mine: [
      { dmg: 0, count: 0, rate: 0, range: 0 },
      { dmg: 0, count: 0, rate: 0, range: 1 },
      { dmg: 1, count: 0, rate: 0, range: 1 },
      { dmg: 1, count: 1, rate: 0, range: 1 },
      { dmg: 2, count: 1, rate: 0, range: 1 },
      { dmg: 2, count: 1, rate: 1, range: 1 },
      { dmg: 2, count: 2, rate: 1, range: 2 },
      { dmg: 3, count: 3, rate: 2, range: 3 }
    ],
    fireball: [
      { count: 0, radius: 0, dmg: 0, rate: 0 },
      { count: 1, radius: 0, dmg: 0, rate: 0 },
      { count: 1, radius: 1, dmg: 0, rate: 0 },
      { count: 1, radius: 1, dmg: 1, rate: 0 },
      { count: 2, radius: 1, dmg: 1, rate: 1 },
      { count: 2, radius: 2, dmg: 1, rate: 1 },
      { count: 2, radius: 2, dmg: 2, rate: 2 },
      { count: 3, radius: 3, dmg: 3, rate: 3 }
    ],
    boomerang: [
      { count: 0, rate: 0, dmg: 0, pierce: 0 },
      { count: 1, rate: 0, dmg: 0, pierce: 0 },
      { count: 1, rate: 0, dmg: 1, pierce: 0 },
      { count: 1, rate: 0, dmg: 1, pierce: 1 },
      { count: 1, rate: 1, dmg: 1, pierce: 1 },
      { count: 2, rate: 1, dmg: 2, pierce: 1 },
      { count: 2, rate: 2, dmg: 2, pierce: 2 },
      { count: 2, rate: 2, dmg: 3, pierce: 3 }
    ]
  };

  /* =========================================================
     被动道具：6 格，每个 5 级。apply 直接改基础属性 / 全局乘区
     ========================================================= */
  const PASSIVES = {
    might:     { name: '力量',   icon: '💪', desc: '每级攻击力 +8%',              apply: (p, lv) => { p.pasAtkMul = 1 + 0.08 * lv; } },
    armor:     { name: '护甲',   icon: '🛡', desc: '每级受到伤害 -4%',            apply: (p, lv) => { p.pasArmor = 0.04 * lv; } },
    vitality:  { name: '活力',   icon: '❤',  desc: '每级最大生命 +12',           apply: (p, lv) => { p.pasHp = 12 * lv; } },
    haste:     { name: '急速',   icon: '⏱️', desc: '每级全部攻击间隔 -5%',       apply: (p, lv) => { p.pasCdr = lv; } },
    area:      { name: '扩大',   icon: '🌐', desc: '每级攻击范围 +8%',           apply: (p, lv) => { p.pasArea = 1 + 0.08 * lv; } },
    duration:  { name: '持久',   icon: '⌛', desc: '每级持续时间 +10%',           apply: (p, lv) => { p.pasDuration = 1 + 0.10 * lv; } },
    crit:      { name: '暴击',   icon: '🎯', desc: '每级暴击率 +5%（满级 25%），暴击双倍伤害', apply: (p, lv) => { p.pasCrit = 0.05 * lv; } },
    movespeed: { name: '移速',   icon: '👟', desc: '每级移动速度 +8%（满级 +40%）', apply: (p, lv) => { p.pasMoveSpeed = 0.08 * lv; } }
  };
  const PASSIVE_IDS = Object.keys(PASSIVES);

  // 槽位数由各自池子大小决定（动态）
  const WEAPON_SLOTS = slotCount(Object.keys(WEAPON_LEVELS).length);
  const PASSIVE_SLOTS = slotCount(PASSIVE_IDS.length);

  /* =========================================================
     进化配方：武器 Lv8 + 指定被动 Lv5 → 自动进化
     （复用 skills.js ULT 的质变效果；p.evolved 记录所有已进化线，
      每局可同时拥有多把超级武器）
     ========================================================= */
  // 六把武器 ↔ 六个被动一一对应，避免配方重复导致被动与武器绑定关系混乱
  const EVOLVE_RECIPE = {
    arrow: 'might',      // 箭矢 → 力量（单体输出）
    chain: 'haste',      // 闪电 → 急速（高频弹射）
    shock: 'area',       // 震荡波 → 扩大（范围冲击）
    orbit: 'duration',   // 飞刃 → 持久（常驻环绕）
    drone: 'vitality',   // 浮游炮 → 活力（持续部署）
    mine: 'armor',       // 地雷 → 护甲（防御陷阱）
    fireball: 'crit',      // 火球 → 暴击（高伤单发）
    boomerang: 'movespeed' // 回旋镖 → 移速（走位风筝）
  };

  /** 某武器当前级（0=未持有） */
  function weaponLevel(p, k) { return (p.weapons && p.weapons[k]) || 0; }
  /** 某被动当前级（0=未持有） */
  function passiveLevel(p, id) { return (p.passives && p.passives[id]) || 0; }
  /** 持有武器数 */
  function weaponCount(p) { return Object.keys(p.weapons || {}).filter(k => p.weapons[k] > 0).length; }
  /** 持有被动数 */
  function passiveCount(p) { return Object.keys(p.passives || {}).filter(k => p.passives[k] > 0).length; }

  /** 该武器是否已进化为超级武器 */
  function isEvolved(p, k) { return !!(p && p.evolved && p.evolved[k]); }
  /** 已进化超级武器数量 */
  function evolvedCount(p) { return p && p.evolved ? Object.keys(p.evolved).filter(k => p.evolved[k]).length : 0; }

  /** 该武器是否满级 */
  function weaponMaxed(p, k) { return weaponLevel(p, k) >= WEAPON_MAX; }
  /** 该被动是否满级 */
  function passiveMaxed(p, id) { return passiveLevel(p, id) >= PASSIVE_MAX; }

  /**
   * 检查进化：每把「满级武器 + 配方被动满级」各自进化为超级武器（每局可多把）
   * 返回本次新进化的最后一把武器 key（无则 null）
   */
  function checkEvolution(p) {
    if (!p) return null;
    p.evolved = p.evolved || {};
    let evolvedAny = null;
    for (const k of Object.keys(EVOLVE_RECIPE)) {
      if (p.evolved[k]) continue;                 // 已进化不再重复
      if (!weaponMaxed(p, k)) continue;
      const need = EVOLVE_RECIPE[k];
      if (!passiveMaxed(p, need)) continue;
      p.evolved[k] = true;
      evolvedAny = k;
    }
    if (evolvedAny) rebuildFromBuild(p);
    return evolvedAny;
  }

  /** 升级武器（返回是否成功） */
  function upgradeWeapon(p, k) {
    if (!p.weapons) return false;
    const lv = weaponLevel(p, k);
    if (lv <= 0 || lv >= WEAPON_MAX) return false;
    p.weapons[k] = lv + 1;
    rebuildFromBuild(p);
    checkEvolution(p);
    return true;
  }

  /** 获取新武器（空格时） */
  function addWeapon(p, k) {
    if (!p.weapons || !WEAPON_LEVELS[k]) return false;
    if (weaponLevel(p, k) > 0 || weaponCount(p) >= WEAPON_SLOTS) return false;
    p.weapons[k] = 1;
    rebuildFromBuild(p);
    return true;
  }

  /** 升级或获取被动（空格时） */
  function upgradePassive(p, id) {
    if (!p.passives || !PASSIVES[id]) return false;
    const lv = passiveLevel(p, id);
    if (lv >= PASSIVE_MAX) return false;
    if (lv === 0 && passiveCount(p) >= PASSIVE_SLOTS) return false;
    p.passives[id] = lv + 1;
    rebuildFromBuild(p);
    checkEvolution(p);
    return true;
  }

  /**
   * 构建适配层：把 p.weapons / p.passives 写入旧字段 p.skills / p.sd / 全局属性，
   * 再调用 applySkillBuild 重算运行参数。战斗逻辑完全沿用旧实现。
   */
  function rebuildFromBuild(p) {
    if (!p) return;
    p.skills = p.skills || {};
    p.sd = p.sd || {};
    LINE_KEYS.forEach(k => {
      const lv = weaponLevel(p, k);
      p.skills[k] = lv > 0 ? 1 : 0;
      if (!p.sd[k]) p.sd[k] = {};
      const table = WEAPON_LEVELS[k];
      const dimVals = lv > 0 ? table[Math.min(lv, WEAPON_MAX) - 1] : {};
      (G.LINES[k].dims || []).forEach(d => { p.sd[k][d.key] = dimVals[d.key] || 0; });
    });
    // 被动 → 全局属性（先清旧值再重算，避免叠加）
    p.pasAtkMul = 1; p.pasArmor = 0; p.pasHp = 0; p.pasCdr = 0; p.pasArea = 1; p.pasDuration = 1;
    p.pasCrit = 0; p.pasMoveSpeed = 0;
    PASSIVE_IDS.forEach(id => {
      const lv = passiveLevel(p, id);
      if (lv > 0) PASSIVES[id].apply(p, lv);
    });
    // 被动的全局冷却层数并入 cdr（急速被动每层等同 1 层冷却卡）
    if (G.applySkillBuild) G.applySkillBuild(p);
    if (G.refresh) G.refresh(p);
  }

  const LINE_KEYS = G.LINE_KEYS || [];

  /** 初始化构筑：开局一件初始武器，无被动 */
  function initBuild(p, startLine) {
    p.weapons = {};
    p.passives = {};
    const start = (startLine && WEAPON_LEVELS[startLine]) ? startLine : 'arrow';
    p.weapons[start] = 1;
    p.startLine = start;
    p.evolved = {};
    // 技能运行态（原 initSkills 职责，此处承接以保证适配层可用）
    p.skills = {};
    p.sd = {};
    p.cdr = p.cdr || 0;
    p.evolved = {};
    p.orbitTriple = false;
    p.sk = {
      chain: { t: 0 },
      shock: { t: 0 },
      orbit: { t: 0.3, active: 0 },
      drone: { t: 0.5, active: 0, shootT: 0 },
      mine: { t: 0 },
      fireball: { t: 0.6 },
      boomerang: { t: 0.9, queue: 0, shootT: 0 }
    };
    p.orbits = 0;
    rebuildFromBuild(p);
    if (G.state && !G.state.mines) G.state.mines = [];
    if (G.state && !G.state.skillFx) G.state.skillFx = [];
    if (G.state && !G.state.fireballs) G.state.fireballs = [];
    if (G.state && !G.state.boomerangs) G.state.boomerangs = [];
  }

  Object.assign(G, {
    BUILD: {
      WEAPON_SLOTS, PASSIVE_SLOTS, WEAPON_MAX, PASSIVE_MAX,
      WEAPON_LEVELS, PASSIVES, PASSIVE_IDS, EVOLVE_RECIPE
    },
    initBuild, rebuildFromBuild, checkEvolution, slotCount,
    upgradeWeapon, addWeapon, upgradePassive,
    weaponLevel, passiveLevel, weaponCount, passiveCount, weaponMaxed, passiveMaxed,
    isEvolved, evolvedCount
  });
})(window.ABYSS = window.ABYSS || {});
