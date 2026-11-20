/* ============================================================
   UI 层 · ui.js
   DOM 引用、顶栏同步、右侧属性侧边栏、结算弹窗
   （装备模块已移除：侧边栏只显示属性与能力，占据更大空间）
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG } = G;

  const el = {};

  function initDom() {
    [
      'canvas', 'waveNum', 'lvNum', 'xpFill', 'mapName', 'recordNum', 'soundBtn', 'restartBtn',
      'statHp', 'statAtk', 'statDef', 'eqRow', 'hintBar', 'eqSide', 'dmgSide',
      'upgradeOverlay', 'upSub', 'lootBox', 'cards', 'curHp', 'curAtk', 'curDef', 'eqPanel',
      'eventOverlay', 'eventIcon', 'eventTitle', 'eventText', 'eventOpts',
      'overOverlay', 'overWave', 'overKiller', 'overHp', 'overAtk', 'overDef', 'overEq', 'overKills', 'overBest', 'againBtn', 'overDmg'
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
      Math.round(p.atk), Math.round(p.def), p.items.length,
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
    switch (k) {
      case 'arrow': return p.shots + ' 支/轮 · ' + (G.CFG.player.atkCd * p.atkCdMul).toFixed(2) + 's/发' +
        (p.pierce ? ' · 穿透' + p.pierce : '') + (p.bounce ? ' · 弹射' + p.bounce : '') + (p.splitN ? ' · 分裂×' + p.splitN : '');
      case 'chain': return s.chain.mult.toFixed(2) + '× 伤害 · ' + s.chain.cd.toFixed(1) + 's · ' + s.chain.jumps + ' 跳 · ' + s.chain.bolts + ' 道';
      case 'shock': return s.shock.mult.toFixed(2) + '× · 半径 ' + Math.round(s.shock.r) + ' · ' + s.shock.cd.toFixed(1) + 's' + (s.shock.echo ? ' · 次级×' + s.shock.echo : '');
      case 'orbit': return s.orbit.count + ' 枚 · 每 ' + s.orbit.interval.toFixed(1) + 's 展开 ' + s.orbit.dur.toFixed(1) + 's · 半径 ' + Math.round(s.orbit.r);
      case 'drone': return s.drone.count + ' 座 · ' + s.drone.mult.toFixed(2) + '× · 存活 ' + s.drone.life.toFixed(1) + 's · 每 ' + s.drone.interval.toFixed(1) + 's 部署';
      case 'mine': return s.mine.count + ' 枚 · ' + s.mine.mult.toFixed(2) + '× · 每 ' + s.mine.cd.toFixed(1) + 's · 半径 ' + Math.round(s.mine.r);
    }
    return '';
  }

  function syncEqPanel() {
    const p = state.player;
    const box = el.eqSide;
    if (!box || !p) return;

    // 变化签名：技能解锁/维度/全局冷却（命中即重建，否则跳过写 DOM）
    const skSig = p.skills ? Object.keys(p.skills).map(k => k + (p.skills[k] ? 1 : 0)).join('') + '|' +
      (p.sd ? JSON.stringify(p.sd) : '') + '|' + (p.cdr || 0) : '';
    if (skSig === lastEqSig) return;
    lastEqSig = skSig;

    let html =
      '<div class="eq-side-head">🗡️ 攻击方式<small>LV.' + p.level + '</small></div>' +
      '<div class="skill-blocks">';
    const lineMeta = { arrow: ['🏹', '箭矢'], chain: ['⚡', '连锁闪电'], shock: ['💥', '震荡波'], orbit: ['🌀', '环绕飞刃'], drone: ['🔮', '浮游炮'], mine: ['🧨', '感应地雷'] };
    G.LINE_KEYS.forEach(k => {
      if (!p.skills[k]) return;
      const sd = (p.sd && p.sd[k]) || {};
      const totalLv = G.LINES[k].dims.reduce((n, d) => n + (sd[d.key] || 0), 0);
      html += '<div class="skill-block">' +
        '<div class="sk-head">' + lineMeta[k][0] + ' ' + lineMeta[k][1] + '<small>Lv.' + totalLv + '</small></div>' +
        '<div class="sk-sum">' + lineSummary(k, p) + '</div>' +
        '<div class="sk-dims">' +
        G.LINES[k].dims.map(d =>
          '<span class="sk-dim' + (sd[d.key] ? ' on' : '') + '" title="' + d.eff(sd[d.key] || 0) + '">' +
          d.name + '<b>' + (sd[d.key] || 0) + '</b></span>'
        ).join('') +
        '</div></div>';
    });
    if (p.cdr) html += '<div class="sk-cdr">⏱️ 全局冷却：所有攻击间隔 −' + p.cdr * 10 + '%</div>';
    html += '</div>';

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

    const A = p.agg || { crit: 0, critMult: 1.6, frost: 0, thorn: 0, bulwark: 0, pierce: 0, swiftstep: 0, haste: 0, regen: 0, bleed: null, guard: 0 };
    const dmgSig = DMG_META.map(m => Math.round(stats[m[0]] || 0)).join(',');
    const sig = [
      Math.round(p.maxHp), Math.round(p.hp), Math.round(p.atk), Math.round(p.def),
      Math.round(p.range), p.luck, (p.xpMul || 1).toFixed(2), p.shield || 0,
      A.crit, A.frost, A.thorn, A.bulwark, A.swiftstep, A.regen, A.guard,
      A.execute, A.rend, A.splash, A.dodge, A.shock, A.charger, A.eagle, A.tough,
      A.clarity, A.hastestone, A.resonance, A.greed, p.cardSlow, p.critEvery,
      p.shieldEvery, dmgSig
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

    // —— 装备/卡片词条 ——
    const extras = [];
    if (A.haste) extras.push(['💨', '受击加速', '+' + A.haste + '%']);
    if (A.frost) extras.push(['❄️', '霜刃减速', A.frost + '%']);
    if (A.thorn) extras.push(['🌵', '反伤', A.thorn]);
    if (A.bulwark) extras.push(['🐉', '减伤', A.bulwark + '%']);
    if (A.pierce) extras.push(['🔮', '破甲', A.pierce + '%']);
    if (A.swiftstep) extras.push(['👟', '移速', '+' + A.swiftstep + '%']);
    if (A.regen) extras.push(['🌿', '回复', A.regen + '/s']);
    if (A.guard) extras.push(['🛡️', '护盾上限', A.guard]);
    if (A.crit) extras.push(['💥', '暴击', '每' + A.crit + '发×' + A.critMult.toFixed(1)]);
    if (A.bleed) extras.push(['🗡️', '流血', A.bleed.dmg + '×' + A.bleed.turns + 's']);
    if (A.execute) extras.push(['🦴', '处决', '+' + A.execute + '%']);
    if (A.rend) extras.push(['🔪', '裂甲', A.rend + '%']);
    if (A.splash) extras.push(['🔊', '溅射', A.splash + '%']);
    if (A.dodge) extras.push(['🌑', '闪避', A.dodge + '%']);
    if (A.shock) extras.push(['⚡', '余震', A.shock]);
    if (A.charger) extras.push(['🔋', '回盾', A.charger + '/s']);
    if (A.eagle) extras.push(['🦅', '暴伤', '+' + A.eagle + '%']);
    if (A.tough) extras.push(['🧱', '濒死减伤', A.tough + '%']);
    if (A.clarity) extras.push(['🧠', '经验', '+' + A.clarity + '%']);
    if (A.hastestone) extras.push(['⏩', '攻速符', '+' + A.hastestone + '%']);
    if (A.resonance) extras.push(['🎼', '技能', '+' + A.resonance + '%']);
    if (A.greed) extras.push(['💎', '稀有度', '+' + A.greed]);
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
    ['orbit', '🌀', '环绕飞刃'], ['drone', '🔮', '浮游炮'], ['mine', '🧨', '感应地雷']
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
    el.overEq.textContent = p ? p.items.length : 0;
    el.overKills.textContent = '击败 ' + state.kills + ' 个敌人';
    el.overBest.textContent = '最佳纪录：存活 ' + state.best + ' 分钟';
    // 输出统计：各攻击方式伤害占比
    if (el.overDmg) el.overDmg.innerHTML =
      '<div class="over-dmg-title">📊 输出统计</div>' + dmgRowsHtml(state.dmgStats || {});
    el.overOverlay.classList.add('show');
  }

  Object.assign(G, { ui: { initDom, syncTopbar, syncEqPanel, syncDmgPanel, showGameOver, dmgRowsHtml } });
})(window.ABYSS = window.ABYSS || {});
