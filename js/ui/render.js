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
    const p = state.player;
    const pPct = clamp(p.hp / p.maxHp, 0, 1) * 100;
    el.allyFill.style.width = pPct + '%';
    el.allyGhost.style.width = pPct + '%';
    el.allyBarTxt.textContent = fmt(p.hp) + ' / ' + fmt(p.maxHp);
    el.allyBar.classList.toggle('low', pPct < 30);

    const pShieldPct = clamp(p.shield / (p.maxHp * CFG.defend.capPct), 0, 1) * 100;
    el.allyShieldFill.style.width = pShieldPct + '%';
    el.allyShieldBar.classList.toggle('on', p.shield > 0);

    state.foes.forEach(foe => {
      const card = el.foeCard(foe);
      if (!card) return;
      const fill = card.querySelector('.fill');
      const ghost = card.querySelector('.bar-ghost');
      const txt = card.querySelector('.bar-txt');
      const bar = card.querySelector('.bar');
      const sBar = card.querySelector('.shield-bar');
      const sFill = card.querySelector('.shield-fill');
      const pct = clamp(foe.hp / foe.maxHp, 0, 1) * 100;
      fill.style.width = pct + '%';
      ghost.style.width = pct + '%';
      txt.textContent = fmt(foe.hp) + ' / ' + fmt(foe.maxHp);
      bar.classList.toggle('low', pct < 30);
      const sPct = clamp(foe.shield / (foe.maxHp * CFG.defend.capPct), 0, 1) * 100;
      sFill.style.width = sPct + '%';
      sBar.classList.toggle('on', foe.shield > 0);
      card.classList.toggle('dead', foe.hp <= 0);
      card.classList.toggle('target', foe.idx === state.target && foe.hp > 0);
    });
  }

  function renderStats(pop) {
    const p = state.player;
    el.allyAtk.textContent = fmt(p.atk);
    el.allyDef.textContent = fmt(p.def);
    if (pop) {
      el.allyAtk.parentElement.classList.remove('up');
      el.allyDef.parentElement.classList.remove('up');
      void el.allyAtk.offsetWidth;
      el.allyAtk.parentElement.classList.add('up');
      el.allyDef.parentElement.classList.add('up');
    }
    state.foes.forEach(foe => {
      const card = el.foeCard(foe);
      if (!card) return;
      card.querySelector('.stat.atk b').textContent = fmt(foe.atk);
      card.querySelector('.stat.def b').textContent = fmt(foe.def);
    });
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

  /** 生成/刷新敌人卡片 DOM（结构变化时重建，数值变化走 renderBars） */
  function renderFoes() {
    const box = el.foesBox;
    if (!box) return;

    box.setAttribute('data-count', String(state.foes.length));

    // 若敌人数量变化，重建所有卡片；否则复用现有 DOM
    const cards = box.querySelectorAll('.fighter.foe');
    const needRebuild = cards.length !== state.foes.length;

    if (needRebuild) {
      box.innerHTML = '';
      state.foes.forEach(foe => {
        const card = buildFoeCard(foe);
        box.appendChild(card);
        el.setFoeCard(foe, card);
      });
    } else {
      // 复用：更新名称、头像、皇冠、词缀（波次变化时可能变）
      state.foes.forEach((foe, i) => {
        const card = cards[i];
        el.setFoeCard(foe, card);
        card.querySelector('.name').textContent = foe.name;
        card.querySelector('.avatar').textContent = foe.emoji;
        card.querySelector('.crown').style.display = foe.boss ? '' : 'none';
        card.classList.toggle('boss', !!foe.boss);
        card.classList.toggle('elite', !!foe.elite && !foe.boss);
        const affixEl = card.querySelector('.affix-tag');
        if (affixEl) affixEl.remove();
        if (foe.affix) {
          const tag = document.createElement('span');
          tag.className = 'affix-tag';
          tag.title = foe.affix.name + ' · ' + foe.affix.desc;
          tag.textContent = foe.affix.icon + ' ' + foe.affix.name;
          card.querySelector('.name-row').appendChild(tag);
        }
        renderEquip(card.querySelector('.eq-row'), foe);
        renderStatus(card.querySelector('.status-row'), foe);
      });
    }
  }

  function buildFoeCard(foe) {
    const card = document.createElement('section');
    card.className = 'fighter foe';
    if (foe.boss) card.classList.add('boss');
    if (foe.elite && !foe.boss) card.classList.add('elite');

    card.innerHTML =
      '<div class="name-row">' +
        '<span class="crown" style="display:' + (foe.boss ? '' : 'none') + '">👑</span>' +
        '<span class="name">' + foe.name + '</span>' +
        (foe.affix
          ? '<span class="affix-tag" title="' + foe.affix.name + ' · ' + foe.affix.desc + '">' + foe.affix.icon + ' ' + foe.affix.name + '</span>'
          : '') +
        '<button class="info-btn" data-inspect="foe" title="查看敌方属性与装备详情">ⓘ</button>' +
      '</div>' +
      '<div class="avatar-wrap">' +
        '<div class="aura"></div>' +
        '<div class="avatar">' + foe.emoji + '</div>' +
      '</div>' +
      '<div class="bar">' +
        '<div class="bar-ghost"></div>' +
        '<div class="fill"></div>' +
        '<span class="bar-txt">' + fmt(foe.hp) + ' / ' + fmt(foe.maxHp) + '</span>' +
      '</div>' +
      '<div class="shield-bar"><div class="shield-fill"></div></div>' +
      '<div class="stats">' +
        '<span class="stat atk"><i>⚔</i><b>' + fmt(foe.atk) + '</b></span>' +
        '<span class="stat def"><i>🛡</i><b>' + fmt(foe.def) + '</b></span>' +
      '</div>' +
      '<div class="eq-row" data-inspect="foe" title="点击查看装备详情"></div>' +
      '<div class="status-row"></div>';

    renderEquip(card.querySelector('.eq-row'), foe);
    renderStatus(card.querySelector('.status-row'), foe);

    // 点击卡片选择目标
    card.addEventListener('click', (e) => {
      if (e.target.closest('.info-btn') || e.target.closest('[data-inspect]')) return;
      if (state.phase !== 'battle') return;
      if (foe.hp <= 0) return;
      state.target = foe.idx;
      renderBars();
      setTip('攻击 ' + foe.name);
    });

    return card;
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
    // 必须先渲染敌人卡片（建立 WeakMap 映射），renderBars 才能给选中目标加高亮
    if (state.foes.length) renderFoes();
    renderBars();
    renderStats(pop);
    renderButtons();
    if (state.player) renderEquip(el.allyEq, state.player);
    if (state.player) renderStatus(el.allyStatus, state.player);
  }

  function setTip(text, warn) {
    el.turnTip.textContent = text;
    el.turnTip.classList.toggle('warn', !!warn);
  }

  Object.assign(G, { buildTrack, renderTrack, renderWave, renderBars, renderStats, renderEquip, renderStatus, renderFoes, buildFoeCard, renderButtons, render, setTip });
})(window.ABYSS = window.ABYSS || {});
