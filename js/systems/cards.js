/* ============================================================
   系统层 · cards.js
   战后三选一：纯属性卡池（装备已改为击杀掉落，见 loot.js）
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG, SLOTS, RARITY, state, el, fmt, sleep, rarOf, itemAt, itemDescText, refresh, tone, sfxUpgrade } = G;

  /* =========================================================
     升级卡池
     ========================================================= */
  function rollRarity(wave) {
    const weights = RARITY.map(r => r.w(wave));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < RARITY.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return 0;
  }

  /** 三张卡固定为生命 / 攻击 / 防御各一张，稀有度独立随机 */
  function makeCards(wave) {
    const out = [];
    ['hp', 'atk', 'def'].forEach(attr => {
      const ri = rollRarity(wave);
      out.push({ t: 'attr', key: 'a:' + attr, attr, ri, val: CFG.attr[attr].vals[ri] });
    });
    return out;
  }

  const ATTR_ICON = {
    hp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    atk: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.9 14.55 8.2v6.75h-5.1V8.2L12 1.9z"/><path d="M6.9 15.55h10.2v2.15H6.9z"/><path d="M10.6 17.7h2.8v4.4h-2.8z"/></svg>',
    def: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.7 3.5 5v6.3c0 5.15 3.55 9.75 8.5 11.3 4.95-1.55 8.5-6.15 8.5-11.3V5L12 1.7z"/></svg>'
  };

  function renderCard(card) {
    const meta = CFG.attr[card.attr];
    const rar = rarOf(card.ri);
    const node = document.createElement('div');
    node.className = 'up-card' + (card.ri === 4 ? ' gold' : '');
    node.style.setProperty('--c', rar.c);
    node.innerHTML =
      '<div class="card-rar">' + rar.name + '</div>' +
      '<div class="card-icon">' + ATTR_ICON[card.attr] + '</div>' +
      '<div class="card-name">' + meta.label + '</div>' +
      '<div class="card-val">+' + card.val + '</div>' +
      '<div class="card-note">' + meta.note + '</div>';
    return node;
  }

  function renderEqPanel() {
    el.eqPanel.innerHTML = '';
    SLOTS.forEach(slot => {
      const it = itemAt(state.player, slot.key);
      const cell = document.createElement('div');
      cell.className = 'eq-cell' + (it ? '' : ' empty');
      if (it) {
        const rar = rarOf(it.rarity);
        cell.innerHTML =
          '<div class="eq-cell-ic">' + it.icon + '</div>' +
          '<div class="eq-cell-body">' +
            '<div class="eq-cell-name">' + it.name +
              '<span style="color:' + rar.c + '">Lv.' + it.level + '</span></div>' +
            '<div class="eq-cell-eff">' + itemDescText(it) + '</div>' +
          '</div>';
      } else {
        cell.innerHTML =
          '<div class="eq-cell-ic" style="opacity:.5">' + slot.icon + '</div>' +
          '<div class="eq-cell-body">' +
            '<div class="eq-cell-name" style="color:#6f6a85">' + slot.name + '空置</div>' +
            '<div class="eq-cell-eff">战利品可填补此位</div>' +
          '</div>';
      }
      el.eqPanel.appendChild(cell);
    });
  }

  function showUpgrade() {
    state.phase = 'upgrade';
    el.upSub.textContent = '第 ' + state.wave + ' 波已征服 · 提升一项属性';
    el.curHp.textContent = fmt(state.player.maxHp);
    el.curAtk.textContent = fmt(state.player.atk);
    el.curDef.textContent = fmt(state.player.def);

    const cards = makeCards(state.wave);
    el.cards.innerHTML = '';
    cards.forEach(card => {
      const node = renderCard(card);
      node.addEventListener('click', () => chooseUpgrade(card, node));
      el.cards.appendChild(node);
    });

    G.renderLoot();
    renderEqPanel();
    el.upOverlay.classList.add('show');
    sfxUpgrade();
  }

  async function chooseUpgrade(card, node) {
    if (state.phase !== 'upgrade') return;

    // 战利品尚未处理时，先要求做出决定
    if (state.loot && !state.lootDone) {
      const box = el.lootBox;
      if (box) {
        box.classList.remove('nudge');
        void box.offsetWidth;
        box.classList.add('nudge');
      }
      return;
    }

    state.phase = 'busy';

    Array.from(el.cards.children).forEach(c => {
      if (c === node) c.classList.add('picked');
      else c.classList.add('dim');
    });

    const p = state.player;

    if (card.attr === 'hp') {
      p.baseHp += card.val;
      p.hp += card.val;
    } else if (card.attr === 'atk') {
      p.baseAtk += card.val;
    } else {
      p.baseDef += card.val;
    }
    refresh(p);

    const justSlot = state.lootSlot;

    tone({ freq: 660, type: 'sine', dur: 0.18, vol: 0.1 });
    await sleep(520);

    el.upOverlay.classList.remove('show');
    await sleep(260);

    G.clearLoot();
    state.wave += 1;
    G.startWave(justSlot);
  }

  Object.assign(G, { rollRarity, makeCards, renderCard, renderEqPanel, showUpgrade, chooseUpgrade });
})(window.ABYSS = window.ABYSS || {});
