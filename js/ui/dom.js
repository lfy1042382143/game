/* ============================================================
   表现层 · dom.js
   集中缓存 DOM 节点引用，避免散落查询
   ============================================================ */
(function (G) {
  'use strict';

  const { $ } = G;

  /* =========================================================
     DOM
     ========================================================= */
  const el = {
    waveNum: $('waveNum'), recordNum: $('recordNum'),
    ally: $('ally'), foesBox: $('foes'),
    allyAvatar: $('allyAvatar'),
    allyFill: $('allyFill'), allyGhost: $('allyGhost'), allyBarTxt: $('allyBarTxt'), allyBar: $('allyBar'),
    allyShieldBar: $('allyShieldBar'), allyShieldFill: $('allyShieldFill'),
    allyAtk: $('allyAtk'), allyDef: $('allyDef'),
    allyEq: $('allyEq'),
    allyStatus: $('allyStatus'),
    turnTip: $('turnTip'), impact: $('impact'),
    attackBtn: $('attackBtn'), defendBtn: $('defendBtn'), defendSub: $('defendSub'),
    upOverlay: $('upgradeOverlay'), cards: $('cards'), upSub: $('upSub'), lootBox: $('lootBox'),
    curHp: $('curHp'), curAtk: $('curAtk'), curDef: $('curDef'), eqPanel: $('eqPanel'),
    overOverlay: $('overOverlay'), overWave: $('overWave'),
    overHp: $('overHp'), overAtk: $('overAtk'), overDef: $('overDef'), overEq: $('overEq'),
    overKiller: $('overKiller'), overKills: $('overKills'), overBest: $('overBest'),
    banner: $('banner'),
    trackPips: $('trackPips'), trackLabel: $('trackLabel'),
    soundBtn: $('soundBtn'), restartBtn: $('restartBtn'), againBtn: $('againBtn'),
    eventOverlay: $('eventOverlay'), eventBox: $('eventOverlay'),
    eventIcon: $('eventIcon'), eventTitle: $('eventTitle'), eventText: $('eventText'), eventOpts: $('eventOpts')
  };

  // 敌人卡片索引：单位对象 → 其 DOM 卡片（WeakMap 避免泄漏）
  const foeCards = new WeakMap();
  el.foeCard = (u) => foeCards.get(u) || null;
  el.setFoeCard = (u, node) => { if (u && node) foeCards.set(u, node); };

  Object.assign(G, { el });
})(window.ABYSS = window.ABYSS || {});
