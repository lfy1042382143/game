/* ============================================================
   游戏层 · events.js（地点触发版）
   场景事件：地图上刷新事件地点（祭坛/歧路/商人/泉水），走近触发选择弹窗。
   - 收益全部接入武器/被动构筑：直接升级、指定升级、宝箱强化
   - 风险明码标价写进选项，取消随机陷阱背刺
   - 事件加权随机抽取，有地形时地点优先刷在灾害锚点附近
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG } = G;
  const BUILD = G.BUILD || {};
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  function eventBanner(text, sub) {
    state.banner = { text, sub, t: 2.6 };
  }

  /** 明码标价的风险：期间新刷出的敌人攻击提升（不再随机触发陷阱） */
  function applyRisk(mul) {
    const dur = CFG.events.riskDur || 45;
    state.eventFoeAtkMul = Math.max(state.eventFoeAtkMul || 1, mul);
    state.eventFoeUntil = Math.max(state.eventFoeUntil || 0, state.time + dur);
  }

  /* =========================================================
     构筑奖励工具：只动 p.weapons / p.passives，不改战斗数值
     ========================================================= */
  /** 随机升级一把已持有武器；槽位未满时退化成新武器；全满返回 null */
  function upgradeRandomWeapon(p) {
    if (!p || !p.weapons) return null;
    const held = Object.keys(BUILD.WEAPON_LEVELS || {}).filter(k =>
      (p.weapons[k] || 0) > 0 && p.weapons[k] < (BUILD.WEAPON_MAX || 8));
    if (held.length) {
      const k = pick(held);
      G.upgradeWeapon(p, k);
      return G.LINES[k].name + ' Lv.' + p.weapons[k];
    }
    const avail = Object.keys(BUILD.WEAPON_LEVELS || {}).filter(k => !(p.weapons[k] > 0));
    if (avail.length && G.weaponCount(p) < (BUILD.WEAPON_SLOTS || 6)) {
      const k = pick(avail);
      G.addWeapon(p, k);
      return '新武器 · ' + G.LINES[k].name;
    }
    return null;
  }

  /** 随机升级一个已持有/新被动（可排除刚献祭的那个） */
  function upgradeRandomPassive(p, excludeId) {
    if (!p || !p.passives) return null;
    const held = Object.keys(BUILD.PASSIVES || {}).filter(id =>
      id !== excludeId && (p.passives[id] || 0) > 0 && p.passives[id] < (BUILD.PASSIVE_MAX || 5));
    if (held.length) {
      const id = pick(held);
      G.upgradePassive(p, id);
      return { name: BUILD.PASSIVES[id].name, lv: p.passives[id] };
    }
    const avail = Object.keys(BUILD.PASSIVES || {}).filter(id =>
      id !== excludeId && !(p.passives[id] > 0));
    if (avail.length && G.passiveCount(p) < (BUILD.PASSIVE_SLOTS || 6)) {
      const id = pick(avail);
      G.upgradePassive(p, id);
      return { name: BUILD.PASSIVES[id].name, lv: p.passives[id] };
    }
    return null;
  }

  /** 献祭 1 级被动 → 另一个被动 +1 级；无被动时退化为武器 +1 */
  function transferPassive(p) {
    const held = Object.keys(BUILD.PASSIVES || {}).filter(id => (p.passives[id] || 0) > 0);
    if (!held.length) {
      const w = upgradeRandomWeapon(p);
      return w ? '武器 ' + w + '（无被动可献祭）' : null;
    }
    const from = pick(held);
    const oldLv = p.passives[from];
    p.passives[from]--;
    if (p.passives[from] <= 0) delete p.passives[from];
    let gained = upgradeRandomPassive(p, from);
    if (!gained) {
      // 无处转移则不能白扣：恢复原被动，改为武器 +1
      p.passives[from] = oldLv;
      const w = upgradeRandomWeapon(p);
      G.rebuildFromBuild(p);
      return w ? '武器 ' + w : null;
    }
    G.rebuildFromBuild(p);
    return BUILD.PASSIVES[from].name + ' −1 → ' + gained.name + ' Lv.' + gained.lv + ' +1';
  }

  /* =========================================================
     事件定义：收益接入构筑，风险写进 risk 文案
     ========================================================= */
  const EVENTS = [
    {
      key: 'shrine',
      name: '幽暗祭坛',
      icon: '🕯️',
      color: '#f87171',
      text: '一座泛着幽光的祭坛，低语承诺以血肉换取力量。',
      options: [
        {
          label: '血契 · 武器升华',
          desc: '献祭 20% 生命上限 → 随机一把已持有武器 +1 级',
          risk: '代价：45 秒内新敌人攻击 +20%',
          apply(p) {
            const lose = Math.max(1, Math.round(p.baseHp * (CFG.events.sacrificeHpCost || 0.2)));
            p.baseHp -= lose;
            G.refresh(p);
            p.hp = Math.min(p.hp, p.maxHp);
            applyRisk(CFG.events.shrineAtkMul || 1.2);
            const w = upgradeRandomWeapon(p);
            eventBanner('🕯 血契达成', w ? w + ' · 敌人被血气激怒' : '武器已满级，改为回复 30% 生命');
            if (!w) G.healUnit(p, Math.max(1, Math.round(p.maxHp * 0.3)));
          }
        },
        {
          label: '灵魂献祭 · 被动转移',
          desc: '献祭 1 级被动 → 另一被动 +1 级（可推动进化配方）',
          risk: '代价：失去 1 级被动；无被动时改为武器 +1 级',
          apply(p) {
            const r = transferPassive(p);
            eventBanner('🕯 灵魂献祭', r || '暂无可升级的构筑，回复 30% 生命');
            if (!r) G.healUnit(p, Math.max(1, Math.round(p.maxHp * 0.3)));
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
      color: '#fbbf24',
      text: '道路在此分岔，一边传来强敌的咆哮，一边散着补给的气息。',
      options: [
        {
          label: '挑战精英',
          desc: '引来一只强化精英（生命 +50%），击杀掉落宝箱 → 武器/被动升级',
          risk: '高风险：强敌立即加入战场',
          apply() {
            if (state.phase === 'play' || state.phase === 'busy') {
              const e = G.makeElite(state.wave, { hpMul: 1.5 });
              state.foes.push(e);
              eventBanner('⚠ 精英来袭', e.name + ' · 击杀掉落宝箱（构筑升级）');
            }
          }
        },
        {
          label: '搜寻物资',
          desc: '回复 40% 生命，并随机一把已持有武器 +1 级',
          apply(p) {
            G.healUnit(p, Math.round(p.maxHp * (CFG.events.searchHealPct || 0.4)));
            const w = upgradeRandomWeapon(p);
            if (!w) G.grantChestUpgrade();
            eventBanner('🔀 物资搜寻', w ? '生命回复 · ' + w : '生命回复 · 获得一次构筑强化');
          }
        }
      ]
    },
    {
      key: 'merchant',
      name: '神秘商人',
      icon: '🎭',
      color: '#c084fc',
      text: '披着斗篷的商人摊开手，指了指你手里的武器与护符。',
      options: [
        {
          label: '购买指定强化',
          desc: '付 15% 当前生命 → 从你已持有的武器/被动中指定一项 +1 级',
          risk: '代价：当前生命 −15%',
          apply(p) {
            p.hp = Math.max(1, Math.round(p.hp * (1 - (CFG.events.merchantHpCost || 0.15))));
            if (G.showEventPick) G.showEventPick();
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
      color: '#4ade80',
      text: '清澈的泉水散发着治愈之光，但饮下后似乎会惊动深处的存在。',
      options: [
        {
          label: '畅饮泉水',
          desc: '回满生命',
          risk: '代价：45 秒内新敌人攻击 +30%',
          apply(p) {
            G.healUnit(p, p.maxHp);
            applyRisk(CFG.events.springAtkMul || 1.3);
            eventBanner('💧 泉水已饮', '生命回满 · 深处的东西被惊动了');
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
     地点管理：加权随机种类 + 靠近地形（相对玩家环带，避开障碍/宝箱）
     ========================================================= */
  /** 加权随机：祭坛/泉水常见，商人稀有；避免紧接着重复同一种 */
  function pickEvent() {
    const W = (CFG.events && CFG.events.weights) || {};
    const pool = [];
    EVENTS.forEach(e => {
      const w = Math.max(0, W[e.key] || 1);
      for (let i = 0; i < w; i++) pool.push(e);
    });
    if (!pool.length) return EVENTS[0];
    let evt = pick(pool);
    if (pool.length > 1 && state.lastEventKey === evt.key) {
      const others = pool.filter(e => e.key !== evt.key);
      evt = pick(others);
    }
    state.lastEventKey = evt.key;
    return evt;
  }

  /** 有地形时优先选灾害锚点附近的位置，鼓励把怪引到火球/骨刺里 */
  function hazardSpot() {
    if (Math.random() > (CFG.events.nearHazardChance || 0)) return null;
    const anchors = (state.hazAnchors || []).concat((state.zones || []).map(z => ({ x: z.x, y: z.y })));
    if (!anchors.length) return null;
    const a = pick(anchors);
    const ang = Math.random() * Math.PI * 2;
    const d = 60 + Math.random() * 140;
    return { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
  }

  function spawnSite() {
    const W = CFG.world, C = CFG.events, p = state.player;
    if (state.sites.length >= C.cap) return false;

    const evt = pickEvent();

    for (let tries = 0; tries < 14; tries++) {
      let x, y;
      const h = tries < 6 ? hazardSpot() : null;
      if (h) {
        x = h.x; y = h.y;
      } else {
        const a = Math.random() * Math.PI * 2;
        const d = C.minDist + Math.random() * (C.maxDist - C.minDist);
        x = (p ? p.x : W.w / 2) + Math.cos(a) * d;
        y = (p ? p.y : W.h / 2) + Math.sin(a) * d;
      }
      x = Math.max(50, Math.min(W.w - 50, x));
      y = Math.max(50, Math.min(W.h - 50, y));
      if (p && G.dist(x, y, p.x, p.y) < C.triggerR + 60) continue;
      if (state.obstacles.some(o => G.circlePoly(x, y, 48, o))) continue;
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
      let html = '<span class="event-opt-label">' + opt.label + '</span>' +
        '<span class="event-opt-desc">' + opt.desc + '</span>';
      if (opt.risk) html += '<span class="event-opt-risk">⚠ ' + opt.risk + '</span>';
      btn.innerHTML = html;
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

    // 商人的定向强化弹窗已接管后续流程
    if (state.phase === 'eventpick') return;

    if ((state.pendingLevelUps || 0) > 0 || (state.pendingChestUps || 0) > 0) {
      G.showLevelUp();
    } else {
      state.phase = 'play';
    }
  }

  Object.assign(G, { EVENTS, spawnSite, checkSites, triggerSite, updateSites, chooseEventOption, pickEvent, applyRisk });
})(window.ABYSS = window.ABYSS || {});
