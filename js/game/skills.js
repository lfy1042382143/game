/* ============================================================
   游戏层 · skills.js
   攻击方式系统 v2：六条攻击线
   箭矢 / 连锁闪电 / 震荡波 / 环绕飞刃 / 浮游炮 / 感应地雷
   - 每条线先「解锁」，之后按维度随机升级（数量/伤害/频率/特殊方向…）
     升级方向不固定：各维度卡随机混入升级卡池
   - 全局冷却卡（cards.js）：箭矢/闪电/震荡波攻击间隔、
     飞刃/浮游炮/地雷的下次出现间隔，全部缩短
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG } = G;

  /* =========================================================
     线与维度定义（dims 顺序即卡池内文案顺序）
     ========================================================= */
  const LINES = {
    arrow: {
      name: '箭矢', icon: '🏹',
      unlockDesc: '解锁箭矢：自动持续射击（初始 1 支）',
      dims: [
        { key: 'count',  name: '箭矢数量', icon: '🏹', max: 4, desc: '每次射击 +1 支箭矢' },
        { key: 'rate',   name: '射速提升', icon: '⚡', max: 4, desc: '射击间隔 −12%' },
        { key: 'bounce', name: '弹射强化', icon: '🪃', max: 3, desc: '箭矢碰到墙壁/障碍物后反弹 +1 次' },
        { key: 'pierce', name: '穿透强化', icon: '🎯', max: 3, desc: '箭矢可穿透 +1 名敌人（穿透后伤害 ×0.7）' },
        { key: 'split',  name: '分裂弹幕', icon: '✴️', max: 3, desc: '箭矢命中后分裂 +1 枚更小、40% 伤害的弹幕' }
      ]
    },
    chain: {
      name: '连锁闪电', icon: '⚡',
      unlockDesc: '解锁连锁闪电：周期性劈向最近敌人并弹射跳跃',
      dims: [
        { key: 'jumps', name: '弹射数量', icon: '🔗', max: 4, desc: '闪电弹射目标 +1' },
        { key: 'dmg',   name: '伤害提升', icon: '🗡️', max: 4, desc: '闪电伤害 +15%（初始伤害较低，靠升级成长）' },
        { key: 'rate',  name: '攻击频率', icon: '⏱️', max: 4, desc: '闪电攻击间隔 −12%' },
        { key: 'bolts', name: '闪电数量', icon: '🌩️', max: 3, desc: '每次攻击额外发出 +1 道独立闪电' }
      ]
    },
    shock: {
      name: '震荡波', icon: '💥',
      unlockDesc: '解锁震荡波：周期性释放环形冲击',
      dims: [
        { key: 'range', name: '范围扩大', icon: '🌐', max: 4, desc: '冲击波半径 +24' },
        { key: 'dmg',   name: '伤害提升', icon: '🗡️', max: 4, desc: '震荡波伤害 +20%' },
        { key: 'rate',  name: '释放频率', icon: '⏱️', max: 4, desc: '释放间隔 −12%' },
        { key: 'echo',  name: '连锁震荡', icon: '〰️', max: 3, desc: '命中敌人后产生 +1 道更小的次级震荡波' }
      ]
    },
    orbit: {
      name: '环绕飞刃', icon: '🌀',
      unlockDesc: '解锁环绕飞刃：每隔一段时间展开一批旋转飞刃',
      dims: [
        { key: 'count', name: '飞刃数量', icon: '🌀', max: 4, desc: '每批 +2 枚飞刃' },
        { key: 'rate',  name: '出现频率', icon: '⏱️', max: 4, desc: '下次出现的间隔 −12%' },
        { key: 'range', name: '范围扩大', icon: '🌐', max: 4, desc: '绕行半径 +10' },
        { key: 'speed', name: '转速提升', icon: '💨', max: 4, desc: '旋转速度 +22%' }
      ]
    },
    drone: {
      name: '浮游炮', icon: '🔮',
      unlockDesc: '解锁浮游炮：停在玩家周围射击，可拦截敌人弹幕，存活时间有限',
      dims: [
        { key: 'count', name: '浮游炮数量', icon: '🔮', max: 3, desc: '每次部署 +1 座浮游炮' },
        { key: 'dmg',   name: '子弹伤害', icon: '🗡️', max: 4, desc: '浮游炮子弹伤害 +15%' },
        { key: 'life',  name: '存在时间', icon: '⌛', max: 3, desc: '浮游炮存活时间 +1.5 秒' }
      ]
    },
    mine: {
      name: '感应地雷', icon: '🧨',
      unlockDesc: '解锁感应地雷：周期性在身边布雷，敌人靠近即引爆',
      dims: [
        { key: 'dmg',   name: '伤害提升', icon: '🗡️', max: 4, desc: '地雷伤害 +20%' },
        { key: 'count', name: '布雷数量', icon: '🧨', max: 3, desc: '每次部署 +1 枚地雷' },
        { key: 'rate',  name: '部署冷却', icon: '⏱️', max: 4, desc: '下次布雷的间隔 −12%' },
        { key: 'range', name: '范围扩大', icon: '🌐', max: 4, desc: '爆炸半径 +20' }
      ]
    }
  };

  const LINE_KEYS = Object.keys(LINES);

  /* =========================================================
     运行态初始化（state.js makePlayer 时调用）
     p.skills = 解锁标记；p.sd = 各维度等级；p.cdr = 全局冷却层数
     ========================================================= */
  function initSkills(p) {
    p.skills = {};
    p.sd = {};
    LINE_KEYS.forEach(k => {
      p.skills[k] = 0;
      p.sd[k] = {};
      LINES[k].dims.forEach(d => { p.sd[k][d.key] = 0; });
    });
    p.skills.arrow = 1;                 // 初始解锁箭矢
    p.cdr = p.cdr || 0;                 // 全局冷却卡层数
    p.sk = {
      chain: { t: 0 },
      shock: { t: 0 },
      orbit: { t: 0.5, active: 0 },
      drone: { t: 0.5, active: 0, shootT: 0 },
      mine: { t: 0 }
    };
    p.orbits = 0;
    applySkillBuild(p);
    if (G.state && !G.state.mines) G.state.mines = [];
    if (G.state && !G.state.skillFx) G.state.skillFx = [];
  }

  /* =========================================================
     由解锁/维度等级/全局冷却 重算全部运行参数
     ========================================================= */
  function applySkillBuild(p) {
    if (!p || !p.sk) return;
    const sd = p.sd || {};
    const g = k => sd[k] || {};
    const D = Math.pow(0.9, p.cdr || 0);   // 全局冷却：每层全部间隔 −10%

    /* 箭矢 */
    const a = g('arrow');
    p.shots = 1 + (a.count || 0);
    p.atkCdMul = Math.pow(0.88, a.rate || 0);
    p.bounce = a.bounce || 0;
    p.pierce = a.pierce || 0;
    p.splitN = a.split || 0;

    /* 连锁闪电（初始伤害明显偏低，靠「伤害」维度成长） */
    const c = g('chain'), ch = p.sk.chain;
    ch.cd = Math.max(1.1, 4.2 * Math.pow(0.88, c.rate || 0) * D);
    ch.jumps = 2 + (c.jumps || 0);
    ch.mult = 0.5 + 0.15 * (c.dmg || 0);
    ch.bolts = 1 + (c.bolts || 0);

    /* 震荡波 */
    const s = g('shock'), so = p.sk.shock;
    so.cd = Math.max(1.5, 6 * Math.pow(0.88, s.rate || 0) * D);
    so.r = 110 + 24 * (s.range || 0);
    so.mult = 0.6 + 0.2 * (s.dmg || 0);
    so.echo = s.echo || 0;

    /* 环绕飞刃：周期展开，存在一段时间后收起 */
    const o = g('orbit'), ob = p.sk.orbit;
    ob.interval = Math.max(2.0, 5 * Math.pow(0.88, o.rate || 0) * D);
    ob.dur = Math.max(2.6, ob.interval * 0.62);
    ob.count = 2 + 2 * (o.count || 0);
    ob.r = 62 + 10 * (o.range || 0);
    ob.spd = 2.4 + 0.55 * (o.speed || 0);
    p.orbitR = ob.r;
    p.orbitSpd = ob.spd;
    p.orbitDmgMul = 0.6;

    /* 浮游炮：周期部署、停留不动、有限存活 */
    const d = g('drone'), dr = p.sk.drone;
    dr.interval = Math.max(2.5, 6.5 * D);
    dr.count = 1 + (d.count || 0);
    dr.mult = 0.5 + 0.15 * (d.dmg || 0);
    dr.life = 4 + 1.5 * (d.life || 0);
    dr.cd = 1.1;

    /* 感应地雷 */
    const m = g('mine'), mi = p.sk.mine;
    mi.cd = Math.max(1.5, 4 * Math.pow(0.88, m.rate || 0) * D);
    mi.count = 1 + (m.count || 0);
    mi.r = 70 + 20 * (m.range || 0);
    mi.mult = 1.2 + 0.2 * (m.dmg || 0);
  }

  /* =========================================================
     升级卡生成：每条线一张解锁卡 + 每维度一张维度卡
     （未解锁的线：其维度卡 max() 恒真 → 自动排除出卡池）
     ========================================================= */
  function makeAllSkillCards() {
    const cards = [];
    LINE_KEYS.forEach(k => {
      const L = LINES[k];
      cards.push({
        key: 'unlock_' + k, kind: 'skill', line: k, sub: 'unlock',
        name: L.name, icon: L.icon,
        max: p => !!p.skills[k],
        val: () => '解锁',
        desc: p => p.skills[k] ? L.name + '已解锁' : L.unlockDesc,
        apply(p) {
          p.skills[k] = 1;
          if (k === 'orbit' || k === 'drone' || k === 'mine') p.sk[k].t = 0.5;  // 解锁后很快出现第一批
          applySkillBuild(p);
        }
      });
      L.dims.forEach(d => {
        cards.push({
          key: 'sk_' + k + '_' + d.key, kind: 'skill', line: k, sub: 'dim', dim: d.key,
          name: L.name + '·' + d.name, icon: d.icon,
          max: p => !p.skills[k] || (p.sd[k][d.key] || 0) >= d.max,
          val: p => 'Lv.' + ((p.sd[k] && p.sd[k][d.key]) || 0) + '→' + (((p.sd[k] && p.sd[k][d.key]) || 0) + 1),
          desc: () => d.desc,
          apply(p) {
            p.sd[k][d.key] = (p.sd[k][d.key] || 0) + 1;
            applySkillBuild(p);
          }
        });
      });
    });
    return cards;
  }

  const SKILL_CARDS = makeAllSkillCards();

  /* =========================================================
     技能伤害 = 攻击 × 倍率 ×（1 + 共鸣符）
     ========================================================= */
  function skillDamage(p, mult) {
    const res = (p.agg && p.agg.resonance) || 0;
    return Math.max(1, Math.round(p.atk * mult * (1 + res / 100)));
  }

  /* =========================================================
     目标搜索
     ========================================================= */
  function nearestFoeFrom(x, y, maxD, exclude) {
    let best = null, bd = maxD === undefined ? Infinity : maxD;
    for (const f of G.state.foes) {
      if (f.dead || (exclude && exclude.has(f))) continue;
      const d = G.dist(x, y, f.x, f.y);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  function nearestFoe(p, maxD, exclude) {
    return nearestFoeFrom(p.x, p.y, maxD, exclude);
  }

  /* =========================================================
     连锁闪电：锯齿电弧生成 + 多道独立闪电
     ========================================================= */
  /** 把折线细分并加随机法向抖动，形成锯齿闪电路径 */
  function jaggedPath(pts) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i], B = pts[i + 1];
      out.push(A);
      const seg = Math.max(2, Math.round(G.dist(A.x, A.y, B.x, B.y) / 26));
      const nx = -(B.y - A.y), ny = B.x - A.x;
      const nl = Math.hypot(nx, ny) || 1;
      for (let k = 1; k < seg; k++) {
        const t = k / seg;
        const off = (Math.random() * 2 - 1) * 11;
        out.push({ x: A.x + (B.x - A.x) * t + (nx / nl) * off, y: A.y + (B.y - A.y) * t + (ny / nl) * off });
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /** 发射一道连锁闪电：从玩家劈向 startFoe 并弹跳 jumps 次 */
  function fireChainBolt(p, startFoe, hitSetAll) {
    const cfg = p.sk.chain;
    const hitSet = hitSetAll || new Set();
    const pts = [{ x: p.x, y: p.y }];
    const hits = [];
    let cur = startFoe;
    for (let i = 0; i < cfg.jumps && cur; i++) {
      hitSet.add(cur);
      pts.push({ x: cur.x, y: cur.y });
      hits.push(cur);
      G.dealDamage(p, cur, skillDamage(p, cfg.mult), { noThorn: true, noShock: true, noSplash: true, tag: 'chain' });
      if (!cur.dead) cur.stunT = Math.max(cur.stunT || 0, 0.35);   // 短暂麻痹
      let next = null, nd = 240;
      for (const f of G.state.foes) {
        if (f.dead || hitSet.has(f)) continue;
        const dd = G.dist(cur.x, cur.y, f.x, f.y);
        if (dd < nd) { nd = dd; next = f; }
      }
      cur = next;
    }
    // 特效：锯齿电弧 + 每个命中点闪光（特效更明显）
    G.state.skillFx.push({ kind: 'chain', pts: jaggedPath(pts), t: 0, dur: 0.32 });
    hits.forEach(h => G.state.skillFx.push({ kind: 'zap', x: h.x, y: h.y, r: 26, t: 0, dur: 0.3 }));
  }

  /* =========================================================
     震荡波：主波 + 次级震荡波（echo 维度）
     ========================================================= */
  function shockBlast(p, x, y, r, mult, allowEcho) {
    const hitFoes = [];
    for (const f of G.state.foes) {
      if (f.dead || G.dist(x, y, f.x, f.y) > r) continue;
      G.dealDamage(p, f, skillDamage(p, mult), { noThorn: true, noShock: true, noSplash: true, tag: 'shock' });
      if (!f.dead) hitFoes.push(f);
    }
    const echoN = allowEcho ? (p.sk.shock.echo || 0) : 0;
    if (echoN > 0 && hitFoes.length) {
      // 随机挑选命中的敌人位置产生次级震荡波（更小、50% 伤害，不再继续连锁）
      const picks = hitFoes.slice().sort(() => Math.random() - 0.5).slice(0, echoN);
      picks.forEach((f, i) => {
        G.state.skillFx.push({ kind: 'shockEcho', x: f.x, y: f.y, r: r * 0.45, t: 0, dur: 0.4, delay: 0.18 + i * 0.08 });
        setTimeout(() => {
          if (!G.state.player || G.state.phase !== 'play') return;
          shockBlast(p, f.x, f.y, r * 0.45, mult * 0.5, false);
        }, 180 + i * 80);
      });
    }
  }

  /* =========================================================
     浮游炮
     ========================================================= */
  /** 浮游炮位置：停在玩家周围固定方位（不旋转，随玩家移动） */
  function dronePos(p, i, count) {
    const a = 0.7 + (i / Math.max(1, count)) * Math.PI * 2;
    const R = 58;
    return { x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R };
  }

  function fireDroneVolley(p) {
    const d = p.sk.drone;
    for (let i = 0; i < d.count; i++) {
      const pos = dronePos(p, i, d.count);
      const target = nearestFoeFrom(pos.x, pos.y, p.range * 1.4);
      if (!target) continue;
      const a = Math.atan2(target.y - pos.y, target.x - pos.x);
      const spd = CFG.player.bulletSpeed;
      G.state.bullets.push({
        x: pos.x, y: pos.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        r: 4, dmg: skillDamage(p, d.mult), side: 'p', life: p.range / spd,
        owner: p, hit: [], skill: 'drone', color: '#c084fc',   // 紫色弹幕，与玩家箭矢区分
        noSplit: true
      });
    }
  }

  /* =========================================================
     感应地雷
     ========================================================= */
  function explodeMine(m, p) {
    G.state.skillFx.push({ kind: 'shockEcho', x: m.x, y: m.y, r: m.r, t: 0, dur: 0.35 });
    for (const f of G.state.foes) {
      if (f.dead || G.dist(f.x, f.y, m.x, m.y) > m.r) continue;
      G.dealDamage(p, f, m.dmg, { noThorn: true, noShock: true, noSplash: true, tag: 'mine' });
    }
  }

  /* =========================================================
     技能运行态更新（flow.update 每帧调用）
     ========================================================= */
  function updateSkills(dt) {
    const p = G.state.player;
    if (!p || p.dead || !p.skills || !p.sk) return;
    const sk = p.sk;

    /* ---- 震荡波 ---- */
    if (p.skills.shock) {
      sk.shock.t -= dt;
      if (sk.shock.t <= 0) {
        sk.shock.t = sk.shock.cd;
        const s = sk.shock;
        G.state.skillFx.push({ kind: 'shock', x: p.x, y: p.y, r: s.r, t: 0, dur: 0.45 });
        setTimeout(() => {
          if (!G.state.player || G.state.phase !== 'play') return;
          shockBlast(p, p.x, p.y, s.r, s.mult, true);
        }, 120);
      }
    }

    /* ---- 连锁闪电 ---- */
    if (p.skills.chain) {
      sk.chain.t -= dt;
      if (sk.chain.t <= 0) {
        sk.chain.t = sk.chain.cd;
        const used = new Set();
        for (let b = 0; b < sk.chain.bolts; b++) {
          const first = nearestFoe(p, p.range * 1.5, used);
          if (!first) break;
          fireChainBolt(p, first, used);
        }
      }
    }

    /* ---- 环绕飞刃：周期展开/收起 ---- */
    if (p.skills.orbit) {
      const o = sk.orbit;
      if (o.active > 0) {
        o.active -= dt;
        p.orbits = o.count;
        if (o.active <= 0) { p.orbits = 0; o.t = o.interval; }
      } else {
        o.t -= dt;
        if (o.t <= 0) { o.active = o.dur; p.orbits = o.count; }
      }
    }

    /* ---- 浮游炮：周期部署，存活一段时间后消失 ---- */
    if (p.skills.drone) {
      const d = sk.drone;
      if (d.active > 0) {
        d.active -= dt;
        d.shootT -= dt;
        if (d.shootT <= 0) { d.shootT = d.cd; fireDroneVolley(p); }
        if (d.active <= 0) { d.active = 0; d.t = d.interval; }
      } else {
        d.t -= dt;
        if (d.t <= 0) { d.active = d.life; d.shootT = 0.3; }
      }
    }

    /* ---- 感应地雷 ---- */
    if (p.skills.mine) {
      sk.mine.t -= dt;
      if (sk.mine.t <= 0) {
        sk.mine.t = sk.mine.cd;
        const cfg = sk.mine;
        for (let i = 0; i < cfg.count; i++) {
          const a = Math.random() * Math.PI * 2;
          const dd = 60 + Math.random() * 40;
          G.state.mines.push({
            x: p.x - Math.cos(a) * dd * (i ? -1 : 1),
            y: p.y - Math.sin(a) * dd * (i ? -1 : 1),
            r: cfg.r, t: 0, dmg: skillDamage(p, cfg.mult), armed: 0.4
          });
        }
      }
      // 触发判定
      for (let i = G.state.mines.length - 1; i >= 0; i--) {
        const m = G.state.mines[i];
        if (!m) continue;
        m.t += dt;
        if (m.armed > 0) { m.armed -= dt; continue; }
        const hit = G.state.foes.some(f => !f.dead && G.dist(f.x, f.y, m.x, m.y) < f.r + 18);
        if (!hit) continue;
        G.state.mines.splice(i, 1);
        explodeMine(m, p);
      }
    }

    /* ---- 特效计时 ---- */
    for (let i = G.state.skillFx.length - 1; i >= 0; i--) {
      const fx = G.state.skillFx[i];
      fx.t += dt;
      if (fx.delay > 0) fx.delay -= dt;
      else if (fx.t >= fx.dur) G.state.skillFx.splice(i, 1);
    }
  }

  Object.assign(G, {
    LINES, LINE_KEYS, SKILL_CARDS,
    applySkillBuild, initSkills, updateSkills,
    skillDamage, nearestFoe, nearestFoeFrom,
    dronePos, explodeMine
  });
})(window.ABYSS = window.ABYSS || {});
