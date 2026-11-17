/* ============================================================
   系统层 · cards.js
   三选一卡池：属性 / 新装备 / 强化 / 升华
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG, SLOTS, ITEM_DEFS, RARITY, state, el, fmt, pick, sleep, rarOf, buildItem, itemAt, itemDesc, itemDescText, refresh, tone, sfxUpgrade } = G;

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

  function makeCards(wave) {
    const p = state.player;
    const pool = [];

    ['hp', 'atk', 'def'].forEach(attr => {
      const ri = rollRarity(wave);
      pool.push({ t: 'attr', key: 'a:' + attr, attr, ri, val: CFG.attr[attr].vals[ri], w: 12 });
    });

    SLOTS.forEach(slot => {
      const it = itemAt(p, slot.key);
      if (!it) {
        const ri = rollRarity(wave);
        const defIdx = Math.floor(Math.random() * ITEM_DEFS[slot.key].length);
        pool.push({ t: 'equip', key: 's:' + slot.key, slot: slot.key, defIdx, ri, w: 11 });
      } else if (it.level < CFG.forge.maxLevel) {
        pool.push({ t: 'forge', key: 's:' + slot.key, slot: slot.key, item: it, w: 10 });
      } else if (it.rarity < 4) {
        pool.push({ t: 'ascend', key: 's:' + slot.key, slot: slot.key, item: it, w: 7 });
      }
    });

    // 加权抽 3 张（同槽位不重复）
    const out = [];
    let left = pool.slice();
    while (out.length < 3 && left.length) {
      const total = left.reduce((a, b) => a + b.w, 0);
      let r = Math.random() * total;
      let idx = 0;
      for (let i = 0; i < left.length; i++) {
        r -= left[i].w;
        if (r <= 0) { idx = i; break; }
      }
      const card = left[idx];
      out.push(card);
      left = left.filter(c => c.key !== card.key);
    }

    // 保证至少一张属性卡
    if (out.length && !out.some(c => c.t === 'attr')) {
      const attr = pick(['hp', 'atk', 'def']);
      const ri = rollRarity(wave);
      out[Math.floor(Math.random() * out.length)] = {
        t: 'attr', key: 'a:' + attr, attr, ri, val: CFG.attr[attr].vals[ri]
      };
    }
    return out;
  }

  const ATTR_ICON = {
    hp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    atk: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.9 14.55 8.2v6.75h-5.1V8.2L12 1.9z"/><path d="M6.9 15.55h10.2v2.15H6.9z"/><path d="M10.6 17.7h2.8v4.4h-2.8z"/></svg>',
    def: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.7 3.5 5v6.3c0 5.15 3.55 9.75 8.5 11.3 4.95-1.55 8.5-6.15 8.5-11.3V5L12 1.7z"/></svg>'
  };

  function cardRarityClass(ri) {
    return ri === 4 ? ' gold' : '';
  }

  function renderCard(card) {
    const node = document.createElement('div');
    node.className = 'up-card';

    if (card.t === 'attr') {
      const meta = CFG.attr[card.attr];
      const rar = rarOf(card.ri);
      node.classList.add('up-card');
      if (card.ri === 4) node.classList.add('gold');
      node.style.setProperty('--c', rar.c);
      node.innerHTML =
        '<div class="card-rar">' + rar.name + '</div>' +
        '<div class="card-icon">' + ATTR_ICON[card.attr] + '</div>' +
        '<div class="card-name">' + meta.label + '</div>' +
        '<div class="card-val">+' + card.val + '</div>' +
        '<div class="card-note">' + meta.note + '</div>';
      return node;
    }

    if (card.t === 'equip') {
      const rar = rarOf(card.ri);
      const slot = SLOTS.find(s => s.key === card.slot);
      const it = buildItem(card.slot, card.defIdx, card.ri, 1);
      node.className = 'up-card' + cardRarityClass(card.ri);
      node.style.setProperty('--c', rar.c);
      node.innerHTML =
        '<div class="card-rar">' + rar.name + ' · ' + slot.name + '</div>' +
        '<div class="card-icon">' + it.icon + '</div>' +
        '<div class="card-name">' + it.name + '</div>' +
        '<div class="card-eff">' + itemDesc(it) + '</div>' +
        '<div class="card-tag">装备 ' + slot.name + '位</div>';
      return node;
    }

    if (card.t === 'forge') {
      const it = card.item;
      const next = buildItem(it.slot, ITEM_DEFS[it.slot].indexOf(it.def), it.rarity, it.level + 1);
      node.className = 'up-card';
      node.style.setProperty('--c', it.c);
      node.innerHTML =
        '<div class="card-rar">强化 · ' + it.slotName + '</div>' +
        '<div class="card-icon">' + it.icon + '</div>' +
        '<div class="card-name">' + it.name + ' <span style="color:' + it.c + '">Lv.' + it.level + ' → ' + next.level + '</span></div>' +
        '<div class="card-eff">' + itemDesc(next) + '</div>' +
        '<div class="card-tag">强化现有装备</div>';
      return node;
    }

    // ascend
    const it = card.item;
    const newRar = rarOf(it.rarity + 1);
    const next = buildItem(it.slot, ITEM_DEFS[it.slot].indexOf(it.def), it.rarity + 1, 1);
    node.className = 'up-card' + (it.rarity + 1 === 4 ? ' gold' : '');
    node.style.setProperty('--c', newRar.c);
    node.innerHTML =
      '<div class="card-rar">升华 · ' + newRar.name + '</div>' +
      '<div class="card-icon">' + it.icon + '</div>' +
      '<div class="card-name">' + it.name + ' <span style="color:' + newRar.c + '">' + rarOf(it.rarity).name + ' → ' + newRar.name + '</span></div>' +
      '<div class="card-eff">' + itemDesc(next) + '</div>' +
      '<div class="card-tag">稀有度提升，等级重置为 1</div>';
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
    el.upSub.textContent = '第 ' + state.wave + ' 波已征服 · 从三项中选择一项';
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

    renderEqPanel();
    el.upOverlay.classList.add('show');
    sfxUpgrade();
  }

  async function chooseUpgrade(card, node) {
    if (state.phase !== 'upgrade') return;
    state.phase = 'busy';

    Array.from(el.cards.children).forEach(c => {
      if (c === node) c.classList.add('picked');
      else c.classList.add('dim');
    });

    const p = state.player;
    let justSlot = null;

    if (card.t === 'attr') {
      if (card.attr === 'hp') {
        p.baseHp += card.val;
        p.hp += card.val;
      } else if (card.attr === 'atk') {
        p.baseAtk += card.val;
      } else {
        p.baseDef += card.val;
      }
      refresh(p);
    } else if (card.t === 'equip') {
      p.items.push(buildItem(card.slot, card.defIdx, card.ri, 1));
      refresh(p);
      justSlot = card.slot;
    } else if (card.t === 'forge') {
      const it = card.item;
      const defIdx = ITEM_DEFS[it.slot].indexOf(it.def);
      const idx = p.items.indexOf(it);
      p.items[idx] = buildItem(it.slot, defIdx, it.rarity, it.level + 1);
      refresh(p);
      justSlot = it.slot;
    } else {
      const it = card.item;
      const defIdx = ITEM_DEFS[it.slot].indexOf(it.def);
      const idx = p.items.indexOf(it);
      p.items[idx] = buildItem(it.slot, defIdx, it.rarity + 1, 1);
      refresh(p);
      justSlot = it.slot;
    }

    tone({ freq: 660, type: 'sine', dur: 0.18, vol: 0.1 });
    await sleep(520);

    el.upOverlay.classList.remove('show');
    await sleep(260);

    state.wave += 1;
    G.startWave(justSlot);
  }

  Object.assign(G, { rollRarity, makeCards, renderCard, renderEqPanel, showUpgrade, chooseUpgrade });
})(window.ABYSS = window.ABYSS || {});
