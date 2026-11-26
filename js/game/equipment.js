/* ============================================================
   游戏层 · equipment.js（装备系统已移除 · 精简兼容层）
   - 装备实例、装备聚合属性(agg.*)、战利品均已删除
   - 仅保留三维重算：生命/攻击/防御来自基础值 + 构筑被动
   - 保留 recalc/refresh/startShield/rarOf 等空壳兼容旧调用，避免遗漏处崩溃
   ============================================================ */
(function (G) {
  'use strict';

  const { RARITY, clamp } = G;

  function rarOf(idx) { return RARITY[clamp(idx, 0, RARITY.length - 1)]; }

  /** 三维重算：只按基础值 + 构筑被动（力量/活力）；防御恒为基础值 */
  function recalc(u) {
    const oldMax = u.maxHp || 0;
    const atkMul = u.pasAtkMul || 1;
    const hpAdd = u.pasHp || 0;
    u.atk = Math.round(u.baseAtk * atkMul);
    u.def = u.baseDef;
    u.maxHp = u.baseHp + hpAdd;
    if (oldMax > 0) {
      if (u.maxHp > oldMax) u.hp += (u.maxHp - oldMax);
      u.hp = Math.min(u.hp, u.maxHp);
    } else {
      u.hp = u.maxHp;
    }
  }

  /** 构筑/属性卡变更后重算（agg 恒为空对象，保留字段兼容） */
  function refresh(u) {
    u.agg = u.agg || {};
    recalc(u);
  }

  /** 装备护盾已移除：恒返回 0 */
  function startShield(u) { return 0; }

  // 空壳兼容：残留调用不会再抛异常
  function aggregate() { return {}; }
  function buildItem() { return null; }
  function randomItem() { return null; }
  function cloneItem() { return null; }
  function upgradePath(it) { return { kind: 'max', item: it }; }
  function itemDesc() { return ''; }
  function itemDescText() { return ''; }
  function itemAt() { return null; }

  Object.assign(G, {
    rarOf, recalc, refresh, startShield,
    aggregate, buildItem, randomItem, cloneItem, upgradePath,
    itemDesc, itemDescText, itemAt
  });
})(window.ABYSS = window.ABYSS || {});
