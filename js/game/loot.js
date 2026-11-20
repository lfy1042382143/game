/* ============================================================
   游戏层 · loot.js（宝箱版）
   装备唯一来源：精英怪击杀后原地掉落装备宝箱，
   走近开启后逐件决定 装备 / 吸收强化 / 吸收升华 / 替换 / 放弃
   ============================================================ */
(function (G) {
  'use strict';

  const { state, SLOTS, rarOf, itemAt, upgradePath, itemDesc, CFG } = G;

  /* =========================================================
     （装备改为地图宝箱获取，敌人不再掉落装备）
     ========================================================= */

  /** 还有几件没处理 */
  function lootPending() {
    return state.loots.reduce((n, e) => n + (e.done ? 0 : 1), 0);
  }

  /** 装备综合评分：稀有度(权重最高) + 锻造等级 + 主属性 + 词条强度
      用于「不同款装备」的比较：只有明显更强才允许替换，否则拆解为强化材料 */
  function itemScore(it) {
    if (!it) return 0;
    const rarW = [10, 26, 48, 78, 120][it.rarity] || 0;
    const lvW = (it.level - 1) * 14;
    const stat = (it.statV || 0) * (it.statK === 'hp' ? 0.12 : 1);
    // 词条强度按稀有度粗略估算（具体 eff 数值量纲不同，用稀有度×固定系数平衡）
    const effW = it.def && it.def.mk ? [10, 16, 24, 34, 46][it.rarity] || 0 : 0;
    return rarW + lvW + stat + effW;
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
    // 不同款：按综合分比较，新装明显更强（>5%）才替换，否则拆解为强化材料
    const curScore = itemScore(cur), newScore = itemScore(loot);
    if (newScore > curScore * 1.05) return { mode: 'swap', cur, better: true, curScore, newScore };
    const salvage = upgradePath(cur);
    if (salvage.kind !== 'max') return { mode: 'salvage', cur, next: salvage.item, curScore, newScore };
    return { mode: 'reject', cur, curScore, newScore };
  }

  function planLabel(plan) {
    switch (plan.mode) {
      case 'new': return '空置槽位 · 直接装备';
      case 'upgrade': return '与现有装备同款 · 吸收强化 <b>Lv.' + plan.cur.level + ' → Lv.' + plan.next.level + '</b>';
      case 'ascend': return '与现有装备同款且已满级 · 吸收升华 <b>' + rarOf(plan.cur.rarity).name + ' → ' + rarOf(plan.cur.rarity + 1).name + '</b>';
      case 'swap': return '现有 <b>' + plan.cur.name + ' Lv.' + plan.cur.level + '</b>（' + rarOf(plan.cur.rarity).name + '），新装更强（' + plan.curScore + '→' + plan.newScore + '），替换后旧装丢弃';
      case 'salvage': return '新装较弱（' + plan.newScore + '≤' + plan.curScore + '），拆解为材料：<b>' + plan.cur.name + '</b> 强化至 Lv.' + plan.next.level;
      case 'reject': return '新装较弱且现有装备已满级，拆解为材料后丢弃';
      case 'max': return '该槽位已是满级传说，无法再提升';
    }
    return '';
  }

  function actionLabel(plan) {
    if (plan.mode === 'new') return '装 备';
    if (plan.mode === 'upgrade') return '吸收强化';
    if (plan.mode === 'ascend') return '吸收升华';
    if (plan.mode === 'swap') return '替 换';
    if (plan.mode === 'salvage') return '拆解强化';
    if (plan.mode === 'reject') return '拆 解';
    return '已满级';
  }

  /* =========================================================
     宝箱：精英怪击杀后原地掉落（装备唯一来源）；
     开局送一个引导宝箱（在玩家附近环带）
     ========================================================= */

  /** 按分钟阶段生成一件随机装备（稀有度/等级随分钟成长）
      前期压制：稀有度按分钟硬封顶——第 1~2 分钟只有普通，
      第 3 分钟起每 3 分钟放开一档（3→精良 6→稀有 9→史诗 12→传说），
      精英/宝箱怪的稀有度加成同样不能突破封顶 */
  function rollChestItem(rarBonus) {
    const M = CFG.mon;
    const slot = G.SLOTS[Math.floor(Math.random() * G.SLOTS.length)].key;
    const maxRar = Math.min(4, Math.floor(state.wave * CFG.chests.rarCapK));
    const greed = (state.player && state.player.agg && state.player.agg.greed) || 0;  // 贪婪符
    let rar = Math.floor(state.wave * M.rarK) + (Math.random() < 0.25 ? 1 : 0) + (rarBonus || 0) + greed;
    rar = Math.min(rar, maxRar);
    const lv = Math.min(CFG.forge.maxLevel, 1 + Math.floor((state.wave - 1) / M.eqLvEvery));
    return G.buildItem(slot, Math.floor(Math.random() * G.ITEM_DEFS[slot].length), rar, lv);
  }

  /** 开局引导宝箱：相对玩家环带随机位置（避开障碍） */
  function spawnChest() {
    const W = CFG.world, C = CFG.chests, p = state.player;

    for (let tries = 0; tries < 14; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = C.minDist + Math.random() * (C.maxDist - C.minDist);
      const x = Math.max(50, Math.min(W.w - 50, (p ? p.x : W.w / 2) + Math.cos(a) * d));
      const y = Math.max(50, Math.min(W.h - 50, (p ? p.y : W.h / 2) + Math.sin(a) * d));
      if (state.obstacles.some(o => G.circlePoly(x, y, 40, o))) continue;
      if (state.sites.some(s => G.dist(x, y, s.x, s.y) < 160)) continue;
      if (state.chests.some(c => G.dist(x, y, c.x, c.y) < 200)) continue;
      state.chests.push({ x, y, opened: false, rarBonus: 0, t: Math.random() * 6, mimic: false });
      return true;
    }
    return false;
  }

  /** 精英怪击杀 → 原地掉落装备宝箱（稀有度加成）；有概率是宝箱怪 */
  function dropEliteLoot(unit) {
    const W = CFG.world;
    const x = Math.max(50, Math.min(W.w - 50, unit.x + (Math.random() * 24 - 12)));
    const y = Math.max(50, Math.min(W.h - 50, unit.y + (Math.random() * 24 - 12)));
    state.chests.push({
      x, y, opened: false, rarBonus: CFG.chests.rarBonus, t: 0,
      mimic: Math.random() < (CFG.chests.mimicChance || 0)
    });
    state.banner = {
      text: '📦 宝箱掉落',
      sub: '精英被击败 · 前去拾取宝箱（开启获得强化）',
      t: 1.4
    };
  }

  /** 玩家走近宝箱 → 开启（暂停 + 战利品弹窗） */
  function checkChests() {
    const p = state.player;
    if (!p || state.phase !== 'play') return;
    const C = CFG.chests;
    for (const c of state.chests) {
      if (c.opened) continue;
      if (G.dist(p.x, p.y, c.x, c.y) < C.pickupR) {
        openChest(c);
        return;
      }
    }
  }

  /** 开启宝箱：宝箱怪现形突袭，否则获得一次免费升级选项（装备已移除） */
  function openChest(chest) {
    chest.opened = true;
    state.chests = state.chests.filter(c => c !== chest);

    // 宝箱怪：伪装的箱子突然活过来，击杀后掉落真正的宝箱
    if (chest.mimic) {
      spawnMimic(chest);
      return;
    }

    // 宝箱 = 一次免费升级三选一（与升级共用同一套卡池与弹窗）
    G.sfxWin();
    grantChestUpgrade();
  }

  /** 宝箱奖励：+1 次免费升级选择（由 flow.update 统一弹出，与升级共用卡池） */
  function grantChestUpgrade() {
    state.pendingChestUps = (state.pendingChestUps || 0) + 1;
  }

  /* =========================================================
     宝箱怪：伪装成宝箱的怪物（走近开箱瞬间现形）
     - 强于同分钟普通怪（血 ×1.6 / 攻 ×1.1），固定近战追击
     - 击杀后原地掉落必然为真宝箱（稀有度 +1）
     ========================================================= */
  function spawnMimic(chest) {
    const m = G.makeEnemy(state.wave, state.kills);
    m.x = chest.x;
    m.y = chest.y;
    m.type = 'mimic';
    m.speed = CFG.mimic.crawl;
    m.name = '宝箱怪';
    m.emoji = '🎁';
    // 血薄攻高的刺客型突袭者（数据驱动：CFG.mimic.hpMul / atkMul）
    m.baseHp = Math.round(m.baseHp * CFG.mimic.hpMul);
    m.baseAtk = Math.round(m.baseAtk * CFG.mimic.atkMul);
    m.xp = Math.round(m.xp * 2);          // 惩罚风险，奖励经验
    m.mimic = true;
    m.lungeT = 1.1;                        // 首次跳扑延迟
    m.tele = null;
    m.dash = null;
    G.refresh(m);

    state.foes.push(m);
    state.banner = {
      text: '🎁 是宝箱怪！',
      sub: '宝箱是怪物伪装的 · 击杀它夺回真正的宝箱',
      t: 2
    };
    G.sfxBoss();
  }

  /** 宝箱怪被击杀 → 原地掉落真宝箱 */
  function dropMimicLoot(unit) {
    const W = CFG.world;
    const x = Math.max(50, Math.min(W.w - 50, unit.x));
    const y = Math.max(50, Math.min(W.h - 50, unit.y));
    state.chests.push({ x, y, opened: false, rarBonus: 1, t: 0, mimic: false });
    state.banner = {
      text: '📦 宝箱夺回',
      sub: '宝箱怪被击败 · 这次是真的',
      t: 1.6
    };
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

    const head =
      '<div class="loot-head">' +
        '<span class="loot-title">战利品</span>' +
        '<span class="loot-from">第 ' + state.wave + ' 分钟' +
          (loots.length > 1 ? ' · 共 ' + loots.length + ' 件' : '') + '</span>' +
        (allDone
          ? ''
          : '<span class="loot-hint">' + (pending > 1 ? '还有 ' + pending + ' 件待处理' : '处理后继续') + '</span>') +
        (pending > 1 ? '<button class="loot-skipall" data-act="skipall">全部放弃</button>' : '') +
      '</div>';

    box.className = 'loot show' + (loots.some(e => e.item.rarity === 4) ? ' gold' : '');
    box.innerHTML = head +
      '<div class="loot-list">' + loots.map(rowHtml).join('') + '</div>';

    // 全部处理完 → 显示「继续探索」按钮
    G.el.cards.innerHTML = '';
    if (allDone) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-again';
      btn.textContent = '继续探索';
      btn.addEventListener('click', () => continueLoot());
      G.el.cards.appendChild(btn);
    }

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

  /** 打开战利品弹窗（宝箱开启时调用；升级选项若挂起则在其后处理） */
  function showLoot(title) {
    state.phase = 'loot';
    G.el.upSub.textContent = title || '第 ' + state.wave + ' 分钟 · 处理战利品';
    G.el.curHp.textContent = G.fmt(state.player.maxHp);
    G.el.curAtk.textContent = G.fmt(state.player.atk);
    G.el.curDef.textContent = G.fmt(state.player.def);
    G.renderEqPanel();
    G.renderLoot();
    G.el.upgradeOverlay.classList.add('show');
  }

  /** 处理完战利品 → 若有挂起的升级先弹升级，否则回到战斗 */
  function continueLoot() {
    if (state.phase !== 'loot' || lootPending() > 0) return;
    G.el.upgradeOverlay.classList.remove('show');
    G.clearLoot();
    if (state.pendingLevelUps > 0) {
      G.showLevelUp();
    } else {
      state.phase = 'play';
    }
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
    } else if (plan.mode === 'upgrade' || plan.mode === 'ascend' || plan.mode === 'salvage') {
      const i = p.items.indexOf(plan.cur);
      p.items[i] = plan.next;
      text = plan.mode === 'salvage'
        ? '较弱装备拆解：<b>' + plan.next.name + '</b> 强化至 Lv.' + plan.next.level
        : plan.mode === 'upgrade'
          ? '<b>' + plan.next.name + '</b> 强化至 Lv.' + plan.next.level
          : '<b>' + plan.next.name + '</b> 升华至 ' + rarOf(plan.next.rarity).name + ' · Lv.1';
    } else if (plan.mode === 'reject') {
      text = '新装较弱，已拆解丢弃';
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
    rollChestItem, spawnChest, dropEliteLoot, checkChests, openChest,
    spawnMimic, dropMimicLoot, grantChestUpgrade,
    lootPending, itemScore, planFor, renderLoot,
    takeLoot, skipLoot, skipAll, clearLoot,
    showLoot, continueLoot
  });
})(window.ABYSS = window.ABYSS || {});
