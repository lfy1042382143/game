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
    hp:  { label: '生命', icon: '❤', vals: [16, 30, 48, 72, 108], note: '提升生命上限，并立即恢复等量生命' },
    atk: { label: '攻击', icon: '⚔', vals: [5, 8, 12, 17, 25],    note: '每支箭矢造成更高伤害' },
    def: { label: '防御', icon: '🛡', vals: [2, 3, 5, 7, 10],     note: '减免受到的伤害' }
  };

  const ATTR_POOL = [
    { key: 'hp',  name: '生命', icon: '❤', kind: 'attr', attr: 'hp' },
    { key: 'atk', name: '攻击', icon: '⚔', kind: 'attr', attr: 'atk' },
    { key: 'def', name: '防御', icon: '🛡', kind: 'attr', attr: 'def' }
  ];

  /** 升级效率卡：每 2 级加入属性池（击杀经验 +15%，可叠加） */
  const XP_CARD = {
    key: 'xpgain', name: '升级效率', icon: '✨', kind: 'mode',
    max: p => (p.xpMul || 1) >= 2.5,
    desc: p => (p.xpMul || 1) > 1
      ? '获得经验再 +20%（当前 +' + Math.round((p.xpMul - 1) * 100) + '%）· 升级更快'
      : '击杀获得的经验 +20% · 升级更快（可叠加）',
    apply(p) { p.xpMul = Math.min(2.5, (p.xpMul || 1) + 0.2); }
  };

  /* =========================================================
     攻击方式卡池（每 modeEvery 级出现一次；全部有上限）
     ========================================================= */
  const MODE_POOL = [
    {
      key: 'haste', name: '攻速提升', icon: '⚡', kind: 'mode',
      max: p => p.atkCdMul <= 0.36,
      desc: '射击间隔 −18%',
      apply(p) { p.atkCdMul = Math.max(0.35, p.atkCdMul * 0.82); }
    },
    {
      key: 'multi', name: '散射箭', icon: '🏹', kind: 'mode',
      max: p => p.shots >= 4,
      desc: p => p.shots > 1
        ? '再多射出 1 支箭（当前 ' + p.shots + ' 支，每支 ' + Math.round(p.shotDmgMul * 100) + '% 攻击）'
        : '每次射击多射出 1 支箭（扇形散开），每支箭的伤害变为 70% 攻击',
      apply(p) { p.shots++; p.shotDmgMul = 0.7; }
    },
    {
      key: 'pierce', name: '贯穿箭', icon: '🎯', kind: 'mode',
      max: p => p.pierce >= 3,
      desc: p => p.pierce
        ? '再穿透 1 个额外的敌人（当前穿透 ' + p.pierce + ' 层，逐层衰减）'
        : '箭矢可穿透 1 个额外的敌人，穿透伤害为 70% 攻击（逐层再衰减）',
      apply(p) { p.pierce++; }
    },
    {
      key: 'range', name: '射程提升', icon: '📡', kind: 'mode',
      max: p => p.rangeMul >= 2.0,
      desc: '攻击射程 +15%（更远的索敌与箭矢飞行距离）',
      apply(p) {
        p.rangeMul = Math.min(2.0, p.rangeMul * 1.15);
        p.range = Math.round(CFG.player.range * p.rangeMul);
      }
    },
    {
      key: 'orbit', name: '环绕飞刃', icon: '🌀', kind: 'mode',
      max: p => p.orbits >= 6,
      desc: p => p.orbits
        ? '再增加 2 枚飞刃（当前 ' + p.orbits + ' 枚，每枚 ' + Math.round(p.orbitDmgMul * 100) + '% 攻击）'
        : '增加 2 枚绕身飞刃（每枚 60% 攻击），飞刃越多单枚伤害越低',
      apply(p) {
        p.orbits += 2;
        p.orbitDmgMul = Math.max(0.3, p.orbitDmgMul * 0.85);
      }
    },
    {
      key: 'crit', name: '暴击节奏', icon: '💥', kind: 'mode',
      max: p => p.critEvery <= 2,
      desc: p => p.critEvery
        ? '暴击节拍提前 1 发（当前每 ' + p.critEvery + ' 发必暴 ×' + p.critMult.toFixed(1) + '）'
        : '每第 4 发箭矢必定暴击，造成 2.2 倍伤害',
      apply(p) {
        if (!p.critEvery) { p.critEvery = 4; p.critMult = 2.2; }
        else { p.critEvery = Math.max(2, p.critEvery - 1); p.critMult += 0.1; }
      }
    },
    {
      key: 'velocity', name: '弹速提升', icon: '💨', kind: 'mode',
      max: p => p.bulletSpeedMul >= 1.8,
      desc: '箭矢飞行速度 +18%（命中更快，预判更稳）',
      apply(p) { p.bulletSpeedMul = Math.min(1.8, p.bulletSpeedMul * 1.18); }
    },
    {
      key: 'leech', name: '吸血箭', icon: '🩸', kind: 'mode',
      max: p => p.cardLeech >= 24,
      desc: p => p.cardLeech
        ? '吸血再 +6%（当前 ' + p.cardLeech + '%）'
        : '箭矢伤害的 6% 转化为自身治疗',
      apply(p) { p.cardLeech = Math.min(24, p.cardLeech + 6); }
    },
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

  /** 抽 3 张不重复：每 modeEvery 级抽攻击方式/幸运，其余等级抽三维属性
      攻击方式卡池抽干（全部达到上限）时回落为属性卡，避免空弹窗卡死 */
  function makeLevelCards(p) {
    const isModeLevel = p.level % CFG.levelup.modeEvery === 0;

    // 每 2 级（非攻击方式级）：必含一张升级效率卡，其余随机属性
    if (!isModeLevel && p.level % 2 === 0 && !XP_CARD.max(p)) {
      const bag = ATTR_POOL.slice();
      const out = [Object.assign({}, XP_CARD)];
      while (out.length < 3 && bag.length) {
        const i = Math.floor(Math.random() * bag.length);
        const card = bag.splice(i, 1)[0];
        const ri = rollRarity(p.level, p.luck);
        out.push(Object.assign({}, card, { ri, val: ATTR_META[card.attr].vals[ri] }));
      }
      return out;
    }

    let pool = isModeLevel
      ? MODE_POOL.filter(c => !c.max(p))
      : ATTR_POOL.slice();
    if (!pool.length) pool = ATTR_POOL.slice();

    const out = [];
    const bag = pool.slice();
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
      val = { orbit: '+2', range: '+15%', velocity: '+18%', leech: '+6%', slow: '−18%', aegis: '10/8s', crit: '×2.2', luck: '+1', xpgain: '+20%' }[card.key] || '+1';
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
    const isMode = p.level % CFG.levelup.modeEvery === 0;
    G.el.upSub.textContent = isMode
      ? 'Lv.' + p.level + ' · ⚡ 攻击方式 / 🍀 幸运 · 选择一项'
      : 'Lv.' + p.level + ' · 提升一项属性';
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

  Object.assign(G, { rollRarity, makeLevelCards, renderCard, renderEqPanel, showLevelUp, chooseLevelCard, MODE_POOL, ATTR_POOL, ATTR_META, XP_CARD });
})(window.ABYSS = window.ABYSS || {});
