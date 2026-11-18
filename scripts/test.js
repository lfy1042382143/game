/* ============================================================
   无头测试 harness（实时版 · 经验升级 + 大地图）
   Node vm + DOM stub，验证战斗逻辑与流程状态机
   用法：
     node scripts/test.js          功能测试
     node scripts/test.js --sim N  平衡模拟 N 局
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- DOM stub ---------- */
function makeClassList() {
  const s = new Set();
  return {
    add: (...c) => c.forEach(x => s.add(x)),
    remove: (...c) => c.forEach(x => s.delete(x)),
    toggle: (c, v) => { if (v === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (v) s.add(c); else s.delete(c); },
    contains: c => s.has(c)
  };
}

function makeEl(id) {
  return {
    id: id || '',
    children: [],
    dataset: {},
    offsetWidth: 0,
    style: { setProperty: () => {}, width: '' },
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = v; this.children = []; },
    textContent: '',
    title: '',
    className: '',
    appendChild(c) { this.children.push(c); return c; },
    querySelectorAll() { return []; },
    addEventListener() {},
    classList: makeClassList(),
    getContext() { return makeCtx(); }
  };
}

function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 960, height: 600 };
      return () => undefined;
    },
    set() { return true; }
  });
}

const documentStub = {
  readyState: 'complete',
  _els: {},
  getElementById(id) {
    if (!this._els[id]) this._els[id] = makeEl(id);
    return this._els[id];
  },
  createElement() { return makeEl(''); },
  addEventListener() {}
};

/* ---------- 沙盒 ---------- */
const sandbox = {
  console,
  Math, Date, JSON, Promise, Array, Object, String, Number, Boolean, Set, Map,
  isNaN, parseInt, parseFloat,
  document: documentStub,
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); } },
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  addEventListener() {},
  setTimeout, clearTimeout
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);

const SCRIPTS = [
  'js/core/config.js', 'js/core/utils.js', 'js/core/audio.js', 'js/core/engine.js',
  'js/game/equipment.js', 'js/game/state.js', 'js/game/combat.js',
  'js/game/bullets.js', 'js/game/player.js', 'js/game/enemies.js', 'js/game/waves.js',
  'js/game/loot.js', 'js/game/cards.js', 'js/game/events.js', 'js/game/flow.js',
  'js/ui/ui.js', 'js/render/render.js', 'js/main.js'
];

for (const s of SCRIPTS) {
  const code = fs.readFileSync(path.join(__dirname, '..', s), 'utf8');
  vm.runInContext(code, ctx, { filename: s });
}

const G = sandbox.ABYSS;
const engineKeys = G.engine.keys;

/* ---------- 测试工具 ---------- */
let pass = 0, fail = 0;
function assert(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : '')); }
}

const STEP = 1 / 60;
function run(seconds, bot) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    if (bot) bot();
    if (G.state.phase === 'play') G.update(STEP);
    else break;
  }
}

function reset() { G.startRun(); }

/* ============================================================
   功能测试
   ============================================================ */
