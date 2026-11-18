/* ============================================================
   系统层 · loot.js
   战利品：击杀后从怪物装备中掉落 1 件，由玩家决定装备 / 吸收 / 替换 / 放弃
   ============================================================ */
(function (G) {
  'use strict';

  const { SLOTS, state, el, pick, fmt, rarOf, cloneItem, upgradePath, itemAt, itemDesc, refresh, render, tone } = G;

  /* =========================================================
     掉落与决策
     ========================================================= */

  /** 击杀怪物后取它身上一件装备作为战利品（复制为独立实例） */
  function rollLoot(monster) {
    if (!monster || !monster.items || !monster.items.length) return null;
    return cloneItem(pick(monster.items));
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

  const PLAN_TEXT = {
    new: '空置槽位 · 直接装备',
    swap: '已有不同装备，装备后将替换'
  };

  function planLabel(plan) {
    const p = state.player;
    switch (plan.mode) {
      case 'new': return PLAN_TEXT.new;
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
  function syncStats() {
    const p = state.player;
    if (el.curHp) el.curHp.textContent = fmt(p.maxHp);
    if (el.curAtk) el.curAtk.textContent = fmt(p.atk);
    if (el.curDef) el.curDef.textContent = fmt(p.def);
  }

  function slotNameOf(key) {
    const s = SLOTS.find(x => x.key === key);
    return s ? s.name : '';
  }

  function renderLoot() {
    const box = el.lootBox;
    if (!box) return;

    const loot = state.loot;
    box.innerHTML = '';

    if (!loot) {
      box.classList.remove('show');
      el.cards.classList.remove('locked');
      return;
    }

    box.classList.add('show');

    const plan = planFor(loot);
    const rar = rarOf(loot.rarity);
    box.style.setProperty('--c', rar.c);
    box.className = 'loot show' + (loot.rarity === 4 ? ' gold' : '');

    const done = state.lootDone;

    const head =
      '<div class="loot-head">' +
        '<span class="loot-title">战利品</span>' +
        '<span class="loot-from">来自「' + (state.monster ? state.monster.name : '敌人') + '」' +
          (state.monster && state.monster.items.length > 1 ? ' · 身上共 ' + state.monster.items.length + ' 件' : '') +
        '</span>' +
        (done ? '' : '<span class="loot-hint">处理后可选属性</span>') +
      '</div>';

    let actions;
    if (done) {
      const skipped = !state.lootSlot;
      actions = '<div class="loot-done' + (skipped ? ' muted' : '') + '">' +
        (state.lootResultText || '已处理') + '</div>';
    } else {
      actions =
        '<button class="loot-btn primary" data-act="take"' + (plan.mode === 'max' ? ' disabled' : '') + '>' +
          actionLabel(plan) +
        '</button>' +
        '<button class="loot-btn" data-act="skip">放 弃</button>';
    }

    box.innerHTML = head +
      '<div class="loot-card' + (done ? ' resolved' : '') + '">' +
        '<div class="loot-ic">' + loot.icon + '</div>' +
        '<div class="loot-info">' +
          '<div class="loot-name">' +
            '<span class="loot-nm">' + loot.name + '</span>' +
            '<span class="loot-lv">Lv.' + loot.level + '</span>' +
            '<span class="loot-rar">' + rar.name + '</span>' +
            '<span class="loot-slot">' + slotNameOf(loot.slot) + '位</span>' +
          '</div>' +
          '<div class="loot-eff">' + itemDesc(loot) + '</div>' +
          (done ? '' : '<div class="loot-cmp">' + planLabel(plan) + '</div>') +
        '</div>' +
        '<div class="loot-btns">' + actions + '</div>' +
      '</div>';

    if (done) {
      el.cards.classList.remove('locked');
    } else {
      el.cards.classList.add('locked');
      box.querySelectorAll('.loot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.act === 'take') takeLoot();
          else skipLoot();
        });
      });
    }
  }

  /* =========================================================
     结算
     ========================================================= */
  function takeLoot() {
    if (!state.loot || state.lootDone) return;
    const p = state.player;
    const loot = state.loot;
    const plan = planFor(loot);
    if (plan.mode === 'max') return;

    let text;

    if (plan.mode === 'new') {
      p.items.push(loot);
      text = '已装备 <b>' + loot.name + '</b> Lv.' + loot.level;
    } else if (plan.mode === 'upgrade' || plan.mode === 'ascend') {
      const idx = p.items.indexOf(plan.cur);
      p.items[idx] = plan.next;
      text = plan.mode === 'upgrade'
        ? '<b>' + plan.next.name + '</b> 强化至 Lv.' + plan.next.level
        : '<b>' + plan.next.name + '</b> 升华至 ' + rarOf(plan.next.rarity).name + ' · Lv.1';
    } else {
      const idx = p.items.indexOf(plan.cur);
      p.items[idx] = loot;
      text = '已替换为 <b>' + loot.name + '</b> Lv.' + loot.level;
    }

    refresh(p);
    state.lootSlot = loot.slot;
    state.lootDone = true;
    state.lootResultText = text;

    tone({ freq: 720, type: 'sine', dur: 0.16, vol: 0.09 });

    syncStats();
    render(true);
    renderLoot();
  }

  function skipLoot() {
    if (!state.loot || state.lootDone) return;
    state.lootDone = true;
    state.lootSlot = null;
    state.lootResultText = '已放弃这件战利品';
    tone({ freq: 300, type: 'sine', dur: 0.12, vol: 0.06 });
    renderLoot();
  }

  /** 进入下一波前清空战利品状态 */
  function clearLoot() {
    state.loot = null;
    state.lootDone = false;
    state.lootSlot = null;
    state.lootResultText = '';
    if (el.lootBox) {
      el.lootBox.innerHTML = '';
      el.lootBox.classList.remove('show');
    }
    if (el.cards) el.cards.classList.remove('locked');
  }

  Object.assign(G, { rollLoot, planFor, renderLoot, takeLoot, skipLoot, clearLoot, syncStats });
})(window.ABYSS = window.ABYSS || {});
