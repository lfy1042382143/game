/* ============================================================
   系统层 · events.js
   场景事件：每隔若干波触发一次确定性选择式事件，
   为线性爬波引入岔路、取舍与随机性（延续「可预判」原则：
   事件种类按波次固定轮换，不掷骰）。
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG, state, el, fmt, refresh, render, renderEquip, showUpgrade, setTip, floatNum, allyHost, healUnit, tone, sfxUpgrade } = G;

  /* =========================================================
     事件定义
     ========================================================= */
  const EVENTS = [
    {
      key: 'shrine',
      name: '幽暗祭坛',
      icon: '🕯️',
      text: '一座泛着幽光的祭坛，低语承诺以血肉换取力量。',
      options: [
        {
          label: '献祭生命上限',
          desc: '牺牲 20% 生命上限，换取 +攻击',
          apply(p) {
            const lose = Math.max(1, Math.round(p.baseHp * 0.2));
            p.baseHp -= lose;
            p.hp = Math.min(p.hp, p.baseHp + p.agg.hpFlat);
            p.baseAtk += Math.round(lose * 0.8);
            refresh(p);
          }
        },
        {
          label: '献祭防御',
          desc: '牺牲 3 点防御，换取 +生命上限',
          apply(p) {
            const lose = Math.min(p.baseDef, 3);
            p.baseDef -= lose;
            p.baseHp += lose * 18;
            p.hp += lose * 18;
            refresh(p);
          }
        },
        {
          label: '离开',
          desc: '不理会祭坛，安全通过',
          apply() {}
        }
      ]
    },
    {
      key: 'fork',
      name: '歧路',
      icon: '🔀',
      text: '道路在此分岔，前方隐约传来不同的气息。',
      options: [
        {
          label: '挑战精英',
          desc: '下波出现更强精英，但必掉稀有装备',
          apply() {
            state.pendingElite = true;
          }
        },
        {
          label: '搜寻宝箱',
          desc: '立即回复 40% 生命并 +攻击',
          apply(p) {
            healUnit(p, Math.round(p.maxHp * 0.4));
            p.baseAtk += 2;
            refresh(p);
          }
        }
      ]
    },
    {
      key: 'merchant',
      name: '神秘商人',
      icon: '🎭',
      text: '披着斗篷的商人递来一件装备，索要你的生命作为代价。',
      options: [
        {
          label: '交易装备',
          desc: '损失 15% 当前生命，获得一件随机部位装备（自动装备/替换）',
          apply(p) {
            p.hp = Math.max(1, Math.round(p.hp * 0.85));
            const slot = G.SLOTS[Math.floor(Math.random() * G.SLOTS.length)].key;
            const rar = Math.min(4, Math.floor(state.wave * CFG.mon.rarK));
            const item = G.randomItem(slot, rar, Math.min(CFG.forge.maxLevel, 1 + Math.floor((state.wave - 1) / CFG.mon.eqLvEvery)));
            // 直接装备：同部位替换（商人的货，不做逐件决策，交易即得）
            const cur = G.itemAt(p, slot);
            const idx = p.items.findIndex(i => i.slot === slot);
            if (idx >= 0) p.items[idx] = item;
            else p.items.push(item);
            G.refresh(p);
          }
        },
        {
          label: '婉拒',
          desc: '不交易，安全通过',
          apply() {}
        }
      ]
    },
    {
      key: 'spring',
      name: '疗愈泉水',
      icon: '💧',
      text: '清澈的泉水散发着治愈之光，但饮下后似乎会惊动深处的存在。',
      options: [
        {
          label: '畅饮泉水',
          desc: '回满生命，但下波敌人攻击提升',
          apply(p) {
            healUnit(p, p.maxHp);
            state.pendingRage = true;
          }
        },
        {
          label: '谨慎绕行',
          desc: '不饮用，安全通过',
          apply() {}
        }
      ]
    }
  ];

  /* =========================================================
     触发判定：每 every 波一次，从 firstAt 开始
     ========================================================= */
  function eventDue(wave) {
    const w = wave === undefined ? state.wave : wave;
    const E = CFG.events;
    return w >= E.firstAt && (w - E.firstAt) % E.every === 0;
  }

  /** 按波次确定性轮换事件种类（不掷骰，可预测） */
  function rollEvent(wave) {
    const w = wave === undefined ? state.wave : wave;
    const idx = Math.floor((w - CFG.events.firstAt) / CFG.events.every) % EVENTS.length;
    return EVENTS[idx];
  }

  /* =========================================================
     渲染与交互
     ========================================================= */
  function renderEvent(evt, wave) {
    const box = el.eventBox;
    const title = el.eventTitle;
    const icon = el.eventIcon;
    const text = el.eventText;
    const opts = el.eventOpts;
    if (!box) return;

    title.textContent = evt.name;
    icon.textContent = evt.icon;
    text.textContent = evt.text;
    opts.innerHTML = '';

    evt.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'event-opt';
      btn.innerHTML = '<span class="event-opt-label">' + opt.label + '</span>' +
        '<span class="event-opt-desc">' + opt.desc + '</span>';
      btn.addEventListener('click', () => chooseEventOption(evt, opt));
      opts.appendChild(btn);
    });

    box.classList.add('show');
  }

  function chooseEventOption(evt, opt) {
    const box = el.eventBox;
    if (!box || !box.classList.contains('show')) return;

    box.classList.remove('show');
    state.phase = 'busy';

    const p = state.player;
    opt.apply(p);
    render(true);
    tone({ freq: 620, type: 'sine', dur: 0.18, vol: 0.1 });

    setTimeout(() => {
      G.advanceWave();
    }, 260);
  }

  /** 事件入口：结算刚征服的波（wave 已 +1，故传入 wave-1） */
  function triggerEvent() {
    // 传入刚征服的波次：调用时 state.wave 已 +1，用 wave-1 判定
    const cleared = state.wave - 1;
    if (!eventDue(cleared)) return false;
    const evt = rollEvent(cleared);
    state.phase = 'event';
    renderEvent(evt);
    sfxUpgrade();
    return true;
  }

  Object.assign(G, { EVENTS, eventDue, rollEvent, renderEvent, triggerEvent, chooseEventOption });
})(window.ABYSS = window.ABYSS || {});
