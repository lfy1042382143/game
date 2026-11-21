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

  const MINE_FUSE = 6;   // 地雷过期自爆时间（秒）

  /* =========================================================
     线与维度定义（dims 顺序即卡池内文案顺序）
     eff(lv) 返回该维度在 Lv.lv 时的具体效果描述（卡牌与侧边栏共用）
     ========================================================= */
  const LINES = {
    arrow: {
      name: '箭矢', icon: '🏹',
      unlockDesc: '解锁箭矢：自动朝鼠标/最近敌人持续射击（初始 1 支，100% 攻击）',
      dims: [
        { key: 'count',  name: '箭矢数量', icon: '🏹', max: 4,
          eff: lv => '每次射击射出 ' + (1 + lv) + ' 支箭矢' },
        { key: 'rate',   name: '射速提升', icon: '⚡', max: 4,
          eff: lv => '射击间隔 ' + (CFG.player.atkCd * Math.pow(0.88, lv)).toFixed(2) + ' 秒/发' },
        { key: 'bounce', name: '弹射强化', icon: '🪃', max: 3,
          eff: lv => lv ? '箭矢碰墙/障碍物后反弹 ' + lv + ' 次，可再次命中' : '箭矢碰墙/障碍物即消失' },
        { key: 'pierce', name: '穿透强化', icon: '🎯', max: 3,
          eff: lv => lv ? '箭矢可穿过 ' + lv + ' 名敌人继续飞行（每次穿透伤害 ×0.7）' : '命中第一个敌人后消失' },
        { key: 'split',  name: '分裂弹幕', icon: '✴️', max: 3,
          eff: lv => lv ? '箭矢命中后分裂出 ' + lv + ' 枚更小的弹幕（各 40% 伤害）' : '命中不分裂' }
      ]
    },
    chain: {
      name: '连锁闪电', icon: '⚡',
      unlockDesc: '解锁连锁闪电：每 3.0 秒劈向最近敌人并弹射 2 个目标（主目标 30% 攻击，每跳 ×0.8）',
      dims: [
        { key: 'jumps', name: '弹射数量', icon: '🔗', max: 4,
          eff: lv => '每次攻击弹射跳跃 ' + (2 + lv) + ' 个目标' },
        { key: 'dmg',   name: '伤害提升', icon: '🗡️', max: 4,
          eff: lv => '每道闪电造成 ' + Math.round((0.3 + 0.25 * lv) * 100) + '% 攻击的伤害（每多弹射 1 目标 ×0.8）' },
        { key: 'rate',  name: '攻击频率', icon: '⏱️', max: 4,
          eff: lv => '每 ' + (3.0 * Math.pow(0.88, lv)).toFixed(2) + ' 秒发动一轮攻击' },
        { key: 'bolts', name: '闪电数量', icon: '🌩️', max: 3,
          eff: lv => '每次攻击同时发出 ' + (1 + lv) + ' 道独立闪电（各自弹射）' }
      ]
    },
    shock: {
      name: '震荡波', icon: '💥',
      unlockDesc: '解锁震荡波：每 3.0 秒以自身为中心释放环形冲击（180% 攻击，半径 110，命中越多单发越低）',
      dims: [
        { key: 'range', name: '范围扩大', icon: '🌐', max: 4,
          eff: lv => '冲击波半径 ' + (110 + 24 * lv) + ' 像素' },
        { key: 'dmg',   name: '伤害提升', icon: '🗡️', max: 4,
          eff: lv => '冲击波造成 ' + Math.round((1.8 + 0.4 * lv) * 100) + '% 攻击的伤害' },
        { key: 'rate',  name: '释放频率', icon: '⏱️', max: 4,
          eff: lv => '每 ' + (3.0 * Math.pow(0.88, lv)).toFixed(2) + ' 秒释放一次' },
        { key: 'echo',  name: '连锁震荡', icon: '〰️', max: 3,
          eff: lv => lv ? '命中敌人后在其位置产生 ' + lv + ' 道次级震荡波（半径 45%、伤害 50%）' : '不产生次级震荡波' }
      ]
    },
    orbit: {
      name: '环绕飞刃', icon: '🌀',
      unlockDesc: '解锁环绕飞刃：每隔 5 秒展开 3 枚绕身旋转的飞刃，接触敌人造成 80% 攻击伤害',
      dims: [
        { key: 'count', name: '飞刃数量', icon: '🌀', max: 4,
          eff: lv => '每批 ' + (3 + 2 * lv) + ' 枚飞刃均匀环绕' },
        { key: 'rate',  name: '出现频率', icon: '⏱️', max: 4,
          eff: lv => '每 ' + (5 * Math.pow(0.88, lv)).toFixed(2) + ' 秒展开一批（持续约 ' + (5 * Math.pow(0.88, lv) * 0.62).toFixed(1) + ' 秒）' },
        { key: 'range', name: '范围扩大', icon: '🌐', max: 4,
          eff: lv => '绕行半径 ' + (62 + 10 * lv) + ' 像素' },
        { key: 'speed', name: '转速提升', icon: '💨', max: 4,
          eff: lv => '旋转速度加快 ' + (lv * 22) + '%（更快触碰敌人）' }
      ]
    },
    drone: {
      name: '浮游炮', icon: '🔮',
      unlockDesc: '解锁浮游炮：停在玩家周围射击（90% 攻击 / 0.8s），可拦截敌方弹幕，存活 4 秒后收回',
      dims: [
        { key: 'count', name: '浮游炮数量', icon: '🔮', max: 3,
          eff: lv => '每次部署 ' + (1 + lv) + ' 座浮游炮（环绕玩家四周固定方位）' },
        { key: 'dmg',   name: '子弹伤害', icon: '🗡️', max: 4,
          eff: lv => '每发子弹造成 ' + Math.round((0.9 + 0.15 * lv) * 100) + '% 攻击的伤害' },
        { key: 'life',  name: '存在时间', icon: '⌛', max: 3,
          eff: lv => '部署后存活 ' + (4 + 1.5 * lv).toFixed(1) + ' 秒（每 6.5 秒重新部署一批）' }
      ]
    },
    mine: {
      name: '感应地雷', icon: '🧨',
      unlockDesc: '解锁感应地雷：每 3.0 秒在身边布设地雷（160% 攻击，半径 80），敌人靠近或 6 秒到期后自爆',
      dims: [
        { key: 'dmg',   name: '伤害提升', icon: '🗡️', max: 4,
          eff: lv => '每枚地雷爆炸造成 ' + Math.round((1.6 + 0.25 * lv) * 100) + '% 攻击的伤害' },
        { key: 'count', name: '布雷数量', icon: '🧨', max: 3,
          eff: lv => '每次部署 ' + (1 + lv) + ' 枚地雷（散布在玩家两侧）' },
        { key: 'rate',  name: '部署冷却', icon: '⏱️', max: 4,
          eff: lv => '每 ' + (3.0 * Math.pow(0.88, lv)).toFixed(2) + ' 秒布设一批' },
        { key: 'range', name: '范围扩大', icon: '🌐', max: 4,
          eff: lv => '爆炸半径 ' + (80 + 20 * lv) + ' 像素' }
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
    const D = Math.pow(0.9, (p.cdr || 0) + (p.taskCdr || 0));   // 全局冷却：冷却卡 + 任务奖励，每层全部间隔 −10%

    /* 箭矢（基础远程弹幕；初始伤害 0.85×攻击，与其他攻击方式 DPS 对齐） */
    const a = g('arrow');
    p.shots = 1 + (a.count || 0);
    p.shotDmgMul = 0.85;
    p.atkCdMul = Math.pow(0.88, a.rate || 0);
    p.bounce = a.bounce || 0;
    p.pierce = a.pierce || 0;
    p.splitN = a.split || 0;

    /* 连锁闪电（远程爆发 AoE：1.8×攻 / 3s / 弹射 2 目标） */
    const c = g('chain'), ch = p.sk.chain;
    ch.cd = Math.max(1.1, 3.0 * Math.pow(0.88, c.rate || 0) * D);
    ch.jumps = 2 + (c.jumps || 0);
    ch.mult = 0.3 + 0.25 * (c.dmg || 0);
    ch.bolts = 1 + (c.bolts || 0);

    /* 震荡波（近身 AoE：1.8×攻 / 3s / 半径 110） */
    const s = g('shock'), so = p.sk.shock;
    so.cd = Math.max(1.5, 3.0 * Math.pow(0.88, s.rate || 0) * D);
    so.r = 110 + 24 * (s.range || 0);
    so.mult = 1.8 + 0.4 * (s.dmg || 0);
    so.echo = s.echo || 0;

    /* 环绕飞刃（近身持续：3 枚起，接触伤害 0.8×攻，触发间隔 0.45s） */
    const o = g('orbit'), ob = p.sk.orbit;
    ob.interval = Math.max(2.0, 5 * Math.pow(0.88, o.rate || 0) * D);
    ob.dur = Math.max(2.6, ob.interval * 0.62);
    ob.count = 3 + 2 * (o.count || 0);
    ob.r = 62 + 10 * (o.range || 0);
    ob.spd = 2.4 + 0.55 * (o.speed || 0);
    p.orbitR = ob.r;
    p.orbitSpd = ob.spd;
    p.orbitDmgMul = 0.8;

    /* 浮游炮（远程持续：0.9×攻 / 0.8s） */
    const d = g('drone'), dr = p.sk.drone;
    dr.interval = Math.max(2.5, 6.5 * D);
    dr.count = 1 + (d.count || 0);
    dr.mult = 0.9 + 0.15 * (d.dmg || 0);
    dr.life = 4 + 1.5 * (d.life || 0);
    dr.cd = 0.8;

    /* 感应地雷（近身陷阱：1.6×攻 / 3s / 半径 80） */
    const m = g('mine'), mi = p.sk.mine;
    mi.cd = Math.max(1.5, 3.0 * Math.pow(0.88, m.rate || 0) * D);
    mi.count = 1 + (m.count || 0);
    mi.r = 80 + 20 * (m.range || 0);
    mi.mult = 1.6 + 0.25 * (m.dmg || 0);
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
          // 详细描述：当前效果 → 升级后效果（具体数值）
          desc: p => {
            const cur = (p.sd[k] && p.sd[k][d.key]) || 0;
            const next = Math.min(d.max, cur + 1);
            return '当前：' + d.eff(cur) + '<br>升到 Lv.' + next + '：' + d.eff(next);
          },
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
      // 多目标伤害递减：主目标 100%，每多弹射 1 个目标 ×0.8
      const decay = Math.pow(0.8, i);
      G.dealDamage(p, cur, skillDamage(p, cfg.mult * decay), { noThorn: true, noShock: true, noSplash: true, tag: 'chain' });
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
    // 命中数越多单发伤害越低：×0.88^(n-1)，下限 50%
    const inRange = G.state.foes.filter(f => !f.dead && G.dist(x, y, f.x, f.y) <= r);
    const falloff = Math.max(0.5, Math.pow(0.88, Math.max(0, inRange.length - 1)));
    const hitFoes = [];
    for (const f of inRange) {
      G.dealDamage(p, f, skillDamage(p, mult * falloff), { noThorn: true, noShock: true, noSplash: true, tag: 'shock' });
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
    // 命中数越多单发伤害越低：×0.85^(n-1)，下限 60%
    const inRange = G.state.foes.filter(f => !f.dead && !f.fly && G.dist(f.x, f.y, m.x, m.y) <= m.r);
    const falloff = Math.max(0.6, Math.pow(0.85, Math.max(0, inRange.length - 1)));
    for (const f of inRange) {
      G.dealDamage(p, f, Math.max(1, Math.round(m.dmg * falloff)), { noThorn: true, noShock: true, noSplash: true, tag: 'mine' });
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
            r: cfg.r, t: 0, dmg: skillDamage(p, cfg.mult), armed: 0.4,
            fuse: MINE_FUSE   // 过期自爆（反挂机）
          });
        }
      }
      // 触发判定
      for (let i = G.state.mines.length - 1; i >= 0; i--) {
        const m = G.state.mines[i];
        if (!m) continue;
        m.t += dt;
        if (m.armed > 0) { m.armed -= dt; continue; }
        const hit = G.state.foes.some(f => !f.dead && !f.fly && G.dist(f.x, f.y, m.x, m.y) < f.r + 18);
        if (hit) {
          G.state.mines.splice(i, 1);
          explodeMine(m, p);
          continue;
        }
        // 过期自爆：一段时间未触发也会爆炸（挂机布雷不再是无限收益）
        m.fuse -= dt;
        if (m.fuse <= 0) {
          G.state.mines.splice(i, 1);
          explodeMine(m, p);
        }
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
    dronePos, explodeMine, fireChainBolt, shockBlast, MINE_FUSE
  });
})(window.ABYSS = window.ABYSS || {});
