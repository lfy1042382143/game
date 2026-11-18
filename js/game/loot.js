/* ============================================================
   游戏层 · loot.js
   战利品：波次全灭后，敌人身上的每件装备都会掉落，
   逐件决定 装备 / 吸收强化 / 吸收升华 / 替换 / 放弃
   ============================================================ */
(function (G) {
  'use strict';

  const { state, SLOTS, rarOf, itemAt, upgradePath, itemDesc } = G;

  /* =========================================================
     掉落
     ========================================================= */

  /** 全灭后收集本波所有敌人的装备作为战利品（逐件复制为独立实例） */
  function rollLoot() {
    state.loots = [];
    state.foes.forEach(foe => {
      if (!foe.items || !foe.items.length) return;
      foe.items.forEach(it => {
        // 带词缀的敌人「高风险高回报」：掉落物稀有度 +1（封顶传说）
        const rar = foe.affix ? Math.min(4, it.rarity + 1) : it.rarity;
        const copy = G.buildItem(it.slot, G.ITEM_DEFS[it.slot].indexOf(it.def), rar, it.level);
        state.loots.push({ item: copy, done: false, result: '', slot: copy.slot });
      });
    });
  }

  /** 还有几件没处理 */
  function lootPending() {
    return state.loots.reduce((n, e) => n + (e.done ? 0 : 1), 0);
  }

  /** 判断这件战利品落到当前槽位会发生什么 */
  function planFor(loot) {
    const cur = itemAt(state.player, loot.slot);
    if (!cur) return { mode: 'new' };

    if (cur.key === loot.key) {
      const path = upgradePath(cur);
      if (path.kind === 'max') return { mode: 'max', cur };
      return { mode: path.kind, cur, next: path.item };
    }
    return { mode: 'swap', cur };
  }

  function planLabel(plan) {
    switch (plan.mode) {
      case 'new': return '空置槽位 · 直接装备';
      case 'upgrade': return '与现有装备同款 · 吸收强化 <b>Lv.' + plan.cur.level + ' → Lv.' + plan.next.level + '</b>';
      case 'ascend': return '与现有装备同款且已满级 · 吸收升华 <b>' + rarOf(plan.cur.rarity).name + ' → ' + rarOf(plan.cur.rarity + 1).name + '</b>';
      case 'swap': return '现有 <b>' + plan.cur.name + ' Lv.' + plan.cur.level + '</b>（' + rarOf(plan.cur.rarity).name + '），替换后旧装备丢弃';
      case 'max': return '该槽位已是满级传说，无法再提升';
    }
    return '';
  }

  function actionLabel(plan) {
    if (plan.mode === 'new') return '装 备';
    if (plan.mode === 'upgrade') return '吸收强化';
    if (plan.mode === 'ascend') return '吸收升华';
    if (plan.mode === 'swap') return '替 换';
    return '已满级';
  }

  /* =========================================================
     渲染
     ========================================================= */
  function slotNameOf(key) {
    const s = SLOTS.find(x => x.key === key);
    return s ? s.name : '';
  }

  function rowHtml(entry, idx) {
    const it = entry.item;
    const rar = rarOf(it.rarity);
    const plan = planFor(it);

    let actions;
    if (entry.done) {
      actions = '<div class="loot-done' + (entry.skipped ? ' muted' : '') + '">' +
        (entry.result || '已处理') + '</div>';
    } else {
      actions =
        '<button class="loot-btn primary" data-act="take" data-i="' + idx + '"' +
          (plan.mode === 'max' ? ' disabled' : '') + '>' + actionLabel(plan) + '</button>' +
        '<button class="loot-btn" data-act="skip" data-i="' + idx + '">放 弃</button>';
    }

    return '<div class="loot-card' + (entry.done ? ' resolved' : '') +
        (it.rarity === 4 ? ' gold' : '') + '" style="--c:' + rar.c + '">' +
      '<div class="loot-ic">' + it.icon + '</div>' +
      '<div class="loot-info">' +
        '<div class="loot-name">' +
          '<span class="loot-nm">' + it.name + '</span>' +
          '<span class="loot-lv">Lv.' + it.level + '</span>' +
          '<span class="loot-rar">' + rar.name + '</span>' +
          '<span class="loot-slot">' + slotNameOf(it.slot) + '位</span>' +
        '</div>' +
        '<div class="loot-eff">' + itemDesc(it) + '</div>' +
        (entry.done || plan.mode === 'new'
          ? ''
          : '<div class="loot-cmp">' + planLabel(plan) + '</div>') +
      '</div>' +
      '<div class="loot-btns">' + actions + '</div>' +
    '</div>';
  }

  function renderLoot() {
    const box = G.el.lootBox;
    if (!box) return;

    // 同款已满级（传说 Lv.5）时没有任何操作空间，直接判为已处理，
    // 否则「还有 N 件待处理」会一直卡住属性卡选择
    state.loots.forEach(e => {
      if (!e.done && planFor(e.item).mode === 'max') {
        e.done = true;
        e.skipped = true;
        e.result = '该槽位已满级 · 无法提升';
      }
    });

    const loots = state.loots;
    box.innerHTML = '';

    if (!loots.length) {
      box.classList.remove('show');
      box.className = 'loot';
      G.el.cards.classList.remove('locked');
      return;
    }

    const pending = lootPending();
    const allDone = pending === 0;

    const fromNames = state.foes.map(f => f.name).slice(0, 3).join('、');
    const head =
      '<div class="loot-head">' +
        '<span class="loot-title">战利品</span>' +
        '<span class="loot-from">来自「' + fromNames + (state.foes.length > 3 ? ' 等' : '') + '」' +
          (loots.length > 1 ? ' · 共 ' + loots.length + ' 件' : '') + '</span>' +
        (allDone
          ? ''
          : '<span class="loot-hint">' + (pending > 1 ? '还有 ' + pending + ' 件待处理' : '处理后可选属性') + '</span>') +
        (pending > 1 ? '<button class="loot-skipall" data-act="skipall">全部放弃</button>' : '') +
      '</div>';

    box.className = 'loot show' + (loots.some(e => e.item.rarity === 4) ? ' gold' : '');
    box.innerHTML = head +
      '<div class="loot-list">' + loots.map(rowHtml).join('') + '</div>';

    // 未处理完则锁定属性卡
    G.el.cards.classList.toggle('locked', !allDone);

    box.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'skipall') { skipAll(); return; }
        const i = Number(btn.dataset.i);
        if (act === 'take') takeLoot(i);
        else skipLoot(i);
      });
    });
  }

  /* =========================================================
     结算
     ========================================================= */
  function takeLoot(idx) {
    const entry = state.loots[idx];
    if (!entry || entry.done) return;

    const p = state.player;
    const loot = entry.item;
    const plan = planFor(loot);
    if (plan.mode === 'max') return;

    let text;

    if (plan.mode === 'new') {
      p.items.push(loot);
      text = '已装备 <b>' + loot.name + '</b> Lv.' + loot.level;
    } else if (plan.mode === 'upgrade' || plan.mode === 'ascend') {
      const i = p.items.indexOf(plan.cur);
      p.items[i] = plan.next;
      text = plan.mode === 'upgrade'
        ? '<b>' + plan.next.name + '</b> 强化至 Lv.' + plan.next.level
        : '<b>' + plan.next.name + '</b> 升华至 ' + rarOf(plan.next.rarity).name + ' · Lv.1';
    } else {
      const i = p.items.indexOf(plan.cur);
      p.items[i] = loot;
      text = '已替换为 <b>' + loot.name + '</b> Lv.' + loot.level;
    }

    G.refresh(p);
    entry.done = true;
    entry.result = text;
    entry.slot = loot.slot;
    state.lootSlots.push(loot.slot);

    G.tone({ freq: 720, type: 'sine', dur: 0.16, vol: 0.09 });

    G.ui.syncTopbar();
    renderLoot();
  }

  function skipLoot(idx) {
    const entry = state.loots[idx];
    if (!entry || entry.done) return;
    entry.done = true;
    entry.skipped = true;
    entry.result = '已放弃';
    G.tone({ freq: 300, type: 'sine', dur: 0.12, vol: 0.06 });
    renderLoot();
  }

  function skipAll() {
    let n = 0;
    state.loots.forEach(e => {
      if (e.done) return;
      e.done = true;
      e.skipped = true;
      e.result = '已放弃';
      n++;
    });
    if (!n) return;
    G.tone({ freq: 300, type: 'sine', dur: 0.12, vol: 0.06 });
    renderLoot();
  }

  /** 进入下一波前清空战利品状态 */
  function clearLoot() {
    state.loots = [];
    state.lootSlots = [];
    if (G.el.lootBox) {
      G.el.lootBox.innerHTML = '';
      G.el.lootBox.className = 'loot';
    }
    if (G.el.cards) G.el.cards.classList.remove('locked');
  }

  Object.assign(G, {
    rollLoot, lootPending, planFor, renderLoot,
    takeLoot, skipLoot, skipAll, clearLoot
  });
})(window.ABYSS = window.ABYSS || {});
