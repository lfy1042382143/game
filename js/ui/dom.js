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
    ally: $('ally'), foe: $('foe'),
    allyAvatar: $('allyAvatar'), foeAvatar: $('foeAvatar'),
    allyFill: $('allyFill'), allyGhost: $('allyGhost'), allyBarTxt: $('allyBarTxt'), allyBar: $('allyBar'),
    foeFill: $('foeFill'), foeGhost: $('foeGhost'), foeBarTxt: $('foeBarTxt'), foeBar: $('foeBar'),
    allyShieldBar: $('allyShieldBar'), allyShieldFill: $('allyShieldFill'),
    foeShieldBar: $('foeShieldBar'), foeShieldFill: $('foeShieldFill'),
    allyAtk: $('allyAtk'), allyDef: $('allyDef'),
    foeAtk: $('foeAtk'), foeDef: $('foeDef'),
    allyEq: $('allyEq'), foeEq: $('foeEq'),
    allyStatus: $('allyStatus'), foeStatus: $('foeStatus'),
    foeName: $('foeName'), foeCrown: $('foeCrown'),
    turnTip: $('turnTip'), impact: $('impact'),
    attackBtn: $('attackBtn'), defendBtn: $('defendBtn'), defendSub: $('defendSub'),
    upOverlay: $('upgradeOverlay'), cards: $('cards'), upSub: $('upSub'), lootBox: $('lootBox'),
    curHp: $('curHp'), curAtk: $('curAtk'), curDef: $('curDef'), eqPanel: $('eqPanel'),
    overOverlay: $('overOverlay'), overWave: $('overWave'),
    overHp: $('overHp'), overAtk: $('overAtk'), overDef: $('overDef'), overEq: $('overEq'),
    overKiller: $('overKiller'), overKills: $('overKills'), overBest: $('overBest'),
    banner: $('banner'),
    trackPips: $('trackPips'), trackLabel: $('trackLabel'),
    soundBtn: $('soundBtn'), restartBtn: $('restartBtn'), againBtn: $('againBtn')
  };

  Object.assign(G, { el });
})(window.ABYSS = window.ABYSS || {});
