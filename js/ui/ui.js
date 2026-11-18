/* ============================================================
   UI 层 · ui.js
   DOM 引用、顶栏同步、装备行、结算弹窗
   ============================================================ */
(function (G) {
  'use strict';

  const { state, SLOTS, rarOf, itemDescText } = G;

  const el = {};

  function initDom() {
    [
      'canvas', 'waveNum', 'lvNum', 'xpFill', 'mapName', 'recordNum', 'soundBtn', 'restartBtn',
      'statHp', 'statAtk', 'statDef', 'eqRow', 'hintBar',
      'upgradeOverlay', 'upSub', 'lootBox', 'cards', 'curHp', 'curAtk', 'curDef', 'eqPanel',
      'eventOverlay', 'eventIcon', 'eventTitle', 'eventText', 'eventOpts',
      'overOverlay', 'overWave', 'overKiller', 'overHp', 'overAtk', 'overDef', 'overEq', 'overKills', 'overBest', 'againBtn'
    ].forEach(id => { el[id] = G.$(id); });

    G.el = el;
  }

  /* =========================================================
     顶栏同步（每次状态变化后调用，仅在数值变化时写 DOM）
     ========================================================= */
  let lastSnap = '';

  function syncTopbar() {
    const p = state.player;
    if (!p) return;
    const need = G.xpNeed(p.level);
    const snap = [
      state.wave, Math.round(p.hp), Math.round(p.maxHp),
      Math.round(p.atk), Math.round(p.def), p.items.length,
      p.level, Math.round(p.xp), state.mapIdx
    ].join('|');
    if (snap === lastSnap) return;
    lastSnap = snap;

    el.waveNum.textContent = String(state.wave).padStart(2, '0');
    el.lvNum.textContent = p.level;
    el.xpFill.style.width = Math.min(100, p.xp / need * 100) + '%';
    if (el.mapName) el.mapName.textContent = G.MAPS[state.mapIdx].name;
    el.statHp.textContent = Math.max(0, Math.round(p.hp)) + '/' + Math.round(p.maxHp);
    el.statAtk.textContent = Math.round(p.atk);
    el.statDef.textContent = Math.round(p.def);
    el.recordNum.textContent = state.best;

    // 装备行
    el.eqRow.innerHTML = '';
    SLOTS.forEach(slot => {
      const it = p.items.find(i => i.slot === slot.key);
      const cell = document.createElement('span');
      cell.className = 'eq-chip' + (it ? '' : ' empty');
      if (it) {
        const rar = rarOf(it.rarity);
        cell.style.setProperty('--c', rar.c);
        cell.title = it.name + ' Lv.' + it.level + '（' + rar.name + '）\n' + itemDescText(it);
        cell.innerHTML = '<i>' + it.icon + '</i><b>Lv.' + it.level + '</b>';
      } else {
        cell.title = slot.name + '空置';
        cell.innerHTML = '<i>' + slot.icon + '</i>';
      }
      el.eqRow.appendChild(cell);
    });
  }

  /* =========================================================
     结算弹窗
     ========================================================= */
  function showGameOver() {
    const p = state.player;
    el.overWave.textContent = state.wave;
    const killer = state.foes.find(f => !f.dead);
    el.overKiller.textContent = '被「' + (killer ? killer.name : '深渊') + '」击败';
    el.overHp.textContent = Math.round(p ? p.maxHp : 0);
    el.overAtk.textContent = Math.round(p ? p.atk : 0);
    el.overDef.textContent = Math.round(p ? p.def : 0);
    el.overEq.textContent = p ? p.items.length : 0;
    el.overKills.textContent = '击败 ' + state.kills + ' 个敌人';
    el.overBest.textContent = '最佳纪录：存活 ' + state.best + ' 分钟';
    el.overOverlay.classList.add('show');
  }

  Object.assign(G, { ui: { initDom, syncTopbar, showGameOver } });
})(window.ABYSS = window.ABYSS || {});
