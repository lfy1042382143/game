/* ============================================================
   游戏层 · events.js（地点触发版）
   场景事件：地图上会刷新事件地点（祭坛/歧路/商人/泉水），
   玩家走近时触发选择弹窗（暂停），选择后该地点消失。
   一次性地点，探索大地图时主动造访。
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG } = G;

  /* =========================================================
     事件定义（effect: 'elite' 下波精英增强 / 'rage' 下波攻击增强）
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
            p.baseAtk += Math.round(lose * 0.8);
            G.refresh(p);
            p.hp = Math.min(p.hp, p.maxHp);
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
            G.refresh(p);
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
          desc: '下一波出现更强精英（生命 +50%）',
          apply() {
            state.pendingElite = true;
          }
        },
        {
          label: '搜寻物资',
          desc: '立即回复 40% 生命并 +2 攻击',
          apply(p) {
            G.healUnit(p, Math.round(p.maxHp * 0.4));
            p.baseAtk += 2;
            G.refresh(p);
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
          desc: '回满生命，但下一波敌人攻击提升',
          apply(p) {
            G.healUnit(p, p.maxHp);
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
     地点管理：刷新（相对玩家环带，避开障碍/宝箱/其他地点）
     ========================================================= */
  function spawnSite() {
    const W = CFG.world, C = CFG.events, p = state.player;
    if (state.sites.length >= C.cap) return false;

    // 确定性轮换事件种类：按已刷新次数推进，保证四种都能遇到
    const evt = EVENTS[state.siteSeq % EVENTS.length];
    state.siteSeq = (state.siteSeq || 0) + 1;

    for (let tries = 0; tries < 14; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = C.minDist + Math.random() * (C.maxDist - C.minDist);
      const x = Math.max(50, Math.min(W.w - 50, (p ? p.x : W.w / 2) + Math.cos(a) * d));
      const y = Math.max(50, Math.min(W.h - 50, (p ? p.y : W.h / 2) + Math.sin(a) * d));
      if (state.obstacles.some(o => G.circleRect(x, y, 48, o))) continue;
      if (state.chests.some(c => G.dist(x, y, c.x, c.y) < 160)) continue;
      if (state.sites.some(s => G.dist(x, y, s.x, s.y) < 220)) continue;
      state.sites.push({ x, y, evt, used: false });
      return true;
    }
    return false;
  }

  /** 玩家走近地点 → 触发事件（暂停 + 选择弹窗） */
  function checkSites() {
    const p = state.player;
    if (!p || state.phase !== 'play') return;
    const C = CFG.events;
    for (const s of state.sites) {
      if (s.used) continue;
      if (G.dist(p.x, p.y, s.x, s.y) < C.triggerR) {
        triggerSite(s);
        return;
      }
    }
  }

  function triggerSite(site) {
    state.activeSite = site;
    state.phase = 'event';
    renderEvent(site.evt);
    G.sfxUpgrade();
  }

  /** 刷新计时 */
  function updateSites(dt) {
    state.siteT = (state.siteT || 0) + dt;
    if (state.siteT >= CFG.events.spawnEvery) {
      state.siteT = 0;
      spawnSite();
    }
  }

  /* =========================================================
     渲染与交互
     ========================================================= */
  function renderEvent(evt) {
    const el = G.el;
    el.eventTitle.textContent = evt.name;
    el.eventIcon.textContent = evt.icon;
    el.eventText.textContent = evt.text;
    el.eventOpts.innerHTML = '';

    evt.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'event-opt';
      btn.innerHTML = '<span class="event-opt-label">' + opt.label + '</span>' +
        '<span class="event-opt-desc">' + opt.desc + '</span>';
      btn.addEventListener('click', () => chooseEventOption(opt));
      el.eventOpts.appendChild(btn);
    });

    el.eventOverlay.classList.add('show');
  }

  function chooseEventOption(opt) {
    const box = G.el.eventOverlay;
    if (!box || !box.classList.contains('show')) return;

    box.classList.remove('show');
    state.phase = 'busy';

    opt.apply(state.player);
    if (state.activeSite) state.activeSite.used = true;   // 一次性地点
    state.activeSite = null;
    G.ui.syncTopbar();
    G.tone({ freq: 620, type: 'sine', dur: 0.18, vol: 0.1 });

    // 有挂起的升级先弹升级，否则回到战斗
    if (state.pendingLevelUps > 0) {
      G.showLevelUp();
    } else {
      state.phase = 'play';
    }
  }

  Object.assign(G, { EVENTS, spawnSite, checkSites, triggerSite, updateSites, chooseEventOption });
})(window.ABYSS = window.ABYSS || {});
