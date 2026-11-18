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
          desc: '损失 15% 当前生命，获得一件随机部位装备',
          apply(p) {
            p.hp = Math.max(1, Math.round(p.hp * 0.85));
            // 随机部位、中等稀有度
            const slot = G.SLOTS[Math.floor(Math.random() * G.SLOTS.length)].key;
            const rar = Math.min(4, Math.floor(state.wave * CFG.mon.rarK));
            const item = G.randomItem(slot, rar, Math.min(CFG.forge.maxLevel, 1 + Math.floor((state.wave - 1) / CFG.mon.eqLvEvery)));
            state.eventLoot = item;
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
  function eventDue() {
    const E = CFG.events;
    return state.wave >= E.firstAt && (state.wave - E.firstAt) % E.every === 0;
  }

  /** 按波次确定性轮换事件种类（不掷骰，可预测） */
  function rollEvent() {
    const idx = Math.floor((state.wave - CFG.events.firstAt) / CFG.events.every) % EVENTS.length;
    return EVENTS[idx];
  }

  /* =========================================================
     渲染与交互
     ========================================================= */
  function renderEvent(evt) {
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
    state.eventLoot = state.eventLoot || null;
    render(true);
    tone({ freq: 620, type: 'sine', dur: 0.18, vol: 0.1 });

    // 商人交易掉落 → 直接进战利品，进入升级界面由玩家处理
    if (state.eventLoot) {
      state.loots = [{ item: state.eventLoot, done: false, result: '', slot: state.eventLoot.slot }];
      state.eventLoot = null;
    }

    setTimeout(() => {
      // 进入下一波（战利品若有则在升级界面处理）
      if (state.loots && state.loots.length) {
        showUpgrade();
      } else {
        G.advanceWave();
      }
    }, 260);
  }

  /** 事件入口：胜利结算后、进入升级/下一波前触发 */
  function triggerEvent() {
    if (!eventDue()) return false;
    const evt = rollEvent();
    state.phase = 'event';
    renderEvent(evt);
    sfxUpgrade();
    return true;
  }

  Object.assign(G, { EVENTS, eventDue, rollEvent, renderEvent, triggerEvent, chooseEventOption });
})(window.ABYSS = window.ABYSS || {});
