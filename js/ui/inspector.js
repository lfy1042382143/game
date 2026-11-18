/* ============================================================
   表现层 · inspector.js
   角色 / 怪物属性详情面板：基础值、装备加成、成型属性、
   生效中的词条、对抗预估，以及四个部位的装备明细
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG, SLOTS, state, el, $, fmt, rarOf, itemAt, itemDesc, defendValue, shieldCap } = G;

  const iv = {
    overlay: $('inspectOverlay'),
    panel: $('inspectPanel'),
    close: $('insClose'),
    avatar: $('insAvatar'),
    kicker: $('insKicker'),
    name: $('insName'),
    sub: $('insSub'),
    stats: $('insStats'),
    traits: $('insTraits'),
    duel: $('insDuel'),
    items: $('insItems'),
    count: $('insEqCount')
  };

  let current = null;      // 'ally' | 'foe' | { foe: unit }
  let timer = null;
  let lastSig = '';
  let currentFoe = null;   // 当前查看的敌人单位（foe 面板用）

  /* ---------- 取单位 ---------- */
  function unitOf(key) {
    if (key === 'ally') return state.player;
    if (key === 'foe') return currentFoe || state.foes[state.target] || state.foes[0];
    if (key && typeof key === 'object' && key.foe) return key.foe;
    return state.player;
  }

  /* ---------- 单次攻击伤害（无随机浮动；暴击按节拍折算成精确均值） ---------- */
  function hitDamage(att, def) {
    const effDef = def.def * (1 - Math.min(60, att.agg.pierce) / 100);
    let d = Math.max(att.atk - effDef, att.atk * 0.15);
    if (def.agg.bulwark > 0) d *= 1 - Math.min(60, def.agg.bulwark) / 100;
    const a = att.agg;
    if (a.crit > 0) d *= 1 + (a.critMult - 1) / a.crit;   // N 击里 1 击暴击，均值可精确算出
    return Math.max(1, Math.round(d));
  }

  /* ---------- 属性三段式：基础 + 装备 = 合计 ---------- */
  function statRow(label, icon, base, flat, total) {
    const plus = flat > 0 ? '+' + fmt(flat) : '—';
    return '<div class="ins-row">' +
      '<span class="ins-row-k"><i>' + icon + '</i>' + label + '</span>' +
      '<span class="ins-row-base">' + fmt(base) + '</span>' +
      '<span class="ins-row-plus">' + plus + '</span>' +
      '<span class="ins-row-total">' + fmt(total) + '</span>' +
    '</div>';
  }

  function renderStats(u) {
    const a = u.agg;
    iv.stats.innerHTML =
      '<div class="ins-row ins-row-head">' +
        '<span class="ins-row-k">属性</span>' +
        '<span class="ins-row-base">基础</span>' +
        '<span class="ins-row-plus">装备</span>' +
        '<span class="ins-row-total">合计</span>' +
      '</div>' +
      statRow('生命', '❤', u.baseHp, a.hpFlat, u.maxHp) +
      statRow('攻击', '⚔', u.baseAtk, a.atkFlat, u.atk) +
      statRow('防御', '🛡', u.baseDef, a.defFlat, u.def);
  }

  /* ---------- 生效中的战斗参数 ---------- */
  function renderTraits(u) {
    const a = u.agg;
    const cap = shieldCap(u);
    const list = [];

    list.push(['护盾', fmt(u.shield) + ' / ' + fmt(cap), u.shield > 0 ? 'on' : '']);

    if (u.bleed) list.push(['流血', u.bleed.dmg + ' × ' + u.bleed.turns + ' 回合', 'bad']);
    if (a.bleed) list.push(['附加流血', a.bleed.dmg + ' × ' + a.bleed.turns + ' 回合', '']);
    if (a.crit > 0) {
      const left = a.crit - ((u.strikes || 0) % a.crit);
      list.push(['暴击节拍', '每 ' + a.crit + ' 击 ×' + a.critMult + ' · 还差 ' + left + ' 击', '']);
    }
    if (a.leech > 0) list.push(['吸血', Math.round(a.leech) + '%', '']);
    if (a.thorn > 0) list.push(['反伤', fmt(a.thorn), '']);
    if (a.bulwark > 0) list.push(['减伤', Math.round(a.bulwark) + '%', '']);
    if (a.vamp > 0) list.push(['受伤回复', Math.round(a.vamp) + '%', '']);
    if (a.dotres > 0) list.push(['抗流血', Math.round(a.dotres) + '%', '']);
    if (a.pierce > 0) list.push(['破甲', Math.round(a.pierce) + '%', '']);
    if (a.guard > 0) list.push(['防御额外盾', '+' + Math.round(a.guard), '']);
    if (a.shieldstart > 0) list.push(['开局护盾', '+' + Math.round(a.shieldstart) + ' · 整波保留', 'on']);
    list.push(['防御护盾', '+' + defendValue(u), '']);
    if (u.isMon) list.push(['举盾节奏', u.guardUsed + ' / ' + (a.guard > 0 ? 3 : 2) + ' 次' + (a.guard > 0 ? '（壁垒甲 +1）' : ''), '']);

    iv.traits.innerHTML = list.map(([k, v, cls]) =>
      '<div class="ins-trait ' + cls + '"><span>' + k + '</span><b>' + v + '</b></div>'
    ).join('');
  }

  /* ---------- 对抗预估（始终以玩家视角，便于判断该不该换装） ---------- */
  function renderDuel() {
    const me = state.player;
    const other = currentFoe || state.foes[state.target] || state.foes[0];
    if (!me || !other) { iv.duel.innerHTML = ''; return; }

    const toOther = hitDamage(me, other);
    const toMe = hitDamage(other, me);
    const hitsNeed = Math.ceil(other.hp / Math.max(1, toOther));
    const hitsSurvive = Math.ceil((me.hp + me.shield) / Math.max(1, toMe));

    iv.duel.innerHTML =
      '<div class="ins-duel-label">对抗预估 · 第 ' + state.wave + ' 波</div>' +
      '<div class="ins-duel-row">' +
        '<span>你每击造成</span><b>' + toOther + '</b>' +
        '<span>击杀需要</span><b>' + hitsNeed + ' 击</b>' +
      '</div>' +
      '<div class="ins-duel-row warn">' +
        '<span>敌方每击造成</span><b>' + toMe + '</b>' +
        '<span>你还能撑</span><b>' + hitsSurvive + ' 击</b>' +
      '</div>';
  }

  /* ---------- 装备明细 ---------- */
  function renderItems(u) {
    const filled = u.items.length;
    iv.count.textContent = filled + ' / ' + SLOTS.length;

    iv.items.innerHTML = SLOTS.map(slot => {
      const it = itemAt(u, slot.key);
      if (!it) {
        return '<div class="ins-item empty">' +
          '<div class="ins-item-ic">' + slot.icon + '</div>' +
          '<div class="ins-item-body">' +
            '<div class="ins-item-top"><span class="ins-item-name">' + slot.name + ' · 空置</span></div>' +
            '<div class="ins-item-eff">该部位尚未装备</div>' +
          '</div>' +
        '</div>';
      }
      const rar = rarOf(it.rarity);
      return '<div class="ins-item" style="--c:' + rar.c + '">' +
        '<div class="ins-item-ic">' + it.icon + '</div>' +
        '<div class="ins-item-body">' +
          '<div class="ins-item-top">' +
            '<span class="ins-item-name">' + it.name + '</span>' +
            '<span class="ins-item-lv" style="color:' + rar.c + '">Lv.' + it.level + '</span>' +
            '<span class="ins-item-rar" style="color:' + rar.c + '">' + rar.name + ' · ' + it.slotName + '</span>' +
          '</div>' +
          '<div class="ins-item-eff">' + itemDesc(it) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ---------- 头部 ---------- */
  function renderHead(u, key) {
    if (key === 'foe') {
      iv.avatar.textContent = u.emoji || '👹';
      iv.kicker.textContent = u.boss ? '敌方 · BOSS' : '敌方';
      iv.name.textContent = u.name || '未知敌人';
      iv.sub.innerHTML = '第 <b>' + state.wave + '</b> 波' +
        (u.boss ? ' · <span class="ins-boss">首领</span>' : '') +
        ' · 剩余 ' + fmt(u.hp) + ' / ' + fmt(u.maxHp);
      iv.panel.classList.add('foe-side');
    } else {
      iv.avatar.textContent = el.allyAvatar.textContent || '⚔️';
      iv.kicker.textContent = '我方';
      iv.name.textContent = '冒险者';
      iv.sub.innerHTML = '第 <b>' + state.wave + '</b> 波 · 生命 ' + fmt(u.hp) + ' / ' + fmt(u.maxHp);
      iv.panel.classList.remove('foe-side');
    }
  }

  /* ---------- 全量渲染 ---------- */
  function render() {
    const u = unitOf(current);
    if (!u) return;
    lastSig = signature(u);
    renderHead(u, current);
    renderStats(u);
    renderTraits(u);
    renderDuel();
    renderItems(u);
  }

  function signature(u) {
    return [
      u.hp, u.maxHp, u.atk, u.def, u.shield,
      u.bleed ? u.bleed.dmg + 'x' + u.bleed.turns : '-',
      u.items.map(i => i.name + i.rarity + 'L' + i.level).join(',')
    ].join('|');
  }

  /* ---------- 开关 ---------- */
  function open(key, foeUnit) {
    if (!unitOf(key)) return;
    current = key;
    currentFoe = foeUnit || null;
    if (key === 'foe' && !currentFoe) {
      currentFoe = state.foes[state.target] || state.foes[0];
    }
    render();
    iv.overlay.classList.add('show');
    state.paused = true;
    G.renderButtons();

    clearInterval(timer);
    timer = setInterval(() => {
      const u = unitOf(current);
      if (!u) return;
      if (signature(u) !== lastSig) render();
    }, 350);
  }

  function close() {
    clearInterval(timer);
    timer = null;
    current = null;
    iv.overlay.classList.remove('show');
    state.paused = false;   // 无论面板是否曾显示，都确保解除挂起
    G.renderButtons();
  }

  function isOpen() { return !!current; }

  /* ---------- 事件 ---------- */
  // 静态的 ally 查看按钮
  document.querySelectorAll('[data-inspect="ally"]').forEach(node => {
    node.addEventListener('click', e => {
      e.stopPropagation();
      open('ally');
    });
  });

  // 敌人卡片里的查看按钮是动态生成的，用事件委托
  const foesBox = $('foes');
  if (foesBox) {
    foesBox.addEventListener('click', e => {
      const btn = e.target.closest('[data-inspect="foe"]');
      if (!btn) return;
      e.stopPropagation();
      // 找到所属卡片对应的敌人单位
      const card = e.target.closest('.fighter.foe');
      const foe = card ? state.foes.find(f => el.foeCard(f) === card) : null;
      open('foe', foe);
    });
  }

  // 升级界面里的装备一览也可以点开
  const eqPanel = $('eqPanel');
  if (eqPanel) {
    eqPanel.addEventListener('click', () => {
      if (state.phase === 'upgrade') open('ally');
    });
  }

  iv.close.addEventListener('click', close);
  iv.overlay.addEventListener('click', e => {
    if (e.target === iv.overlay) close();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });

  Object.assign(G, { inspector: { open, close, isOpen, render } });

})(window.ABYSS = window.ABYSS || {});