function featureTests() {
  console.log('\n=== 功能测试 ===');

  // T1 开局
  reset();
  assert(G.state.phase === 'play', 'T1 开局进入 play 阶段');
  assert(G.state.foes.length === 1, 'T1 第 1 波只有 1 个敌人', G.state.foes.length);
  const boost1 = G.state.mapIdx === 0 ? 1 : 1 + G.CFG.mon.mapBoost * G.state.mapIdx;
  assert(Math.abs(G.state.foes[0].hp - Math.round(G.curveHp(1) * boost1)) <= 1, 'T1 敌人血量符合曲线（含地图增幅）', G.state.foes[0].hp);
  assert(G.state.obstacles.length >= 4, 'T1 初始世界有随机障碍物', G.state.obstacles.length);
  assert(G.CFG.world.w === 2000 && G.CFG.world.h === 1400, 'T1 大世界尺寸 2000×1400');

  // T2 WASD 移动 + 世界边界
  const y0 = G.state.player.y;
  engineKeys.add('w');
  run(1);
  engineKeys.delete('w');
  assert(G.state.player.y < y0 - 80, 'T2 W 键向上移动（移速已全局降低）', { y0, y1: G.state.player.y });
  engineKeys.add('d');
  run(3);
  engineKeys.delete('d');
  assert(G.state.player.x <= 2000 - 13, 'T2 世界边界约束生效', G.state.player.x);

  // T3 近战敌人追击
  reset();
  const foe = G.state.foes[0];
  foe.x = G.state.player.x - 400; foe.y = G.state.player.y;
  const d0 = G.dist(foe.x, foe.y, G.state.player.x, G.state.player.y);
  run(1.5);
  const d1 = G.dist(foe.x, foe.y, G.state.player.x, G.state.player.y);
  assert(d1 < d0, 'T3 近战敌人向玩家靠近', { d0: Math.round(d0), d1: Math.round(d1) });
  assert(G.CFG.melee.speed > G.CFG.player.speed * 0.85, 'T3 近战移速接近玩家（相对更快）', { melee: G.CFG.melee.speed, player: G.CFG.player.speed });

  // T4 远程敌人发射弹幕（弹幕已降速）
  reset();
  const rf = G.state.foes[0];
  rf.type = 'ranged';
  rf.x = G.state.player.x; rf.y = G.state.player.y - 260;
  rf.atkCd = 0;
  const b0 = G.state.bullets.length;
  run(0.3);
  const eb = G.state.bullets.filter(b => b.side === 'e');
  assert(G.state.bullets.length > b0 && eb.length > 0, 'T4 远程敌人发射弹幕');
  assert(G.CFG.ranged.bulletSpeed < 200, 'T4 敌方弹幕速度已降低', G.CFG.ranged.bulletSpeed);

  // T5 弹幕命中玩家 + 无敌帧
  G.state.player.iframes = 0;
  G.state.player.shield = 0;
  const hp0 = G.state.player.hp;
  G.state.bullets.push({ x: G.state.player.x, y: G.state.player.y + 48, vx: 0, vy: -96, r: 6, dmg: 10, side: 'e', life: 2, owner: rf });
  run(0.65);
  assert(G.state.player.hp < hp0, 'T5 敌方弹幕对玩家造成伤害', { hp0, hp1: G.state.player.hp });
  assert(G.state.player.iframes > 0, 'T5 受击后进入无敌帧', G.state.player.iframes);

  // T6 玩家自动射击命中敌人
  reset();
  const tf = G.state.foes[0];
  tf.x = G.state.player.x + 150; tf.y = G.state.player.y;
  const fh0 = tf.hp;
  run(3);
  assert(tf.hp < fh0 || tf.dead, 'T6 玩家自动射击命中敌人', { fh0, fh1: tf.hp });

  // T15 经验获取与自动升级
  reset();
  const p15 = G.state.player;
  const lv0 = p15.level;
  G.gainXp(G.xpNeed(p15.level));       // 喂满一级经验
  assert(p15.level === lv0 + 1, 'T15 经验满自动升级', { lv0, lv1: p15.level });
  assert(p15.baseAtk === G.CFG.player.atk + G.CFG.growth.atk, 'T15 升级自动加攻击', p15.baseAtk);
  assert(p15.baseHp === G.CFG.player.hp + G.CFG.growth.hp, 'T15 升级自动加生命', p15.baseHp);
  assert(G.state.pendingLevelUps === 1, 'T15 升级累积待处理选项', G.state.pendingLevelUps);

  // T16 升级卡效果：攻速 / 散射 / 环绕飞刃
  const haste = G.LEVEL_POOL[0], multi = G.LEVEL_POOL[1], orbit = G.LEVEL_POOL[4];
  haste.apply(p15);
  multi.apply(p15);
  orbit.apply(p15);
  assert(Math.abs(G.effAtkCd(p15) - G.CFG.player.atkCd * 0.82) < 0.01, 'T16 攻速提升卡生效', G.effAtkCd(p15));
  assert(p15.shots === 2, 'T16 散射箭卡生效', p15.shots);
  assert(p15.orbits === 2, 'T16 环绕飞刃卡生效', p15.orbits);
  // 散射：一次 volley 生成 2 支箭
  G.state.foes[0].x = p15.x + 200; G.state.foes[0].y = p15.y;
  const nb0 = G.state.bullets.length;
  G.fireVolley(p15, G.state.foes[0]);
  assert(G.state.bullets.length - nb0 === 2, 'T16 散射 volley 发射 2 支箭', G.state.bullets.length - nb0);

  // T17 等级里程碑解锁新地图（每 4 级一档：5/9/13 级解锁）
  reset();
  G.state.player.level = 4;
  G.gainXp(G.xpNeed(4));
  assert(G.state.player.level === 5, 'T17 升到 5 级', G.state.player.level);
  assert(G.state.mapIdx === 1, 'T17 5 级解锁第二张地图', G.state.mapIdx);
  assert(G.MAPS[G.state.mapIdx].name === '荒芜骨林', 'T17 新地图主题生效', G.MAPS[G.state.mapIdx].name);

  // T18 动态障碍物：随移动生成与移除
  reset();
  const obs0 = G.state.obstacles.length;
  for (let i = 0; i < 8; i++) G.spawnObstacleNearPlayer();
  assert(G.state.obstacles.length > obs0, 'T18 障碍物随玩家移动生成', { obs0, obs1: G.state.obstacles.length });
  assert(G.state.obstacles.length <= G.CFG.obstacles.cap, 'T18 障碍物数量有上限', G.state.obstacles.length);
  // 移走后应被清除
  G.state.player.x = 100; G.state.player.y = 1300;
  G.cullObstacles();
  const farAll = G.state.obstacles.every(o => G.dist(100, 1300, o.x + o.w / 2, o.y + o.h / 2) <= G.CFG.obstacles.cullDist);
  assert(farAll, 'T18 远处障碍物被移除');

  // T19 敌人随机出现在玩家附近
  reset();
  const f19 = G.state.foes[0];
  const d19 = G.dist(f19.x, f19.y, G.state.player.x, G.state.player.y);
  assert(d19 >= 300 && d19 <= 750, 'T19 敌人刷新在玩家周围环带', Math.round(d19));

  // T7 波次全灭 → 升级选项 → 战利品 → 继续探索 → 下一波
  reset();
  G.state.foes[0].items.length = 0;
  G.state.foes[0].items.push(G.buildItem('weapon', 0, 1, 1));
  G.state.foes[0].agg = G.aggregate(G.state.foes[0].items);
  G.state.foes.forEach(f => { f.hp = 0.5; });
  run(5);
  // 第 1 波击杀经验 = 8 < 15，不会升级 → 直接战利品
  assert(G.state.phase === 'loot', 'T7 全灭后进入战利品阶段', G.state.phase);
  assert(G.state.loots.length === 1, 'T7 敌人装备掉落为战利品', G.state.loots.length);

  // T8 拾取 → 继续探索 → 第 2 波
  G.takeLoot(0);
  assert(G.state.player.items.length === 1, 'T8 战利品装备到玩家');
  G.continueLoot();
  assert(G.state.wave === 2, 'T8 继续探索后进入第 2 波', G.state.wave);
  assert(G.state.phase === 'play', 'T8 回到 play 阶段', G.state.phase);

  // T9 升级优先于战利品 + 事件仍正常触发
  reset();
  G.state.wave = 3;
  G.state.foes.forEach(f => { f.dead = true; f.hp = 0; f.xp = 10; G.gainXp(10); });
  G.rollLoot();
  G.state.pendingLevelUps = 1;         // 模拟击杀中攒下的升级
  G.onVictory();
  assert(G.state.phase === 'levelup', 'T9 升级选项优先弹出', G.state.phase);
  G.chooseLevelCard({ kind: 'attr', attr: 'atk', apply(pp) { pp.baseAtk += 9; } });
  assert(G.state.phase === 'loot', 'T9 升级处理完转入战利品', G.state.phase);
  G.clearLoot();
  G.continueLoot();                    // wave → 4，cleared=3，应触发事件
  assert(G.state.phase === 'event', 'T9 清完第 3 波后触发场景事件', G.state.phase);
  G.chooseEventOption(G.EVENTS[0].options[2]);
  assert(G.state.phase === 'play' && G.state.wave === 4, 'T9 事件选择后进入下一波', { phase: G.state.phase, wave: G.state.wave });

  // T10 词缀确定性 + BOSS 不带词缀 + 数量曲线
  const w3 = G.composeWave(3);
  assert(w3.length === 1, 'T10 第 3 波仍 1 个敌人', w3.length);
  assert(w3[0].affix && w3[0].affix.key === G.AFFIXES[0].key, 'T10 第 3 波首个敌人带「重甲」词缀', w3[0].affix && w3[0].affix.key);
  assert(G.composeWave(4).length === 2, 'T10 第 4 波起每 3 波+1', G.composeWave(4).length);
  const w5 = G.composeWave(5);
  assert(G.isBossWave(5), 'T10 第 5 波是 BOSS 波');
  assert(w5[0].type === 'boss' && !w5[0].affix, 'T10 BOSS 不带词缀');
  assert(w5[0].xp >= 40, 'T10 BOSS 提供大量经验', w5[0].xp);
  const w13 = G.composeWave(13);
  assert(w13.length === 5, 'T10 第 13 波 5 个敌人（上限）', w13.length);

  // T11 BOSS 扇形弹幕
  reset();
  G.state.wave = 5;
  G.state.foes = G.composeWave(5);
  const boss = G.state.foes[0];
  boss.x = G.state.player.x; boss.y = G.state.player.y - 200;
  boss.atkCd = 0;
  run(0.5);
  assert(G.state.bullets.filter(b => b.side === 'e').length >= 3, 'T11 BOSS 发射 3 向扇形弹幕', G.state.bullets.length);

  // T12 尖刺反伤
  reset();
  G.state.player.shield = 0;
  G.state.player.iframes = 0;
  const sf = G.state.foes[0];
  sf.affix = G.AFFIXES[4];
  const php0 = G.state.player.hp;
  G.dealDamage(G.state.player, sf, 10);
  assert(G.state.player.hp < php0, 'T12 尖刺词缀反伤生效', { php0, php1: G.state.player.hp });

  // T13 血刃流血 DoT
  reset();
  const bf = G.state.foes[0];
  G.applyBleed(bf, { dmg: 5, turns: 3 });
  const bhp0 = bf.hp;
  run(3.5);
  assert(bf.hp < bhp0 || bf.dead, 'T13 流血每秒跳伤害', { bhp0, bhp1: bf.hp });

  // T14 贯穿箭穿透两个敌人
  reset();
  const p14 = G.state.player;
  p14.pierce = 1;
  const fa = G.state.foes[0];
  fa.x = p14.x + 100; fa.y = p14.y;
  const fahp0 = fa.hp;
  // 造一支贯穿箭
  G.state.bullets.push({ x: p14.x, y: p14.y, vx: 250, vy: 0, r: 5, dmg: 5, crit: false, side: 'p', life: 2, owner: p14, pierceLeft: 1, homing: 0, hit: [] });
  run(1);
  assert(fa.hp < fahp0, 'T14 贯穿箭命中第一个敌人', { fahp0, fh1: fa.hp });

  console.log('\n功能测试结果: ' + pass + ' 通过, ' + fail + ' 失败');
  return fail;
}

