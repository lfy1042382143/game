/* ============================================================
   UI 层 · ui.js
   DOM 引用、顶栏同步、右侧属性侧边栏、结算弹窗
   （装备模块已移除：侧边栏只显示属性与能力，占据更大空间）
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG } = G;

  const el = {};

  /** 武器线显示元数据（图标/名字直接取自 LINES，增删武器线无需改 UI） */
  function lineMetaOf() {
    const map = {};
    (G.LINE_KEYS || []).forEach(k => { map[k] = [G.LINES[k].icon, G.LINES[k].name]; });
    return map;
  }

  function initDom() {
    [
      'canvas', 'waveNum', 'lvNum', 'xpFill', 'mapName', 'recordNum', 'soundBtn', 'restartBtn', 'buildBtn',
      'statHp', 'statAtk', 'statDef', 'hintBar', 'eqSide', 'dmgSide',
      'startOverlay', 'startCards',
      'upgradeOverlay', 'upSub', 'cards', 'curHp', 'curAtk', 'curDef',
      'eventOverlay', 'eventIcon', 'eventTitle', 'eventText', 'eventOpts',
      'buildOverlay', 'buildSub', 'buildList', 'buildClose',
      'overOverlay', 'overWave', 'overKiller', 'overHp', 'overAtk', 'overDef', 'overKills', 'overBest', 'againBtn', 'overDmg'
    ].forEach(id => { el[id] = G.$(id); });

    G.el = el;
  }

  /* =========================================================
     顶栏同步（每次状态变化后调用，仅在数值变化时写 DOM）
     ========================================================= */
  let lastSnap = '';

  function syncTopbar() {
    const p = state.player;
    if (!p) return;
    const need = G.xpNeed(p.level);
    const snap = [
      state.wave, Math.round(p.hp), Math.round(p.maxHp),
      Math.round(p.atk), Math.round(p.def),
      p.level, Math.round(p.xp), state.mapIdx
    ].join('|');
    if (snap === lastSnap) return;
    lastSnap = snap;

    el.waveNum.textContent = String(state.wave).padStart(2, '0');
    el.lvNum.textContent = p.level;
    el.xpFill.style.width = Math.min(100, p.xp / need * 100) + '%';
    if (el.mapName) el.mapName.textContent = G.MAPS[state.mapIdx].name;
    if (el.statHp) {
      el.statHp.textContent = Math.max(0, Math.round(p.hp)) + '/' + Math.round(p.maxHp);
      el.statAtk.textContent = Math.round(p.atk);
      el.statDef.textContent = Math.round(p.def);
    }
    el.recordNum.textContent = state.best;
    // 顶部属性/装备行已移除：三维与装备统一在右侧边栏显示

    syncEqPanel();
    syncDmgPanel();
  }

  /* =========================================================
     右侧栏：只展示攻击方式（每条线独立分块 + 实时参数摘要 + 维度等级）
     ========================================================= */
  let lastEqSig = '';

  /** 每条线的实时参数摘要（一行小字，随维度变化） */
  function lineSummary(k, p) {
    const s = p.sk;
    const isUlt = !!(p.evolved && p.evolved[k]);
    const ultTag = (isUlt && G.ULT && G.ULT[k])
      ? ' <b style="color:#fbbf24">★' + G.ULT[k].name + '</b>' : '';
    let txt = '';
    switch (k) {
      case 'arrow': txt = p.shots + ' 支/轮 · ' + (G.CFG.player.atkCd * p.atkCdMul).toFixed(2) + 's/发' +
        (p.pierce ? ' · 穿透' + p.pierce : '') + (p.bounce ? ' · 弹射' + p.bounce : ''); break;
      case 'chain': txt = s.chain.mult.toFixed(2) + '× 伤害 · ' + s.chain.cd.toFixed(1) + 's · ' + s.chain.jumps + ' 跳 · ' + s.chain.bolts + ' 道'; break;
      case 'shock': txt = s.shock.mult.toFixed(2) + '× · 半径 ' + Math.round(s.shock.r) + ' · ' + s.shock.cd.toFixed(1) + 's' + (s.shock.echo ? ' · 次级×' + s.shock.echo : ''); break;
      case 'orbit': txt = s.orbit.count + ' 枚 · ' + (s.orbit.ultPersistent ? '<b style="color:#fbbf24">常驻</b>' : '每 ' + s.orbit.interval.toFixed(1) + 's 展开 ' + s.orbit.dur.toFixed(1) + 's') + ' · 半径 ' + Math.round(s.orbit.r); break;
      case 'drone': txt = s.drone.count + ' 座 · ' + s.drone.mult.toFixed(2) + '× · ' + (s.drone.ultPersistent ? '<b style="color:#fbbf24">常驻</b>' : '存活 ' + s.drone.life.toFixed(1) + 's · 每 ' + s.drone.interval.toFixed(1) + 's 部署'); break;
      case 'fireball': txt = s.fireball.count + ' 颗 · ' + s.fireball.mult.toFixed(2) + '× · 半径 ' + Math.round(s.fireball.r) + ' · 每 ' + s.fireball.cd.toFixed(1) + 's'; break;
      case 'boomerang': txt = s.boomerang.count + ' 把 · ' + s.boomerang.mult.toFixed(2) + '× · 穿透' + s.boomerang.pierce + ' · ' + s.boomerang.legs + ' 段'; break;
    }
    return txt + ultTag;
  }

  function syncEqPanel() {
    const p = state.player;
    const box = el.eqSide;
    if (!box || !p) return;

    const B = G.BUILD || {};
    const hasBuild = !!(p.weapons && p.passives);
    // 变化签名：构筑等级（命中即重建，否则跳过写 DOM）
    const evoSig = p.evolved ? Object.keys(p.evolved).filter(k => p.evolved[k]).sort().join(',') : '';
    const skSig = hasBuild
      ? 'B|' + JSON.stringify(p.weapons) + '|' + JSON.stringify(p.passives) + '|' + evoSig
      : (p.sd ? JSON.stringify(p.sd) : '') + '|' + (p.cdr || 0) + '|' + evoSig;
    if (skSig === lastEqSig) return;
    lastEqSig = skSig;

    let html = '';
    if (hasBuild) {
      // VS 构筑展示：武器槽（含等级/进化配方）+ 被动槽
      const lineMeta = lineMetaOf();
      html += '<div class="eq-side-head">⚔ 武器构筑<small>LV.' + p.level + '</small></div>';
      html += '<div class="eq-section-title">武器 ' + G.weaponCount(p) + '/' + B.WEAPON_SLOTS + '</div>' +
        '<div class="skill-blocks">';
      G.LINE_KEYS.forEach(k => {
        const lv = G.weaponLevel(p, k);
        if (lv <= 0) return;
        const isUlt = !!(p.evolved && p.evolved[k]);
        const recipe = (B.EVOLVE_RECIPE || {})[k];
        const rP = recipe && B.PASSIVES[recipe];
        const canEvolve = lv >= B.WEAPON_MAX && rP && G.passiveLevel(p, recipe) >= B.PASSIVE_MAX;
        html += '<div class="skill-block' + (isUlt ? ' ultimate' : '') + '">' +
          '<div class="sk-head">' + lineMeta[k][0] + ' ' + lineMeta[k][1] + (isUlt ? ' <b style="color:#fbbf24">★超级</b>' : '') +
          '<small>Lv.' + lv + '/' + B.WEAPON_MAX + '</small></div>' +
          '<div class="sk-sum">' + lineSummary(k, p) + '</div>' +
          '<div class="sk-evo">' + (isUlt ? '★ ' + (G.ULT[k] ? G.ULT[k].name : '超级武器')
            : rP ? '配方：' + rP.name + ' 满级 → 进化' + (canEvolve ? '（就绪）' : '') : '') + '</div>' +
          '</div>';
      });
      html += '</div>';
      html += '<div class="eq-section-title">被动道具 ' + G.passiveCount(p) + '/' + B.PASSIVE_SLOTS + '</div>' +
        '<div class="skill-blocks">';
      (B.PASSIVE_IDS || []).forEach(id => {
        const lv = G.passiveLevel(p, id);
        if (lv <= 0) return;
        const P = B.PASSIVES[id];
        html += '<div class="skill-block passive-block">' +
          '<div class="sk-head">' + P.icon + ' ' + P.name + '<small>Lv.' + lv + '/' + B.PASSIVE_MAX + '</small></div>' +
          '<div class="sk-sum">' + P.desc + '</div></div>';
      });
      html += '</div>';
      if (p.cdr || p.taskCdr || p.pasCdr) html += '<div class="sk-cdr">⏱️ 全局冷却 −' + Math.round((1 - Math.pow(0.9, (p.cdr || 0) + (p.taskCdr || 0)) * Math.pow(0.95, p.pasCdr || 0)) * 100) + '%</div>';
    } else {
      // 兼容回退：旧维度展示
      html = '<div class="eq-side-head">🗡️ 攻击方式<small>LV.' + p.level + '</small></div><div class="skill-blocks">';
      const lineMeta = lineMetaOf();
      G.LINE_KEYS.forEach(k => {
        if (!p.skills[k]) return;
        const sd = (p.sd && p.sd[k]) || {};
        const totalLv = G.LINES[k].dims.reduce((n, d) => n + (sd[d.key] || 0), 0);
        const isUlt = !!(p.evolved && p.evolved[k]);
        html += '<div class="skill-block' + (isUlt ? ' ultimate' : '') + '">' +
          '<div class="sk-head">' + lineMeta[k][0] + ' ' + lineMeta[k][1] + (isUlt ? ' <b style="color:#fbbf24">★</b>' : '') + '<small>Lv.' + totalLv + '</small></div>' +
          '<div class="sk-sum">' + lineSummary(k, p) + '</div></div>';
      });
      html += '</div>';
    }

    box.innerHTML = html;
  }

  /* =========================================================
     左侧栏：玩家属性（三维/幸运等）+ 输出统计
     ========================================================= */
  function syncDmgPanel() {
    const p = state.player;
    const stats = state.dmgStats;
    const box = el.dmgSide;
    if (!box || !p || !stats) return;

    const dmgSig = DMG_META.map(m => Math.round(stats[m[0]] || 0)).join(',');
    const sig = [
      Math.round(p.maxHp), Math.round(p.hp), Math.round(p.atk), Math.round(p.def),
      Math.round(p.range), p.luck, (p.xpMul || 1).toFixed(2), p.shield || 0,
      p.cardSlow, p.critEvery, p.shieldEvery, dmgSig
    ].join('|');
    if (sig === lastDmgSig) return;
    lastDmgSig = sig;

    // —— 三维 + 基础属性 ——
    let html =
      '<div class="eq-side-head">🧬 属性<small>LV.' + p.level + '</small></div>' +
      '<div class="core-stats">' +
        '<span class="core-stat hp"><i>❤</i><b>' + Math.max(0, Math.round(p.hp)) + '</b><small>/ ' + Math.round(p.maxHp) + ' 生命</small></span>' +
        '<span class="core-stat atk"><i>⚔</i><b>' + Math.round(p.atk) + '</b><small>攻击</small></span>' +
        '<span class="core-stat def"><i>🛡</i><b>' + Math.round(p.def) + '</b><small>防御</small></span>' +
      '</div>' +
      '<div class="eq-side-stats">' +
        '<span class="eq-stat"><i>📡</i><b>' + Math.round(p.range) + '</b><small>射程</small></span>' +
        '<span class="eq-stat"><i>🍀</i><b>' + (p.luck || 0) + '</b><small>幸运</small></span>';
    if (p.xpMul > 1) html += '<span class="eq-stat"><i>✨</i><b>+' + Math.round((p.xpMul - 1) * 100) + '%</b><small>经验</small></span>';
    if (p.shield > 0) html += '<span class="eq-stat"><i>🔵</i><b>' + Math.round(p.shield) + '</b><small>护盾</small></span>';

    // —— 卡片词条（装备词条已移除）——
    const extras = [];
    if (p.critEvery) extras.push(['💥', '节拍暴击', '每' + p.critEvery + '发×' + p.critMult.toFixed(1)]);
    if (p.cardSlow) extras.push(['🕸️', '减速箭', '−' + Math.round(p.cardSlow * 18) + '%']);
    if (p.shieldEvery) extras.push(['🔵', '护盾恢复', p.shieldVal + '/' + p.shieldEvery + 's']);
    extras.slice(0, 12).forEach(e => {
      html += '<span class="eq-stat"><i>' + e[0] + '</i><small>' + e[1] + '</small><b>' + e[2] + '</b></span>';
    });
    html += '</div>';

    // —— 输出统计 ——
    html += '<div class="eq-side-head">📊 输出统计</div>' +
      '<div class="dmg-sub">各攻击方式累计伤害</div>' +
      dmgRowsHtml(stats);

    box.innerHTML = html;
  }

  let lastDmgSig = '';

  /* =========================================================
     输出统计（右侧栏 + 结算弹窗共用）
     ========================================================= */
  const DMG_META = [
    ['arrow', '🏹', '箭矢'], ['chain', '⚡', '连锁闪电'], ['shock', '💥', '震荡波'],
    ['orbit', '🌀', '环绕飞刃'], ['drone', '🔮', '浮游炮'],
    ['fireball', '🔥', '火球'], ['boomerang', '🪃', '回旋镖']
  ];

  function dmgRowsHtml(dmg) {
    const total = DMG_META.reduce((n, m) => n + (dmg[m[0]] || 0), 0) || 1;
    return '<div class="dmg-list">' + DMG_META.map(m => {
      const raw = dmg[m[0]] || 0;
      const v = G.fmt(Math.round(raw));
      const pct = Math.round(raw / total * 100);
      return '<div class="dmg-row">' +
        '<span class="dmg-ic">' + m[1] + '</span><span class="dmg-nm">' + m[2] + '</span>' +
        '<div class="dmg-bar"><div class="dmg-fill" style="width:' + pct + '%"></div></div>' +
        '<b class="dmg-val">' + v + '</b><small class="dmg-pct">' + pct + '%</small>' +
        '</div>';
    }).join('') + '</div>';
  }

  /* =========================================================
     结算弹窗
     ========================================================= */
  function showGameOver() {
    const p = state.player;
    el.overWave.textContent = state.wave;
    const killer = state.foes.find(f => !f.dead);
    el.overKiller.textContent = '被「' + (killer ? killer.name : '深渊') + '」击败';
    el.overHp.textContent = Math.round(p ? p.maxHp : 0);
    el.overAtk.textContent = Math.round(p ? p.atk : 0);
    el.overDef.textContent = Math.round(p ? p.def : 0);
    el.overKills.textContent = '击败 ' + state.kills + ' 个敌人';
    el.overBest.textContent = '最佳纪录：存活 ' + state.best + ' 分钟';
    // 输出统计：各攻击方式伤害占比
    if (el.overDmg) el.overDmg.innerHTML =
      '<div class="over-dmg-title">📊 输出统计</div>' + dmgRowsHtml(state.dmgStats || {});
    el.overOverlay.classList.add('show');
  }

  /* =========================================================
     构筑总览面板（小屏侧栏隐藏时的替代入口，桌面也可用）
     打开时暂停游戏，关闭后恢复；仅在 play 阶段可打开
     ========================================================= */
  let buildPaused = false;

  function buildRowsHtml(p) {
    const rows = [];
    const evoKeys = p.evolved ? Object.keys(p.evolved).filter(k => p.evolved[k]) : [];
    // 武器
    rows.push('<div class="eq-section-title">武器 ' + G.weaponCount(p) + '/' + (G.BUILD.WEAPON_SLOTS || 4) +
      (evoKeys.length ? ' · ★ 超级武器 ×' + evoKeys.length : '') + '</div>');
    (G.LINE_KEYS || Object.keys(G.LINES || {})).forEach(k => {
      const meta = G.LINES[k];
      const lv = G.weaponLevel(p, k);
      if (!lv) return;
      const isUlt = !!(p.evolved && p.evolved[k]);
      rows.push('<div class="build-row' + (isUlt ? ' build-ult' : '') + '">' +
        '<span class="b-ic">' + meta.icon + '</span>' +
        '<span class="b-nm">' + meta.name + (isUlt ? ' · 进化' : '') + '</span>' +
        '<span class="b-lv">Lv.' + lv + '</span></div>');
    });
    // 被动
    rows.push('<div class="eq-section-title">被动 ' + G.passiveCount(p) + '/' + (G.BUILD.PASSIVE_SLOTS || 4) + '</div>');
    const P = (G.BUILD && G.BUILD.PASSIVES) || {};
    Object.keys(P).forEach(id => {
      const lv = G.passiveLevel(p, id);
      if (!lv) return;
      rows.push('<div class="build-row">' +
        '<span class="b-ic">' + P[id].icon + '</span>' +
        '<span class="b-nm">' + P[id].name + '</span>' +
        '<span class="b-lv">Lv.' + lv + '</span></div>');
    });
    return rows.join('');
  }

  function showBuildPanel() {
    const p = state.player;
    if (!p || state.phase !== 'play' || state.paused) return;
    if (el.buildSub) {
      const evoKeys = p.evolved ? Object.keys(p.evolved).filter(k => p.evolved[k]) : [];
      const evoNames = evoKeys.map(k => G.ULT[k] ? G.ULT[k].name : G.LINES[k].name).join(' · ');
      el.buildSub.textContent = '武器 ' + G.weaponCount(p) + '/' + (G.BUILD.WEAPON_SLOTS || 4) +
        ' · 被动 ' + G.passiveCount(p) + '/' + (G.BUILD.PASSIVE_SLOTS || 4) +
        (evoKeys.length ? ' · ★ ' + evoNames : '');
    }
    if (el.buildList) el.buildList.innerHTML = buildRowsHtml(p);
    el.buildOverlay.classList.add('show');
    buildPaused = true;
    state.paused = true;   // 面板打开时暂停战斗，防误触
  }

  function hideBuildPanel() {
    if (!el.buildOverlay.classList.contains('show')) return;
    el.buildOverlay.classList.remove('show');
    if (buildPaused) { state.paused = false; buildPaused = false; }
  }

  /* =========================================================
     开局选武器：全部攻击线任选其一（数量/内容全部数据驱动）
     - 卡片、配色、定位、数值、进化路线均读武器定义与构筑表
     - 新增武器只需在 LINES 加一条，这里无需改动
     ========================================================= */
  function showStartSelect() {
    state.phase = 'select';
    if (!el.startCards) return;
    el.startCards.innerHTML = '';
    const keys = G.LINE_KEYS || Object.keys(G.LINES || {});
    const build = G.BUILD || {};
    const recipes = build.EVOLVE_RECIPE || {};
    const passives = build.PASSIVES || {};
    const ults = G.ULT || {};
    let picking = false;   // 点击反馈期间防止重复开局

    keys.forEach((k, i) => {
      const meta = (G.LINES || {})[k];
      if (!meta) return;
      const node = document.createElement('div');
      node.className = 'start-card';
      node.style.setProperty('--c', meta.color || '#f5c451');
      node.style.animationDelay = (i * 0.045).toFixed(3) + 's';   // 入场节奏随卡片数量自适应

      const stats = (meta.stats && meta.stats.length)
        ? '<div class="sc-stats">' + meta.stats.map(v => '<span class="sc-stat">' + v + '</span>').join('') + '</div>'
        : '';
      const recipe = recipes[k];
      const pas = recipe ? passives[recipe] : null;
      const ult = ults[k];
      const evo = (pas && ult)
        ? '<div class="sc-evo"><span>满级 + ' + pas.name + '</span><b>→</b><span>' + ult.name + '</span></div>'
        : '';
      const fallback = String(meta.unlockDesc || '').replace(/^解锁[^：]*：/, '');

      node.innerHTML =
        '<div class="sc-top"><span class="sc-icon">' + meta.icon + '</span><span class="sc-name">' + meta.name + '</span></div>' +
        '<div class="sc-role">' + (meta.tagline || fallback) + '</div>' +
        stats + evo;

      node.addEventListener('click', () => {
        if (state.phase !== 'select' || picking) return;
        picking = true;
        node.classList.add('picked');
        window.setTimeout(() => {
          el.startOverlay.classList.remove('show');
          G.startRun(k);
          if (G.tone) G.tone({ freq: 720, type: 'sine', dur: 0.16, vol: 0.1 });
        }, 110);
      });
      el.startCards.appendChild(node);
    });
    el.startOverlay.classList.add('show');
  }

  Object.assign(G, { ui: { initDom, syncTopbar, syncEqPanel, syncDmgPanel, showGameOver, dmgRowsHtml, showStartSelect, showBuildPanel, hideBuildPanel } });
})(window.ABYSS = window.ABYSS || {});
