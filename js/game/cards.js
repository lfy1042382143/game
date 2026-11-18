/* ============================================================
   游戏层 · cards.js
   战后三选一：纯属性卡池（装备由击杀掉落，见 loot.js）
   选卡期间游戏暂停（phase !== 'play'）
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, RARITY, SLOTS, rarOf, itemAt, itemDescText } = G;

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
      out.push({ t: 'attr', key: 'a:' + attr, attr, ri, val: CFG.attr ? CFG.attr[attr].vals[ri] : [19, 36, 59, 90, 138][ri] });
    });
    return out;
  }

  const ATTR_META = {
    hp:  { label: '生命', icon: '❤', vals: [19, 36, 59, 90, 138], note: '提升生命上限，并立即恢复等量生命' },
    atk: { label: '攻击', icon: '⚔', vals: [6, 9, 13, 20, 29],    note: '每次射击造成更高伤害' },
    def: { label: '防御', icon: '🛡', vals: [2, 3, 4, 6, 9],      note: '减免受到的伤害' }
  };

  function renderCard(card) {
    const meta = ATTR_META[card.attr];
    const rar = rarOf(card.ri);
    const node = document.createElement('div');
    node.className = 'up-card' + (card.ri === 4 ? ' gold' : '');
    node.style.setProperty('--c', rar.c);
    node.innerHTML =
      '<div class="card-rar">' + rar.name + '</div>' +
      '<div class="card-icon">' + meta.icon + '</div>' +
      '<div class="card-name">' + meta.label + '</div>' +
      '<div class="card-val">+' + card.val + '</div>' +
      '<div class="card-note">' + meta.note + '</div>';
    return node;
  }

  function renderEqPanel() {
    const panel = G.el.eqPanel;
    panel.innerHTML = '';
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
      panel.appendChild(cell);
    });
  }

  function showUpgrade() {
    state.phase = 'upgrade';
    G.el.upSub.textContent = '第 ' + state.wave + ' 波已征服 · 提升一项属性';
    G.el.curHp.textContent = G.fmt(state.player.maxHp);
    G.el.curAtk.textContent = G.fmt(state.player.atk);
    G.el.curDef.textContent = G.fmt(state.player.def);

    const cards = makeCards(state.wave);
    G.el.cards.innerHTML = '';
    cards.forEach(card => {
      const node = renderCard(card);
      node.addEventListener('click', () => chooseUpgrade(card, node));
      G.el.cards.appendChild(node);
    });

    G.renderLoot();
    renderEqPanel();
    G.el.upgradeOverlay.classList.add('show');
    G.sfxUpgrade();
  }

  function chooseUpgrade(card, node) {
    if (state.phase !== 'upgrade') return;

    // 战利品尚未处理完时，先要求做出决定
    if (G.lootPending() > 0) {
      const box = G.el.lootBox;
      if (box) {
        box.classList.remove('nudge');
        void box.offsetWidth;
        box.classList.add('nudge');
      }
      return;
    }

    state.phase = 'busy';

    Array.from(G.el.cards.children).forEach(c => {
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
    G.refresh(p);

    G.tone({ freq: 660, type: 'sine', dur: 0.18, vol: 0.1 });

    G.el.upgradeOverlay.classList.remove('show');
    G.clearLoot();
    G.advanceWave();
  }

  Object.assign(G, { rollRarity, makeCards, renderCard, renderEqPanel, showUpgrade, chooseUpgrade });
})(window.ABYSS = window.ABYSS || {});
