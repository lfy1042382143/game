/* ============================================================
   游戏层 · cards.js
   升级三选一：经验满自动升级后弹出，选项含
   攻速提升 / 攻击方式（散射·贯穿·追踪·环绕飞刃）/ 三维属性
   弹窗期间游戏暂停（phase = 'levelup'）
   ============================================================ */
(function (G) {
  'use strict';

  const { state, RARITY, rarOf, CFG } = G;

  /* =========================================================
     属性卡（沿用稀有度体系）
     ========================================================= */
  function rollRarity(level) {
    const weights = RARITY.map(r => r.w(level));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < RARITY.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return 0;
  }

  const ATTR_META = {
    hp:  { label: '生命', icon: '❤', vals: [19, 36, 59, 90, 138], note: '提升生命上限，并立即恢复等量生命' },
    atk: { label: '攻击', icon: '⚔', vals: [6, 9, 13, 20, 29],    note: '每支箭矢造成更高伤害' },
    def: { label: '防御', icon: '🛡', vals: [2, 3, 4, 6, 9],      note: '减免受到的伤害' }
  };

  /* =========================================================
     升级卡池：攻击方式类（有上限）+ 属性类（无限）
     ========================================================= */
  const LEVEL_POOL = [
    {
      key: 'haste', name: '攻速提升', icon: '⚡', kind: 'mode',
      max: p => p.atkCdMul <= 0.36,
      desc: '射击间隔 −18%',
      apply(p) { p.atkCdMul = Math.max(0.35, p.atkCdMul * 0.82); }
    },
    {
      key: 'multi', name: '散射箭', icon: '🏹', kind: 'mode',
      max: p => p.shots >= 4,
      desc: '每次射击多射出 1 支箭（扇形散开）',
      apply(p) { p.shots++; }
    },
    {
      key: 'pierce', name: '贯穿箭', icon: '🎯', kind: 'mode',
      max: p => p.pierce >= 3,
      desc: '箭矢可穿透 1 个额外的敌人',
      apply(p) { p.pierce++; }
    },
    {
      key: 'homing', name: '追踪箭', icon: '🧲', kind: 'mode',
      max: p => p.homing >= 2,
      desc: '箭矢自动弯向最近的敌人',
      apply(p) { p.homing++; }
    },
    {
      key: 'orbit', name: '环绕飞刃', icon: '🌀', kind: 'mode',
      max: p => p.orbits >= 6,
      desc: '增加 2 枚绕身飞刃，持续切割靠近的敌人',
      apply(p) { p.orbits += 2; }
    },
    { key: 'hp',  name: '生命', icon: '❤', kind: 'attr', attr: 'hp' },
    { key: 'atk', name: '攻击', icon: '⚔', kind: 'attr', attr: 'atk' },
    { key: 'def', name: '防御', icon: '🛡', kind: 'attr', attr: 'def' }
  ];

  /** 从卡池抽 3 张不重复（已达上限的攻击方式卡排除） */
  function makeLevelCards(p) {
    const avail = LEVEL_POOL.filter(c => c.kind === 'attr' || !c.max(p));
    const out = [];
    const bag = avail.slice();
    while (out.length < 3 && bag.length) {
      const i = Math.floor(Math.random() * bag.length);
      const card = bag.splice(i, 1)[0];
      if (card.kind === 'attr') {
        const ri = rollRarity(p.level);
        out.push(Object.assign({}, card, { ri, val: ATTR_META[card.attr].vals[ri] }));
      } else {
        out.push(Object.assign({}, card));
      }
    }
    return out;
  }

  /* =========================================================
     渲染与交互
     ========================================================= */
  function renderCard(card) {
    const rar = card.kind === 'attr' ? rarOf(card.ri) : { name: '强化', c: '#7dd3fc' };
    let icon, label, val, note;
    if (card.kind === 'attr') {
      const meta = ATTR_META[card.attr];
      icon = meta.icon; label = meta.label; val = '+' + card.val; note = meta.note;
    } else {
      icon = card.icon; label = card.name;
      val = card.key === 'orbit' ? '+2' : '+1';
      note = card.desc;
    }
    const node = document.createElement('div');
    node.className = 'up-card' + (card.kind === 'attr' && card.ri === 4 ? ' gold' : '');
    node.style.setProperty('--c', rar.c);
    node.innerHTML =
      '<div class="card-rar">' + rar.name + '</div>' +
      '<div class="card-icon">' + icon + '</div>' +
      '<div class="card-name">' + label + '</div>' +
      '<div class="card-val">' + val + '</div>' +
      '<div class="card-note">' + note + '</div>';
    return node;
  }

  function renderEqPanel() {
    const panel = G.el.eqPanel;
    const SLOTS = G.SLOTS;
    panel.innerHTML = '';
    SLOTS.forEach(slot => {
      const it = G.itemAt(state.player, slot.key);
      const cell = document.createElement('div');
      cell.className = 'eq-cell' + (it ? '' : ' empty');
      if (it) {
        const rar = rarOf(it.rarity);
        cell.innerHTML =
          '<div class="eq-cell-ic">' + it.icon + '</div>' +
          '<div class="eq-cell-body">' +
            '<div class="eq-cell-name">' + it.name +
              '<span style="color:' + rar.c + '">Lv.' + it.level + '</span></div>' +
            '<div class="eq-cell-eff">' + G.itemDescText(it) + '</div>' +
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

  /** 弹出升级三选一（每级一次；连升多级会依次弹出） */
  function showLevelUp() {
    state.phase = 'levelup';
    const p = state.player;
    G.el.upSub.textContent = 'Lv.' + p.level + ' · 三维已自动成长（+' +
      CFG.growth.hp + ' 生命 +' + CFG.growth.atk + ' 攻击 +' + CFG.growth.def + ' 防御）';
    G.el.curHp.textContent = G.fmt(p.maxHp);
    G.el.curAtk.textContent = G.fmt(p.atk);
    G.el.curDef.textContent = G.fmt(p.def);

    const cards = makeLevelCards(p);
    G.el.cards.innerHTML = '';
    cards.forEach(card => {
      const node = renderCard(card);
      node.addEventListener('click', () => chooseLevelCard(card));
      G.el.cards.appendChild(node);
    });

    G.renderEqPanel();
    G.el.upgradeOverlay.classList.add('show');
    G.sfxUpgrade();
  }

  function chooseLevelCard(card) {
    if (state.phase !== 'levelup') return;
    state.phase = 'busy';

    // 兜底：任何卡效果抛异常都不能把游戏永久卡死
    try {
      applyCard(card);
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) console.error('升级卡效果异常:', err);
    }

    G.ui.syncTopbar();

    G.el.upgradeOverlay.classList.remove('show');
    G.tone({ freq: 660, type: 'sine', dur: 0.18, vol: 0.1 });

    state.pendingLevelUps = Math.max(0, state.pendingLevelUps - 1);

    // 还有未处理的升级 → 继续弹；否则若波次已清空（有待处理战利品）→ 战利品；否则回到战斗
    if (state.pendingLevelUps > 0) {
      G.showLevelUp();
    } else if (state.loots.length) {
      G.showLoot();
    } else {
      state.phase = 'play';
    }
  }

  function applyCard(card) {
    const p = state.player;
    if (card.kind === 'attr') {
      // 属性卡：加到基础三维（与升级自动成长同路），经 refresh 与装备聚合后生效
      if (card.attr === 'hp') p.baseHp += card.val;
      else if (card.attr === 'atk') p.baseAtk += card.val;
      else p.baseDef += card.val;
      G.refresh(p);
      if (card.attr === 'hp') G.healUnit(p, card.val);   // 生命卡立即回血
    } else {
      card.apply(p);
      G.refresh(p);
    }
  }

  Object.assign(G, { rollRarity, makeLevelCards, renderCard, renderEqPanel, showLevelUp, chooseLevelCard, LEVEL_POOL, ATTR_META });
})(window.ABYSS = window.ABYSS || {});