/* ============================================================
   平衡模拟：人类化走位 bot，统计到达波次分布
   ============================================================ */
function simulate(runs) {
  console.log('\n=== 平衡模拟（' + runs + ' 局，人类化 bot） ===');

  // 自动推进弹窗流程
  function autoAdvance() {
    const st = G.state;
    if (st.phase === 'levelup') {
      // 升级卡：优先攻击方式（散射 > 攻速 > 环绕 > 贯穿 > 追踪），否则选攻击
      const modeCards = st.player.shots < 4 ? ['multi'] : [];
      const card = { kind: 'mode', key: 'multi', apply(pp) { pp.shots++; } };
      if (st.player.shots >= 4) card.key = 'haste', card.apply = pp => { pp.atkCdMul = Math.max(0.35, pp.atkCdMul * 0.82); };
      G.chooseLevelCard(card);
      return;
    }
    if (st.phase === 'loot') {
      let guard = 0;
      while (G.lootPending() > 0 && guard++ < 10) {
        const idx = st.loots.findIndex(e => !e.done);
        if (idx < 0) break;
        G.takeLoot(idx);
      }
      G.continueLoot();
      return;
    }
    if (st.phase === 'event') {
      const overlay = sandbox.document._els.eventOverlay;
      if (overlay.classList.contains('show')) {
        G.chooseEventOption(G.EVENTS[0].options[G.EVENTS[0].options.length - 1]);
      }
    }
  }

  /** 人类化走位 bot：0.28s 反应延迟 + 6% 失误 */
  let botTimer = 0;
  function botControl(dt) {
    const st = G.state;
    const p = st.player;
    const alive = st.foes.filter(f => !f.dead);
    botTimer -= dt;
    if (botTimer > 0) return;
    botTimer = 0.28;
    if (!alive.length || !p) { engineKeys.clear(); return; }

    let near = null, nd = Infinity;
    for (const f of alive) {
      const d = G.dist(p.x, p.y, f.x, f.y);
      if (d < nd) { nd = d; near = f; }
    }

    engineKeys.clear();
    if (!near) return;

    let dx, dy;
    if (Math.random() < 0.04) {
      dx = near.x - p.x; dy = near.y - p.y;
    } else if (nd > 360) {
      dx = near.x - p.x; dy = near.y - p.y;
    } else {
      dx = p.x - near.x; dy = p.y - near.y;
      dx += (p.x > G.CFG.world.w / 2 ? 1 : -1) * 60;
    }

    if (Math.abs(dx) > 8) engineKeys.add(dx > 0 ? 'd' : 'a');
    if (Math.abs(dy) > 8) engineKeys.add(dy > 0 ? 's' : 'w');
  }

  const wavesReached = [];
  const levelsReached = [];
  const mapsReached = [];
  const start = Date.now();

  for (let r = 0; r < runs; r++) {
    reset();
    let guard = 0;
    while (G.state.phase !== 'over' && guard++ < 300000) {
      botControl(STEP);
      if (G.state.phase === 'play') {
        G.update(STEP);
      } else {
        autoAdvance();
      }
      if (guard % 50000 === 0) autoAdvance();
    }
    wavesReached.push(G.state.wave);
    levelsReached.push(G.state.player.level);
    mapsReached.push(G.state.mapIdx + 1);
  }

  function stats(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    return {
      med: s[Math.floor(s.length / 2)],
      p10: s[Math.floor(s.length * 0.1)],
      p90: s[Math.floor(s.length * 0.9)],
      avg: (s.reduce((a, b) => a + b, 0) / s.length).toFixed(1)
    };
  }
  const w = stats(wavesReached), l = stats(levelsReached), m = stats(mapsReached);

  console.log('  波次   中位: ' + w.med + ' | p10: ' + w.p10 + ' | p90: ' + w.p90 + ' | 平均: ' + w.avg);
  console.log('  等级   中位: ' + l.med + ' | p10: ' + l.p10 + ' | p90: ' + l.p90 + ' | 平均: ' + l.avg);
  console.log('  地图   中位: ' + m.med + ' | 最多: ' + Math.max(...mapsReached));
  console.log('  波次分布: ' + wavesReached.join(', '));
  console.log('  耗时: ' + ((Date.now() - start) / 1000).toFixed(1) + 's');
}

/* ---------- 入口 ---------- */
const simRuns = process.argv.includes('--sim') ? Number(process.argv[process.argv.indexOf('--sim') + 1] || 20) : 0;
const failures = featureTests();
if (simRuns > 0) simulate(simRuns);
process.exit(fail > 0 ? 1 : 0);
