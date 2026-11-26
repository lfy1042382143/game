/* ============================================================
   游戏层 · tasks.js
   定期任务系统（战斗不暂停，每 2.5~3.5 分钟自动开启一个）：
   - escort  ⛓ 解救俘虏：囚徒被 6 守卫围困，清光守卫→囚徒转为同伴；囚徒遇害/超时→玩家受罚
   - defense 💀 怪潮防守：刷怪速度大幅提升，存活到时限→攻击成长
   - crystal 🔮 摧毁水晶：限时摧毁全部召唤水晶→全局冷却强化；失败→敌人短暂增伤
   - stars   ✦ 流星采集：限时收集流星（无惩罚）
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG } = G;

  const FIRST_TASK_AT = 120;        // 首个任务出现时间（秒）
  const TASK_GAP = [150, 210];      // 任务之间的间隔区间
  const ESCORT_TIME = 45;
  const DEFENSE_TIME = 45;
  const CRYSTAL_TIME = 40;
  const STARS_TIME = 15;

  /* =========================================================
     调度
     ========================================================= */
  function updateTasks(dt) {
    if (state.phase !== 'play') return;
    if (state.enemyRageT > 0) state.enemyRageT -= dt;
    const t = state.task;
    if (t) {
      t.time -= dt;
      updateActiveTask(t, dt);
    } else {
      state.taskT -= dt;
      if (state.taskT <= 0) startRandomTask();
    }
    updateCompanion(dt);
  }

  function scheduleNext() {
    state.taskT = TASK_GAP[0] + Math.random() * (TASK_GAP[1] - TASK_GAP[0]);
  }

  function startRandomTask() {
    const kinds = ['escort', 'defense', 'crystal', 'stars'];
    startTask(kinds[Math.floor(Math.random() * kinds.length)]);
  }

  /** 位置工具：玩家附近环带（避开障碍与其他任务实体） */
  function spotNearPlayer(minD, maxD) {
    const p = state.player;
    const A = CFG.world;
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = minD + Math.random() * (maxD - minD);
      const x = Math.max(60, Math.min(A.w - 60, p.x + Math.cos(a) * d));
      const y = Math.max(60, Math.min(A.h - 60, p.y + Math.sin(a) * d));
      if (state.obstacles.some(o => G.circlePoly(x, y, 46, o))) continue;
      return { x, y };
    }
    return { x: p.x + minD, y: p.y };
  }

  /** 解救俘虏：有地形时优先落在灾害锚点附近，鼓励把守卫引进火球/骨刺 */
  function spotForEscort() {
    const p = state.player;
    const A = CFG.world;
    const anchors = (state.hazAnchors || []).concat((state.zones || []).map(z => ({ x: z.x, y: z.y })))
      .filter(a => {
        const d = G.dist(a.x, a.y, p.x, p.y);
        return d > 130 && d < 420 && a.x > 60 && a.x < A.w - 60 && a.y > 60 && a.y < A.h - 60;
      });
    if (anchors.length && Math.random() < 0.7) {
      const a = anchors[Math.floor(Math.random() * anchors.length)];
      return { x: a.x, y: a.y, nearHazard: true };
    }
    const s = spotNearPlayer(120, 200);
    return { x: s.x, y: s.y, nearHazard: false };
  }

  /* =========================================================
     任务开启
     ========================================================= */
  function startTask(kind) {
    const p = state.player;
    if (!p || state.task) return;

    if (kind === 'escort') {
      // 解救俘虏：囚徒被 6 名守卫围困，杀光守卫即解救成功（清怪解救，无读条）
      const spot = spotForEscort();
      const npc = G.makeUnit({
        hp: Math.round(G.curveHp(state.wave) * 12),
        atk: 0, def: 5,
        x: spot.x, y: spot.y, r: 14,
        type: 'npc', name: '囚徒', emoji: '🧝'
      });
      npc.noKill = true;              // 死亡不计入击杀/经验
      npc.npcMul = 0.35;              // 被守卫攻击时伤害减免，保证任务可完成
      npc.captive = true;             // 被囚禁：不移动，等待解救
      // 6 名守卫环绕囚徒（近战为主，保证玩家能快速清场）
      const guards = [];
      const A = CFG.world;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.random() * 0.3;
        const d = 78 + Math.random() * 26;
        const g = G.makeEnemy(state.wave, i, i % 3 === 2 ? 'brute' : 'melee');
        g.x = Math.max(40, Math.min(A.w - 40, spot.x + Math.cos(a) * d));
        g.y = Math.max(40, Math.min(A.h - 40, spot.y + Math.sin(a) * d));
        g.guard = true;               // 标记为守卫，玩家击杀后计入解救进度
        g.guardOf = npc;
        guards.push(g);
        state.foes.push(g);
      }
      state.task = { kind, npc, guards, nearHazard: spot.nearHazard, time: ESCORT_TIME, total: ESCORT_TIME };
      state.banner = {
        text: '⛓ 解救俘虏',
        sub: spot.nearHazard
          ? '击杀守卫救出囚徒 · 把守卫引进地形陷阱里更快'
          : '击杀守卫救出囚徒 · 救出后成为同伴（' + ESCORT_TIME + ' 秒内）',
        t: 2.6
      };
      G.sfxBoss();
    } else if (kind === 'defense') {
      state.task = { kind, time: DEFENSE_TIME, total: DEFENSE_TIME };
      state.spawnRateMul = 0.65;      // 刷怪间隔 ×0.65 ≈ 怪潮
      state.banner = { text: '💀 怪潮来袭', sub: '撑过 ' + DEFENSE_TIME + ' 秒 · 攻击将永久 +4', t: 2.6 };
      G.sfxBoss();
    } else if (kind === 'crystal') {
      const crystals = [];
      for (let i = 0; i < 2; i++) {
        const spot = spotNearPlayer(180, 320);
        const c = G.makeUnit({
          hp: Math.round(G.curveHp(state.wave) * 2.2),
          atk: 0, def: 0,
          x: spot.x, y: spot.y, r: 16,
          type: 'crystal', name: '召唤水晶', emoji: '🔮', xp: 8
        });
        c.noKill = false;
        crystals.push(c);
        state.foes.push(c);
      }
      state.task = { kind, crystals, spawnedT: 0, time: CRYSTAL_TIME, total: CRYSTAL_TIME };
      state.banner = { text: '🔮 召唤水晶', sub: '限时摧毁全部水晶 · 奖励全局冷却强化', t: 2.6 };
    } else if (kind === 'stars') {
      const stars = [];
      for (let i = 0; i < 3; i++) {
        const spot = spotNearPlayer(150, 300);
        stars.push({ x: spot.x, y: spot.y, taken: false, t: Math.random() * 6 });
      }
      state.task = { kind, stars, taken: 0, time: STARS_TIME, total: STARS_TIME };
      state.banner = { text: '✦ 流星坠落', sub: STARS_TIME + ' 秒内收集至少 2 颗流星 · 幸运 +1', t: 2.6 };
    }
  }

  /* =========================================================
     活动任务推进
     ========================================================= */
  function updateActiveTask(t, dt) {
    if (t.kind === 'escort') {
      // 解救俘虏：囚徒死亡 → 失败；守卫全灭 → 解救成功转同伴；超时 → 失败
      if (!t.npc || t.npc.dead) { failTask('囚徒遇害了'); return; }
      const guardsLeft = (t.guards || []).filter(g => !g.dead).length;
      if (guardsLeft === 0) {
        state.companion = {
          x: t.npc.x, y: t.npc.y, r: 12,
          hp: t.npc.hp, maxHp: t.npc.maxHp,
          type: 'companion', name: '同伴', emoji: '🧝',
          flashT: 0, iframes: 0, shield: 0, def: 0, agg: {}, dead: false, noKill: true, npcMul: 0.5,
          atkCd: 0
        };
        succeedTask('囚徒已解救 · 转为同伴并肩作战！');
      } else if (t.time <= 0) {
        failTask('未能在时限内救出囚徒');
      }
    } else if (t.kind === 'defense') {
      if (t.time <= 0) {
        state.spawnRateMul = 1;
        const p = state.player;
        p.baseAtk += 4;
        G.refresh(p);
        succeedTask('怪潮已退 · 攻击永久 +4');
      }
    } else if (t.kind === 'crystal') {
      // 水晶周期召唤小怪
      t.spawnedT -= dt;
      if (t.spawnedT <= 0) {
        t.spawnedT = 4;
        t.crystals.forEach(c => {
          if (c.dead) return;
          if (state.foes.filter(f => !f.dead).length >= G.aliveCap(state.wave)) return;
          const e = G.makeEnemy(state.wave, Math.floor(Math.random() * 10), 'melee');
          e.x = c.x + (Math.random() * 60 - 30);
          e.y = c.y + (Math.random() * 60 - 30);
          state.foes.push(e);
        });
      }
      const alive = t.crystals.filter(c => !c.dead);
      if (!alive.length) {
        // 成功：全局冷却强化（独立于冷却卡，上限 30%）
        const p = state.player;
        p.taskCdr = Math.min(3, (p.taskCdr || 0) + 1);
        if (G.applySkillBuild) G.applySkillBuild(p);
        succeedTask('水晶已摧毁 · 所有攻击间隔额外 −10%');
      } else if (t.time <= 0) {
        // 失败：60 秒内敌人增伤
        state.enemyRageT = 60;
        state.banner = { text: '任务失败', sub: '水晶仍在涌出怪物 · 敌人攻击 +15%（60 秒）', t: 2.4 };
        endTask();
      }
    } else if (t.kind === 'stars') {
      const p = state.player;
      t.stars.forEach(s => {
        if (s.taken) return;
        if (G.dist(p.x, p.y, s.x, s.y) < 36 + p.r) {
          s.taken = true;
          t.taken++;
          G.sfxUpgrade();
        }
      });
      if (t.taken >= 2) {
        p.luck += 1;
        succeedTask('收集 ' + t.taken + ' 颗流星 · 幸运 +1');
      } else if (t.time <= 0) {
        succeedTask('流星已消散 · 期待下次坠落');   // 无惩罚，走成功结算仅提示
      }
    }
  }

  function succeedTask(msg) {
    state.banner = { text: '✔ 任务完成', sub: msg, t: 2.6 };
    G.sfxUpgrade();
    endTask();
  }

  function failTask(reason) {
    const p = state.player;
    // 惩罚：最大生命 −15%（本局）+ 当前生命 −40%
    p.baseHp = Math.max(20, Math.round(p.baseHp * 0.9));
    G.refresh(p);
    p.hp = Math.max(1, Math.round(p.hp * 0.7));
    state.banner = { text: '✖ 任务失败', sub: reason + ' · 最大生命 −10%', t: 2.6 };
    G.sfxHurt();
    endTask();
  }

  function endTask() {
    state.task = null;
    state.spawnRateMul = 1;
    scheduleNext();
  }

  /* =========================================================
     敌人索敌焦点：解救俘虏任务中守卫追玩家（玩家须清怪救人）
     —— 囚徒站桩被囚禁，不再让敌人转攻它；守卫全部扑向玩家
     ========================================================= */
  function taskFocus(e) {
    // 解救任务：所有敌人（含守卫）均追玩家，玩家清光守卫即解救成功
    return state.player;
  }

  /* =========================================================
     同伴：跟随玩家 + 自动射击最近敌人
     ========================================================= */
  function updateCompanion(dt) {
    const c = state.companion;
    const p = state.player;
    if (!c || !p || p.dead) return;
    if (c.dead) { state.companion = null; return; }

    // 跟随（落后于玩家身后），距离过远直接拉回
    const d = G.dist(c.x, c.y, p.x, p.y);
    if (d > 150) { c.x = p.x - 24; c.y = p.y - 24; }
    else if (d > 44) {
      const n = G.norm(p.x - c.x, p.y - c.y);
      const spd = Math.min(220, d * 3);
      c.x += n.x * spd * dt;
      c.y += n.y * spd * dt;
    }

    // 自动射击最近敌人（70% 玩家攻击，箭矢乘区）
    c.atkCd -= dt;
    if (c.atkCd <= 0) {
      const tgt = G.nearestFoeFrom(c.x, c.y, p.range * 1.2);
      if (tgt) {
        const a = Math.atan2(tgt.y - c.y, tgt.x - c.x);
        const spd = CFG.player.bulletSpeed;
        state.bullets.push({
          x: c.x, y: c.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
          r: 4, dmg: Math.max(1, Math.round(p.atk * 0.7)), side: 'p',
          life: p.range / spd, owner: p, hit: [], tag: 'arrow', color: '#fbbf24', noSplit: true
        });
        c.atkCd = 1.2;
      }
    }
  }

  Object.assign(G, {
    updateTasks, startTask, startRandomTask, taskFocus, updateCompanion
  });
})(window.ABYSS = window.ABYSS || {});
