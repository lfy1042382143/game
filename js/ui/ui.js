/* ============================================================
   UI 层 · ui.js
   DOM 引用、顶栏同步、装备行、结算弹窗
   ============================================================ */
(function (G) {
  'use strict';

  const { state, SLOTS, rarOf, itemDescText, CFG } = G;

  const el = {};

  function initDom() {
    [
      'canvas', 'waveNum', 'lvNum', 'xpFill', 'mapName', 'recordNum', 'soundBtn', 'restartBtn',
      'statHp', 'statAtk', 'statDef', 'eqRow', 'hintBar', 'eqSide',
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

    syncEqPanel();
  }

  /* =========================================================
     实时装备/属性侧边栏（装备、三维、攻击方式能力变化时重建）
     ========================================================= */
  let lastEqSig = '';

  function syncEqPanel() {
    const p = state.player;
    const box = el.eqSide;
    if (!box || !p) return;

    // 变化签名：装备 + 三维 + 卡片能力（命中即重建，否则跳过写 DOM）
    const sig = [
      p.items.map(i => i.slot + ':' + i.key + ':' + i.rarity + ':' + i.level).join(','),
      Math.round(p.maxHp), Math.round(p.atk), Math.round(p.def),
      p.shots, p.orbits, p.pierce, p.cardLeech, p.cardSlow,
      p.critEvery, p.atkCdMul.toFixed(2), Math.round(p.range)
    ].join('|');
    if (sig === lastEqSig) return;
    lastEqSig = sig;

    const A = p.agg || { crit: 0, critMult: 1.6, leech: 0, thorn: 0, bulwark: 0, pierce: 0, swiftstep: 0, vamp: 0, dotres: 0, bleed: null, guard: 0 };

    // 三维（含装备加成来源）
    let html =
      '<div class="eq-side-head">⚔ 装备 · 属性<small>LV.' + p.level + '</small></div>' +
      '<div class="eq-side-stats">' +
        '<span class="eq-stat hp"><i>❤</i><b>' + Math.round(p.maxHp) + '</b><small>(基础' + Math.round(p.baseHp) + ')</small></span>' +
        '<span class="eq-stat atk"><i>⚔</i><b>' + Math.round(p.atk) + '</b><small>(基础' + Math.round(p.baseAtk) + ')</small></span>' +
        '<span class="eq-stat def"><i>🛡</i><b>' + Math.round(p.def) + '</b><small>(基础' + Math.round(p.baseDef) + ')</small></span>' +
        '<span class="eq-stat"><i>📡</i><b>' + Math.round(p.range) + '</b><small>射程</small></span>';
    // 装备词条
    const extras = [];
    if (A.leech) extras.push(['🩸', '吸血', A.leech + '%']);
    if (A.vamp) extras.push(['🩹', '受击回复', A.vamp + '%']);
    if (A.thorn) extras.push(['🌵', '反伤', A.thorn]);
    if (A.bulwark) extras.push(['🐉', '减伤', A.bulwark + '%']);
    if (A.pierce) extras.push(['🔮', '破甲', A.pierce + '%']);
    if (A.swiftstep) extras.push(['👟', '移速', '+' + A.swiftstep + '%']);
    if (A.dotres) extras.push(['🧿', '抗流血', A.dotres + '%']);
    if (A.guard) extras.push(['🛡️', '开局盾', A.guard]);
    if (A.crit) extras.push(['💥', '暴击', '每' + A.crit + '发×' + A.critMult.toFixed(1)]);
    if (A.bleed) extras.push(['🗡️', '流血', A.bleed.dmg + '×' + A.bleed.turns + 's']);
    // 卡片能力
    if (p.atkCdMul < 1) extras.push(['⚡', '攻速', CFG.player.atkCd * p.atkCdMul < 0.2 ? 'MAX' : (CFG.player.atkCd * p.atkCdMul).toFixed(2) + 's/发']);
    if (p.shots > 1) extras.push(['🏹', '散射', '×' + p.shots]);
    if (p.pierce) extras.push(['🎯', '贯穿', p.pierce]);
    if (p.orbits) extras.push(['🌀', '飞刃', p.orbits]);
    if (p.critEvery) extras.push(['💥', '节拍暴击', '每' + p.critEvery + '发×' + p.critMult.toFixed(1)]);
    if (p.cardLeech) extras.push(['🩸', '吸血箭', p.cardLeech + '%']);
    if (p.cardSlow) extras.push(['🕸️', '减速箭', '−' + Math.round(p.cardSlow * 18) + '%']);
    if (p.shieldEvery) extras.push(['🔵', '护盾', p.shieldVal + '/' + p.shieldEvery + 's']);
    extras.slice(0, 8).forEach(e => {
      html += '<span class="eq-stat"><i>' + e[0] + '</i><small>' + e[1] + '</small><b>' + e[2] + '</b></span>';
    });
    html += '</div>';

    // 四个槽位
    SLOTS.forEach(slot => {
      const it = p.items.find(i => i.slot === slot.key);
      if (it) {
        const rar = rarOf(it.rarity);
        html +=
          '<div class="eq-slot" style="--c:' + rar.c + '">' +
            '<div class="ic">' + it.icon + '</div>' +
            '<div><div class="nm">' + it.name +
              '<span>Lv.' + it.level + ' · ' + rar.name + '</span></div>' +
            '<div class="fx">' + itemDescText(it) + '</div></div>' +
          '</div>';
      } else {
        html +=
          '<div class="eq-slot empty" style="--c:#6f6a85">' +
            '<div class="ic">' + slot.icon + '</div>' +
            '<div><div class="nm">' + slot.name + '空置</div>' +
            '<div class="fx">宝箱战利品可填补</div></div>' +
          '</div>';
      }
    });

    box.innerHTML = html;
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
