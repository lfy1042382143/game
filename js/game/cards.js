/* ============================================================
   游戏层 · cards.js
   升级三选一：经验满自动升级后弹出（弹窗期间暂停）。
   - 每 modeEvery 级（默认 10）→「攻击方式」升级：攻速/散射/贯穿/
     射程/环绕飞刃/暴击节奏/弹速/吸血箭/减速箭/护盾生成
   - 其余等级 → 三维属性三选一（生命/攻击/防御，带稀有度）
   属性不再自动成长：三维提升只来自这里的选卡与装备。
   ============================================================ */
(function (G) {
  'use strict';

  const { state, RARITY, rarOf, CFG } = G;

  /* =========================================================
     属性卡（沿用稀有度体系）
     ========================================================= */
  /** 抽稀有度：幸运值抬升高稀有度权重（白卡不变，稀有度越高增幅越大） */
  function rollRarity(level, luck) {
    luck = luck || 0;
    const tiers = CFG.levelup.luckTier || [0, 0.06, 0.12, 0.20, 0.30];
    const weights = RARITY.map((r, i) => r.w(level) * (1 + tiers[i] * luck));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < RARITY.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return 0;
  }

  const ATTR_META = {
    hp:  { label: '生命', icon: '❤', vals: [10, 18, 28, 42, 62], note: '提升生命上限，并立即恢复等量生命' },
    atk: { label: '攻击', icon: '⚔', vals: [3, 5, 7, 10, 14],    note: '每支箭矢造成更高伤害' },
    def: { label: '防御', icon: '🛡', vals: [1, 2, 3, 4, 6],      note: '减免受到的伤害' }
  };

  const ATTR_POOL = [
    { key: 'hp',  name: '生命', icon: '❤', kind: 'attr', attr: 'hp' },
    { key: 'atk', name: '攻击', icon: '⚔', kind: 'attr', attr: 'atk' },
    { key: 'def', name: '防御', icon: '🛡', kind: 'attr', attr: 'def' }
  ];

  /** 升级效率卡：随机混入卡池（击杀经验 +20%，上限 1.6 防止后期升级过快） */
  const XP_CARD = {
    key: 'xpgain', name: '升级效率', icon: '✨', kind: 'mode',
    max: p => (p.xpMul || 1) >= CFG.levelup.xpMulCap,
    desc: p => (p.xpMul || 1) > 1
      ? '获得经验再 +20%（当前 +' + Math.round((p.xpMul - 1) * 100) + '%）· 升级更快'
      : '击杀获得的经验 +20% · 升级更快（最多 +60%）',
    apply(p) { p.xpMul = Math.min(CFG.levelup.xpMulCap, (p.xpMul || 1) + 0.2); }
  };

  /* =========================================================
     攻击方式卡池：六条技能线（箭矢/飞刃/震荡波/闪电/浮游炮/地雷）
     + 通用辅助卡（幸运）；每条线 5 级，满级后不再入池
     ========================================================= */
  const SKILL_CARDS = G.SKILL_KEYS ? G.SKILL_KEYS.map(k => G.makeSkillCard(k)) : [];

  const MODE_POOL = [
    {
      key: 'slow', name: '减速箭', icon: '🕸️', kind: 'mode',
      max: p => p.cardSlow >= 3,
      desc: p => p.cardSlow
        ? '减速效果再 +18%（当前 −' + Math.round(p.cardSlow * 18) + '%）'
        : '命中使敌人移动速度降低 18%，持续 1.6 秒',
      apply(p) { p.cardSlow++; }
    },
    {
      key: 'aegis', name: '护盾生成', icon: '🔵', kind: 'mode',
      max: p => p.shieldEvery >= 3,
      desc: p => p.shieldEvery
        ? '护盾节拍提前（当前每 ' + p.shieldEvery + ' 秒 +' + p.shieldVal + ' 点）'
        : '每 8 秒自动获得 10 点护盾（上限 30）',
      apply(p) {
        if (!p.shieldEvery) { p.shieldEvery = 8; p.shieldVal = 10; }
        else { p.shieldEvery = Math.max(3, p.shieldEvery - 2); p.shieldVal += 4; }
      }
    },
    {
      key: 'luck', name: '幸运', icon: '🍀', kind: 'mode',
      max: p => p.luck >= 8,
      desc: p => p.luck
        ? '幸运再 +1（当前 ' + p.luck + '）· 升级选项更容易出现高稀有度'
        : '幸运 +1：升级属性卡更容易出现精良/稀有/史诗/传说',
      apply(p) { p.luck++; }
    }
  ];

  /** 混合卡池：每次升级从「属性 + 攻击方式 + 幸运 + 升级效率」中随机抽 3 张
      （全部达上限的卡不入池；池抽干时回落为属性卡，避免空弹窗卡死） */
  function makeLevelCards(p) {
    const bag = ATTR_POOL.slice();
    // 六条攻击方式技能线（未满级才入池）
    for (const c of SKILL_CARDS) {
      if (!c.max(p)) bag.push(c);
    }
    // 通用辅助卡
    for (const c of MODE_POOL) {
      if (!c.max(p)) bag.push(c);
    }
    if (!XP_CARD.max(p)) bag.push(XP_CARD);   // 升级效率：随机混入

    const out = [];
    while (out.length < 3 && bag.length) {
      const i = Math.floor(Math.random() * bag.length);
      const card = bag.splice(i, 1)[0];
      if (card.kind === 'attr') {
        const ri = rollRarity(p.level, p.luck);
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
      note = typeof card.desc === 'function' ? card.desc(state.player) : card.desc;
      val = card.kind === 'skill'
        ? 'Lv.' + ((state.player.skills && state.player.skills[card.skill]) || 0) + '→' + (((state.player.skills && state.player.skills[card.skill]) || 0) + 1)
        : ({ slow: '−18%', aegis: '10/8s', luck: '+1', xpgain: '+20%' }[card.key] || '+1');
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

  /** 弹出升级三选一（连升多级依次弹出） */
  function showLevelUp() {
    state.phase = 'levelup';
    const p = state.player;
    G.el.upSub.textContent = 'Lv.' + p.level + ' · 选择一项：属性 / 攻击方式 / 🍀 幸运 / ✨ 升级效率';
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

    // 还有未处理的升级 → 继续弹；否则回到战斗
    if (state.pendingLevelUps > 0) {
      G.showLevelUp();
    } else {
      state.phase = 'play';
    }
  }

  function applyCard(card) {
    const p = state.player;
    if (card.kind === 'attr') {
      // 属性卡：加到基础三维，经 refresh 与装备聚合后生效
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

  Object.assign(G, { rollRarity, makeLevelCards, renderCard, renderEqPanel, showLevelUp, chooseLevelCard, MODE_POOL, SKILL_CARDS, ATTR_POOL, ATTR_META, XP_CARD });
})(window.ABYSS = window.ABYSS || {});
