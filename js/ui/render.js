/* ============================================================
   表现层 · render.js
   波次、血条、护盾、属性、装备栏、状态图标、按钮状态
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG, SLOTS, state, el, clamp, fmt, rarOf, itemAt, itemDescText, defendValue } = G;

  /* =========================================================
     渲染
     ========================================================= */
  function buildTrack() {
    el.trackPips.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('span');
      d.className = 'pip';
      el.trackPips.appendChild(d);
    }
    const b = document.createElement('span');
    b.className = 'pip boss-pip';
    el.trackPips.appendChild(b);
  }

  function renderTrack() {
    const w = state.wave;
    const inCycle = (w - 1) % 5;
    const pips = el.trackPips.children;
    for (let i = 0; i < 4; i++) pips[i].classList.toggle('on', i < inCycle);
    pips[4].classList.toggle('on', w % 5 === 0);

    const left = w % 5 === 0 ? 0 : 5 - (w % 5);
    if (left === 0) {
      el.trackLabel.textContent = 'BOSS 战';
      el.trackLabel.classList.add('warn');
    } else {
      el.trackLabel.textContent = '距 BOSS ' + left + ' 波';
      el.trackLabel.classList.remove('warn');
    }
  }

  function renderWave() {
    el.waveNum.textContent = String(state.wave).padStart(2, '0');
    el.waveNum.classList.remove('bump');
    void el.waveNum.offsetWidth;
    el.waveNum.classList.add('bump');
    renderTrack();
  }

  function renderBars() {
    const p = state.player, m = state.monster;
    const pPct = clamp(p.hp / p.maxHp, 0, 1) * 100;
    el.allyFill.style.width = pPct + '%';
    el.allyGhost.style.width = pPct + '%';
    el.allyBarTxt.textContent = fmt(p.hp) + ' / ' + fmt(p.maxHp);
    el.allyBar.classList.toggle('low', pPct < 30);

    const pShieldPct = clamp(p.shield / (p.maxHp * CFG.defend.capPct), 0, 1) * 100;
    el.allyShieldFill.style.width = pShieldPct + '%';
    el.allyShieldBar.classList.toggle('on', p.shield > 0);

    if (m) {
      const mPct = clamp(m.hp / m.maxHp, 0, 1) * 100;
      el.foeFill.style.width = mPct + '%';
      el.foeGhost.style.width = mPct + '%';
      el.foeBarTxt.textContent = fmt(m.hp) + ' / ' + fmt(m.maxHp);
      el.foeBar.classList.toggle('low', mPct < 30);
      const mShieldPct = clamp(m.shield / (m.maxHp * CFG.defend.capPct), 0, 1) * 100;
      el.foeShieldFill.style.width = mShieldPct + '%';
      el.foeShieldBar.classList.toggle('on', m.shield > 0);
    }
  }

  function renderStats(pop) {
    const p = state.player, m = state.monster;
    el.allyAtk.textContent = fmt(p.atk);
    el.allyDef.textContent = fmt(p.def);
    if (pop) {
      el.allyAtk.parentElement.classList.remove('up');
      el.allyDef.parentElement.classList.remove('up');
      void el.allyAtk.offsetWidth;
      el.allyAtk.parentElement.classList.add('up');
      el.allyDef.parentElement.classList.add('up');
    }
    if (m) {
      el.foeAtk.textContent = fmt(m.atk);
      el.foeDef.textContent = fmt(m.def);
    }
  }

  function renderEquip(host, unit, justSlot) {
    const just = Array.isArray(justSlot) ? justSlot : (justSlot ? [justSlot] : []);
    host.innerHTML = '';
    SLOTS.forEach(slot => {
      const it = itemAt(unit, slot.key);
      const d = document.createElement('div');
      d.className = 'eq-slot' + (it ? ' filled' : '') + (just.indexOf(slot.key) >= 0 ? ' just' : '');
      if (it) {
        d.style.setProperty('--c', it.c);
        d.title = it.name + ' Lv.' + it.level + ' · ' + rarOf(it.rarity).name + '\n' + itemDescText(it);
        d.innerHTML = '<span>' + it.icon + '</span><span class="eq-lv">' + it.level + '</span>';
      } else {
        d.title = slot.name + '（空）';
        d.innerHTML = '<span style="opacity:.5">' + slot.icon + '</span>';
      }
      host.appendChild(d);
    });
  }

  function renderStatus(host, unit) {
    host.innerHTML = '';
    if (unit.shield > 0) {
      const s = document.createElement('span');
      s.className = 'st-chip st-shield';
      s.textContent = '🛡 ' + unit.shield;
      s.title = '护盾：优先吸收伤害，回合结束衰减但不会低于开局护盾';
      host.appendChild(s);
    }
    if (unit.bleed) {
      const c = document.createElement('span');
      c.className = 'st-chip st-bleed';
      c.textContent = '🩸 ' + unit.bleed.dmg + '×' + unit.bleed.turns;
      c.title = '流血：每回合损失 ' + unit.bleed.dmg + ' 点生命，剩余 ' + unit.bleed.turns + ' 回合';
      host.appendChild(c);
    }
  }

  function renderButtons() {
    const fighting = state.phase === 'battle' && !state.paused;
    el.attackBtn.disabled = !fighting;
    el.defendBtn.disabled = !fighting;
    if (state.player) {
      el.defendSub.textContent = '护盾 +' + defendValue(state.player);
    }
  }

  function render(pop) {
    renderBars();
    renderStats(pop);
    renderButtons();
    if (state.player) renderEquip(el.allyEq, state.player);
    if (state.monster) {
      renderEquip(el.foeEq, state.monster);
      renderStatus(el.foeStatus, state.monster);
    }
    if (state.player) renderStatus(el.allyStatus, state.player);
  }

  function setTip(text, warn) {
    el.turnTip.textContent = text;
    el.turnTip.classList.toggle('warn', !!warn);
  }

  Object.assign(G, { buildTrack, renderTrack, renderWave, renderBars, renderStats, renderEquip, renderStatus, renderButtons, render, setTip });
})(window.ABYSS = window.ABYSS || {});
