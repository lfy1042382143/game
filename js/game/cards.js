/* ============================================================
   游戏层 · cards.js
   升级三选一：经验满自动升级后弹出（弹窗期间暂停）。
   - 每 modeEvery 级（默认 10）→「攻击方式」升级：攻速/散射/贯穿/
     射程/环绕飞刃/暴击节奏/弹速/吸血箭/减速箭/护盾生成
   - 其余等级 → 三维属性三选一（生命/攻击/防御，带稀有度）
   属性不再自动成长：三维提升只来自这里的选卡。
   ============================================================ */
(function (G) {
  'use strict';

  const { state, RARITY, CFG } = G;
  const rarOf = idx => RARITY[Math.max(0, Math.min(RARITY.length - 1, idx || 0))];

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
     攻击方式卡池：七条技能线（箭矢/闪电/震荡波/飞刃/浮游炮/火球/回旋镖）
     的解锁卡 + 随机维度卡 + 通用辅助卡（幸运/全局冷却）；
     未解锁线的维度卡与已达上限的卡自动排除
     ========================================================= */
  const SKILL_CARDS = G.SKILL_CARDS || [];
  const BUILD = G.BUILD || {};
  const WLEVELS = BUILD.WEAPON_LEVELS || {};
  const PASSIVES = BUILD.PASSIVES || {};

  /** VS 式武器升级卡描述：列出 Lv n → n+1 的具体变化 */
  function weaponCardDesc(k, lv) {
    const L = G.LINES[k];
    const next = WLEVELS[k][Math.min(lv, BUILD.WEAPON_MAX - 1)];   // 下一级维度表
    const parts = (L.dims || []).map(d => {
      const v = next[d.key] || 0;
      return v ? d.name + ' ' + v : null;
    }).filter(Boolean);
    return '升到武器 Lv.' + (lv + 1) + '：' + (parts.join(' · ') || '威力提升');
  }
  /** 进化提示：该武器升级到满级后，配合配方被动可进化 */
  function evolveHint(k) {
    const recipe = (BUILD.EVOLVE_RECIPE || {})[k];
    const ps = recipe && PASSIVES[recipe];
    return ps ? '满级 + ' + ps.name + '满级 → 进化为超级武器' : '';
  }

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
    },
    {
      key: 'cdr', name: '全局冷却', icon: '⏱️', kind: 'mode',
      max: p => (p.cdr || 0) >= 5,
      desc: p => {
        const lv = p.cdr || 0;
        return lv
          ? '所有攻击方式间隔再 −10%（当前 −' + lv * 10 + '%）'
          : '箭矢/闪电/震荡波的攻击间隔、飞刃/浮游炮/火球/回旋镖的下次出现间隔，全部 −10%';
      },
      apply(p) {
        p.cdr = (p.cdr || 0) + 1;
        if (G.applySkillBuild) G.applySkillBuild(p);
      }
    }
  ];

  /**
   * VS 式升级卡池（仅武器与被动）：
   * 已持有武器/被动的升级卡 + 未满槽时的新武器/新被动。
   * 属性卡与通用辅助卡已移除；池不足时用「生命恢复」兜底避免空弹窗。
   * 满级武器/被动不再入池；进化自动触发（upgradeWeapon/upgradePassive 内）。
   */
  function collectBuildCards(p) {
    if (!p || !p.weapons || !p.passives) return [];
    const bag = [];

    // 1) 已持有武器的升级卡（未满级）
    Object.keys(WLEVELS).forEach(k => {
      const lv = G.weaponLevel(p, k);
      if (lv > 0 && lv < BUILD.WEAPON_MAX) {
        const L = G.LINES[k];
        bag.push({
          key: 'wup_' + k, kind: 'weapon', line: k,
          name: L.name + ' Lv.' + lv + '→' + (lv + 1), icon: L.icon,
          val: 'Lv.' + (lv + 1),
          desc: p2 => weaponCardDesc(k, G.weaponLevel(p2, k)) +
            (G.weaponLevel(p2, k) + 1 === BUILD.WEAPON_MAX ? '<br>' + evolveHint(k) : ''),
          apply: p2 => G.upgradeWeapon(p2, k)
        });
      }
    });

    // 2) 已持有被动的升级卡（未满级）
    Object.keys(PASSIVES).forEach(id => {
      const lv = G.passiveLevel(p, id);
      if (lv > 0 && lv < BUILD.PASSIVE_MAX) {
        const P = PASSIVES[id];
        bag.push({
          key: 'pup_' + id, kind: 'passive', pid: id,
          name: P.name + ' Lv.' + lv + '→' + (lv + 1), icon: P.icon,
          val: 'Lv.' + (lv + 1),
          desc: () => P.desc + '（当前 Lv.' + G.passiveLevel(p, id) + '）',
          apply: p2 => G.upgradePassive(p2, id)
        });
      }
    });

    // 3) 未满武器槽 → 提供新武器（随机 1 张）
    if (G.weaponCount(p) < BUILD.WEAPON_SLOTS) {
      const avail = Object.keys(WLEVELS).filter(k => G.weaponLevel(p, k) === 0);
      if (avail.length) {
        const k = avail[Math.floor(Math.random() * avail.length)];
        const L = G.LINES[k];
        bag.push({
          key: 'wnew_' + k, kind: 'weapon', line: k, isNew: true,
          name: '新武器 · ' + L.name, icon: L.icon,
          val: '获得',
          desc: () => L.unlockDesc + (evolveHint(k) ? '<br>' + evolveHint(k) : ''),
          apply: p2 => G.addWeapon(p2, k)
        });
      }
    }

    // 4) 未满被动槽 → 提供新被动（随机 1 张）
    if (G.passiveCount(p) < BUILD.PASSIVE_SLOTS) {
      const avail = Object.keys(PASSIVES).filter(id => G.passiveLevel(p, id) === 0);
      if (avail.length) {
        const id = avail[Math.floor(Math.random() * avail.length)];
        const P = PASSIVES[id];
        bag.push({
          key: 'pnew_' + id, kind: 'passive', pid: id, isNew: true,
          name: '新被动 · ' + P.name, icon: P.icon,
          val: '获得',
          desc: () => P.desc + '（满级 Lv.' + BUILD.PASSIVE_MAX + '）',
          apply: p2 => G.upgradePassive(p2, id)
        });
      }
    }

    return bag;
  }

  /** 从构筑池抽 n 张不重复卡；全满级时用「生命恢复」兜底避免空弹窗卡死 */
  function pickBuildCards(p, n) {
    if (!p || !p.weapons || !p.passives) return [];
    const bag = collectBuildCards(p);
    const out = [];
    while (out.length < n && bag.length) {
      const i = Math.floor(Math.random() * bag.length);
      out.push(bag.splice(i, 1)[0]);
    }
    while (out.length < n) {
      out.push({
        key: 'heal', kind: 'heal', name: '生命恢复', icon: '❤',
        val: '+30%', desc: () => '立即恢复 30% 最大生命',
        apply(p2) { G.healUnit(p2, Math.max(1, Math.round(p2.maxHp * 0.3))); }
      });
    }
    return out;
  }

  function makeLevelCards(p) {
    return pickBuildCards(p, 3);
  }

  /* =========================================================
     渲染与交互
     ========================================================= */
  function renderCard(card) {
    const isUlt = card.kind === 'ultimate';
    const isWeapon = card.kind === 'weapon';
    const isPassive = card.kind === 'passive';
    const rar = isUlt ? { name: '★ 超级武器', c: '#fbbf24' }
      : isWeapon ? { name: card.isNew ? '⚔ 新武器' : '⚔ 武器升级', c: '#60a5fa' }
      : isPassive ? { name: card.isNew ? '◆ 新被动' : '◆ 被动升级', c: '#c084fc' }
      : card.kind === 'heal' ? { name: '❤ 恢复', c: '#4ade80' }
      : card.kind === 'attr' ? rarOf(card.ri) : { name: '强化', c: '#7dd3fc' };
    let icon, label, val, note;
    if (card.kind === 'attr') {
      const meta = ATTR_META[card.attr];
      icon = meta.icon; label = meta.label; val = '+' + card.val; note = meta.note;
    } else {
      icon = card.icon; label = card.name;
      note = typeof card.desc === 'function' ? card.desc(state.player) : card.desc;
      val = typeof card.val === 'function'
        ? card.val(state.player)
        : (card.val || ({ slow: '−18%', aegis: '10/8s', luck: '+1', xpgain: '+20%', cdr: '−10%' }[card.key] || '+1'));
    }
    const node = document.createElement('div');
    node.className = 'up-card' + (isUlt ? ' gold ultimate' : (card.kind === 'attr' && card.ri === 4 ? ' gold' : '') + (isWeapon ? ' weapon-card' : '') + (isPassive ? ' passive-card' : ''));
    node.style.setProperty('--c', rar.c);
    node.innerHTML =
      '<div class="card-rar">' + rar.name + '</div>' +
      '<div class="card-icon">' + icon + '</div>' +
      '<div class="card-name">' + label + '</div>' +
      '<div class="card-val">' + val + '</div>' +
      '<div class="card-note">' + note + '</div>';
    return node;
  }

  /** 装备模块已移除：保留空函数兼容旧调用 */
  function renderEqPanel() { }

  /** 弹出升级三选一（连升多级依次弹出；宝箱来源共用同一弹窗） */
  function showLevelUp() {
    state.phase = 'levelup';
    const p = state.player;
    const fromChest = (state.pendingLevelUps || 0) === 0 && (state.pendingChestUps || 0) > 0;
    const wCnt = G.weaponCount ? G.weaponCount(p) : 0, pCnt = G.passiveCount ? G.passiveCount(p) : 0;
    G.el.upSub.textContent = fromChest
      ? '宝箱开启 · 选择一项强化'
      : 'Lv.' + p.level + ' · 武器 ' + wCnt + '/' + BUILD.WEAPON_SLOTS + ' · 被动 ' + pCnt + '/' + BUILD.PASSIVE_SLOTS + ' · 强化你已持有的，或获取新的';
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

  /** 神秘商人：付费后从已持有构筑中指定一项直接 +1 级（共用升级卡样式） */
  function showEventPick() {
    const p = state.player;
    state.eventPick = true;
    state.phase = 'eventpick';
    G.el.upSub.textContent = '神秘商人 · 指定一项武器/被动直接 +1 级（本次已付费）';
    G.el.curHp.textContent = G.fmt(p.maxHp);
    G.el.curAtk.textContent = G.fmt(p.atk);
    G.el.curDef.textContent = G.fmt(p.def);

    const cards = pickBuildCards(p, 3);
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
    if (state.phase !== 'levelup' && state.phase !== 'eventpick') return;
    const isEventPick = state.phase === 'eventpick';
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

    if (isEventPick) {
      state.eventPick = false;
      if ((state.pendingLevelUps || 0) > 0 || (state.pendingChestUps || 0) > 0) {
        G.showLevelUp();
      } else {
        state.phase = 'play';
      }
      return;
    }

    // 还有未处理的升级/宝箱强化 → 继续弹（每次选择恰好消耗一个）；否则回到战斗
    if ((state.pendingLevelUps || 0) > 0) {
      state.pendingLevelUps = Math.max(0, state.pendingLevelUps - 1);
    } else {
      state.pendingChestUps = Math.max(0, (state.pendingChestUps || 0) - 1);
    }
    if ((state.pendingLevelUps || 0) > 0 || (state.pendingChestUps || 0) > 0) {
      G.showLevelUp();
    } else {
      state.phase = 'play';
    }
  }

  function applyCard(card) {
    const p = state.player;
    // 进化快照：应用卡前后对比，检测本次新增的超级武器（每局可多把）
    const evoBefore = p.evolved ? Object.keys(p.evolved).filter(k => p.evolved[k]) : [];
    if (card.kind === 'attr') {
      // 属性卡：加到基础三维，经 refresh 重算后生效
      if (card.attr === 'hp') p.baseHp += card.val;
      else if (card.attr === 'atk') p.baseAtk += card.val;
      else p.baseDef += card.val;
      G.refresh(p);
      if (card.attr === 'hp') G.healUnit(p, card.val);   // 生命卡立即回血
    } else {
      card.apply(p);
      G.refresh(p);
    }
    // 进化提示：武器满级 + 配方被动满级时自动进化（一次可进化多把，逐条横幅展示最新一把）
    const evoAfter = p.evolved ? Object.keys(p.evolved).filter(k => p.evolved[k]) : [];
    const added = evoAfter.filter(k => !evoBefore.includes(k));
    if (added.length && G.ULT) {
      const k = added[added.length - 1];
      if (G.ULT[k] && G.LINES[k]) {
        state.banner = {
          text: '★ 超级武器 · ' + G.ULT[k].name + (added.length > 1 ? ' ×' + added.length : ''),
          sub: G.LINES[k].icon + ' ' + G.ULT[k].desc,
          t: 3.4
        };
        if (G.sfxUpgrade) G.sfxUpgrade();
      }
    }
  }

  Object.assign(G, {
    rollRarity, collectBuildCards, pickBuildCards, makeLevelCards,
    renderCard, renderEqPanel, showLevelUp, showEventPick, chooseLevelCard,
    MODE_POOL, SKILL_CARDS, ATTR_POOL, ATTR_META, XP_CARD
  });
})(window.ABYSS = window.ABYSS || {});
