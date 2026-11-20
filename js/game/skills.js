/* ============================================================
   游戏层 · skills.js
   六条攻击方式升级线：箭矢 / 环绕飞刃 / 震荡波 / 连锁闪电 / 浮游炮 / 感应地雷
   每条 5 级；每级效果集中在这里定义，卡池只负责升等级。
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG, clamp } = G;

  /* =========================================================
     技能等级效果表（index = 等级 1~5）
     ========================================================= */
  const SKILLS = {
    arrow: {
      name: '箭矢精通', icon: '🏹',
      desc: lv => [
        '基础持续射击',
        '2 支箭，每支 85% 攻击',
        '箭矢可穿透 1 层敌人',
        '射击间隔 −15%',
        '反弹 1 次，单箭恢复 100% 攻击'
      ][lv - 1] || '',
      apply(p, lv) {
        p.shots = lv >= 2 ? 2 : 1;
        p.shotDmgMul = lv >= 5 ? 1 : (lv >= 2 ? 0.85 : 1);
        p.pierce = lv >= 3 ? 1 : 0;
        p.atkCdMul = lv >= 4 ? 0.85 : 1;
        p.bounce = lv >= 5 ? 1 : 0;
      }
    },
    orbit: {
      name: '环绕飞刃', icon: '🌀',
      desc: lv => [
        '2 枚飞刃，每枚 60% 攻击',
        '4 枚飞刃',
        '6 枚飞刃，绕行半径 +20',
        '转速加快，单枚伤害提升至 80%',
        '内外双层飞刃（共 12 枚）'
      ][lv - 1] || '',
      apply(p, lv) {
        p.orbits = [0, 2, 4, 6, 6, 12][lv] || 0;
        p.orbitDual = lv >= 5;
        p.orbitDmgMul = lv >= 4 ? 0.8 : 0.6;
        p.orbitR = lv >= 3 ? 84 : 64;
        p.orbitSpd = lv >= 4 ? 4.0 : 2.6;
      }
    },
    shock: {
      name: '震荡波', icon: '💥',
      desc: lv => [
        '每 6 秒释放 120 半径冲击波（60% 攻击）',
        '范围扩大至 150',
        '间隔缩短至 4.5 秒',
        '伤害提升至 100% 攻击并击晕',
        '间隔 3 秒、范围 180 的双环冲击'
      ][lv - 1] || '',
      apply(p, lv) {
        p.shockLv = lv;
        p.sk.shock.cd = [6, 6, 4.5, 4.5, 3][lv - 1];
        p.sk.shock.r = [120, 150, 150, 150, 180][lv - 1];
        p.sk.shock.mult = [0.6, 0.6, 0.6, 1.0, 1.0][lv - 1];
      }
    },
    chain: {
      name: '连锁闪电', icon: '⚡',
      desc: lv => [
        '每 4 秒劈击最近敌人，跳跃 2 个目标',
        '跳跃 3 个目标',
        '伤害提升至 140% 攻击',
        '跳跃 5 个目标并短暂麻痹',
        '间隔 2.5 秒，伤害 160% 攻击'
      ][lv - 1] || '',
      apply(p, lv) {
        p.chainLv = lv;
        p.sk.chain.cd = [4, 4, 4, 4, 2.5][lv - 1];
        p.sk.chain.jumps = [2, 3, 3, 5, 5][lv - 1];
        p.sk.chain.mult = [1.0, 1.0, 1.4, 1.4, 1.6][lv - 1];
      }
    },
    drone: {
      name: '浮游炮', icon: '🔮',
      desc: lv => [
        '1 个浮游炮，每 1.2 秒射击（50% 攻击）',
        '2 个浮游炮',
        '射速提升至 0.9 秒',
        '伤害提升至 70% 攻击并自动追踪',
        '3 个浮游炮'
      ][lv - 1] || '',
      apply(p, lv) {
        p.droneLv = lv;
        p.sk.drone.count = [0, 1, 2, 2, 3][lv] || 0;
        p.sk.drone.cd = lv >= 3 ? 0.9 : 1.2;
        p.sk.drone.mult = lv >= 4 ? 0.7 : 0.5;
        p.sk.drone.homing = lv >= 4;
      }
    },
    mine: {
      name: '感应地雷', icon: '🧨',
      desc: lv => [
        '每 4 秒在身后布雷（120% 攻击，70 半径）',
        '爆炸半径扩大至 90',
        '每次布置 2 枚',
        '伤害提升至 180% 攻击并减速',
        '连锁引爆周围地雷'
      ][lv - 1] || '',
      apply(p, lv) {
        p.mineLv = lv;
        p.sk.mine.cd = lv >= 5 ? 3 : 4;
        p.sk.mine.count = lv >= 3 ? 2 : 1;
        p.sk.mine.r = lv >= 5 ? 110 : (lv >= 2 ? 90 : 70);
        p.sk.mine.mult = lv >= 4 ? 1.8 : 1.2;
        p.sk.mine.chain = lv >= 5;
      }
    }
  };

  const SKILL_KEYS = Object.keys(SKILLS);

  /** 技能伤害 = 攻击 × 倍率 ×（1 + 共鸣符） */
  function skillDamage(p, mult) {
    const res = (p.agg && p.agg.resonance) || 0;
    return Math.max(1, Math.round(p.atk * mult * (1 + res / 100)));
  }

  /** 升级某条技能线（等级 +1 并应用全部效果） */
  function upgradeSkill(p, key) {
    if (!SKILLS[key]) return;
    const lv = Math.min(5, (p.skills[key] || 0) + 1);
    p.skills[key] = lv;
    SKILLS[key].apply(p, lv);
  }

  /** 生成技能卡（供 cards.js 混入卡池） */
  function makeSkillCard(key) {
    const S = SKILLS[key];
    return {
      key: 'skill_' + key, kind: 'skill', skill: key,
      name: S.name, icon: S.icon,
      max: p => (p.skills[key] || 0) >= 5,
      desc: p => {
        const lv = p.skills[key] || 0;
        if (lv >= 5) return S.desc(5);
        return (lv ? '下一级：' : '解锁：') + S.desc(lv + 1) + '（当前 Lv.' + lv + '）';
      },
      apply(p) { upgradeSkill(p, key); }
    };
  }

  /* =========================================================
     技能运行态更新
     ========================================================= */
  function nearestFoe(p, maxD) {
    let best = null, bd = maxD || Infinity;
    for (const f of G.state.foes) {
      if (f.dead) continue;
      const d = G.dist(p.x, p.y, f.x, f.y);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  function updateSkills(dt) {
    const p = G.state.player;
    if (!p || p.dead || !p.skills) return;
    const sk = p.sk;
    if (!sk) return;

    /* ---- 震荡波 ---- */
    if (p.shockLv > 0) {
      sk.shock.t -= dt;
      if (sk.shock.t <= 0) {
        sk.shock.t = sk.shock.cd;
        const cfg = sk.shock;
        const rings = p.shockLv >= 5 ? 2 : 1;
        for (let k = 0; k < rings; k++) {
          G.state.skillFx.push({ kind: 'shock', x: p.x, y: p.y, r: cfg.r, t: 0, dur: 0.45 + k * 0.12, delay: k * 0.15 });
          setTimeout(() => {
            if (!G.state.player || G.state.phase !== 'play') return;
            for (const f of G.state.foes) {
              if (f.dead || G.dist(p.x, p.y, f.x, f.y) > cfg.r) continue;
              G.dealDamage(p, f, skillDamage(p, cfg.mult), { noThorn: true, noShock: true, noSplash: true });
              if (p.shockLv >= 4 && !f.dead) f.stunT = 0.6;
            }
          }, k * 150);
        }
      }
    }

    /* ---- 连锁闪电 ---- */
    if (p.chainLv > 0) {
      sk.chain.t -= dt;
      if (sk.chain.t <= 0) {
        sk.chain.t = sk.chain.cd;
        const cfg = sk.chain;
        const first = nearestFoe(p, p.range * 1.5);
        if (first) {
          const chainPts = [{ x: p.x, y: p.y }];
          const hitSet = new Set();
          let cur = first;
          for (let i = 0; i < cfg.jumps && cur; i++) {
            hitSet.add(cur);
            chainPts.push({ x: cur.x, y: cur.y });
            G.dealDamage(p, cur, skillDamage(p, cfg.mult), { noThorn: true, noShock: true, noSplash: true });
            if (p.chainLv >= 4 && !cur.dead) cur.stunT = 0.5;
            // 找下一个未命中的最近目标
            let next = null, nd = 220;
            for (const f of G.state.foes) {
              if (f.dead || hitSet.has(f)) continue;
              const d = G.dist(cur.x, cur.y, f.x, f.y);
              if (d < nd) { nd = d; next = f; }
            }
            cur = next;
          }
          G.state.skillFx.push({ kind: 'chain', pts: chainPts, t: 0, dur: 0.3 });
        }
      }
    }

    /* ---- 浮游炮 ---- */
    if (p.droneLv > 0) {
      sk.drone.t -= dt;
      if (sk.drone.t <= 0) {
        sk.drone.t = sk.drone.cd;
        const cfg = sk.drone;
        for (let i = 0; i < cfg.count; i++) {
          const d = dronePos(p, i, cfg.count);
          const target = cfg.homing ? nearestFoe(p, p.range * 1.5) : null;
          const a = target ? Math.atan2(target.y - d.y, target.x - d.x)
            : Math.atan2(d.y - p.y, d.x - p.x);
          const spd = CFG.player.bulletSpeed;
          G.state.bullets.push({
            x: d.x, y: d.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
            r: 4, dmg: skillDamage(p, cfg.mult), side: 'p', life: p.range / spd,
            owner: p, hit: [], skill: true
          });
        }
      }
    }

    /* ---- 感应地雷 ---- */
    if (p.mineLv > 0) {
      sk.mine.t -= dt;
      if (sk.mine.t <= 0) {
        sk.mine.t = sk.mine.cd;
        const cfg = sk.mine;
        for (let i = 0; i < cfg.count; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = 60 + Math.random() * 40;
          G.state.mines.push({
            x: p.x - Math.cos(a) * d * (i ? -1 : 1),
            y: p.y - Math.sin(a) * d * (i ? -1 : 1),
            r: cfg.r, t: 0, dmg: skillDamage(p, cfg.mult), chain: !!cfg.chain, armed: 0.4
          });
        }
      }
      // 触发判定
      for (let i = G.state.mines.length - 1; i >= 0; i--) {
        const m = G.state.mines[i];
        if (!m || m.removed) continue;   // 连锁引爆可能已移除
        m.t += dt;
        if (m.armed > 0) { m.armed -= dt; continue; }
        const hit = G.state.foes.some(f => !f.dead && G.dist(f.x, f.y, m.x, m.y) < f.r + 18);
        if (!hit) continue;
        G.state.mines.splice(i, 1);
        m.removed = true;
        explodeMine(m, p);
      }
    }

    // 特效计时
    for (let i = G.state.skillFx.length - 1; i >= 0; i--) {
      const fx = G.state.skillFx[i];
      fx.t += dt;
      if (fx.delay > 0) fx.delay -= dt;
      else if (fx.t >= fx.dur) G.state.skillFx.splice(i, 1);
    }
  }

  function explodeMine(m, p, triggered) {
    triggered = triggered || new Set();
    if (triggered.has(m)) return;
    triggered.add(m);
    G.state.skillFx.push({ kind: 'mine', x: m.x, y: m.y, r: m.r, t: 0, dur: 0.35 });
    for (const f of G.state.foes) {
      if (f.dead || G.dist(f.x, f.y, m.x, m.y) > m.r) continue;
      G.dealDamage(p, f, m.dmg, { noThorn: true, noShock: true, noSplash: true });
      if (p.mineLv >= 4 && !f.dead) { f.slowT = 1.6; f.slowMul = 0.6; }
    }
    // 连锁引爆：先收集待引爆列表（不在遍历中 splice），用 Set 防重复递归
    if (m.chain) {
      const pending = [];
      for (const o of G.state.mines) {
        if (o === m || o.removed || triggered.has(o) || G.dist(o.x, o.y, m.x, m.y) >= m.r) continue;
        pending.push(o);
      }
      for (const o of pending) {
        const idx = G.state.mines.indexOf(o);
        if (idx >= 0) G.state.mines.splice(idx, 1);
        explodeMine(o, p, triggered);
      }
    }
  }

  /** 浮游炮位置（绕玩家旋转） */
  function dronePos(p, i, count) {
    const a = G.state.time * 2.0 + (i / count) * Math.PI * 2;
    const R = 52;
    return { x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R };
  }

  /** 初始化技能运行态 */
  function initSkills(p) {
    p.skills = { arrow: 1, orbit: 0, shock: 0, chain: 0, drone: 0, mine: 0 };
    p.sk = {
      shock: { t: 0, cd: 6, r: 120, mult: 0.6 },
      chain: { t: 0, cd: 4, jumps: 2, mult: 1 },
      drone: { t: 0, count: 0, cd: 1.2, mult: 0.5, homing: false },
      mine: { t: 0, count: 1, cd: 4, r: 70, mult: 1.2, chain: false }
    };
    SKILLS.arrow.apply(p, 1);
    if (G.state) {
      if (!G.state.skillFx) G.state.skillFx = [];
      if (!G.state.mines) G.state.mines = [];
    }
  }

  Object.assign(G, { SKILLS, SKILL_KEYS, makeSkillCard, upgradeSkill, skillDamage, updateSkills, dronePos, initSkills });
})(window.ABYSS = window.ABYSS || {});
