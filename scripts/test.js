/* ============================================================
   无头测试 harness（实时版）
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
  const el = {
    id: id || '',
    children: [],
    dataset: {},
    offsetWidth: 0,
    style: { setProperty: () => {} },
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
  return el;
}

function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 960, height: 600 };
      return (...a) => undefined;   // 所有绘制方法 no-op
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
  setTimeout, clearTimeout, setInterval, clearInterval
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
/** 以 play 阶段推进 N 秒（模拟引擎循环） */
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
  assert(G.state.foes[0].hp === Math.round(G.curveHp(1)), 'T1 第 1 波敌人血量符合曲线', G.state.foes[0].hp);
  assert(G.state.obstacles.length === 4, 'T1 竞技场有 4 根柱子');

  // T2 WASD 移动
  const y0 = G.state.player.y;
  engineKeys.add('w');
  run(1);
  engineKeys.delete('w');
  assert(G.state.player.y < y0 - 100, 'T2 W 键向上移动', { y0, y1: G.state.player.y });
  engineKeys.add('d');
  run(0.5);
  engineKeys.delete('d');
  assert(G.state.player.x > 480, 'T2 D 键向右移动', G.state.player.x);
  assert(G.state.player.x <= 960 - 14, 'T2 边界约束生效', G.state.player.x);

  // T3 近战敌人追击
  reset();
  const foe = G.state.foes[0];
  foe.type = 'melee';
  foe.x = 100; foe.y = 100;
  const d0 = G.dist(foe.x, foe.y, G.state.player.x, G.state.player.y);
  run(1.5);
  const d1 = G.dist(foe.x, foe.y, G.state.player.x, G.state.player.y);
  assert(d1 < d0, 'T3 近战敌人向玩家靠近', { d0: Math.round(d0), d1: Math.round(d1) });

  // T4 远程敌人发射弹幕
  reset();
  const rf = G.state.foes[0];
  rf.type = 'ranged';
  rf.x = 480; rf.y = 100;
  rf.atkCd = 0;
  G.state.player.x = 480; G.state.player.y = 400;
  const b0 = G.state.bullets.length;
  run(0.2);
  const eb = G.state.bullets.filter(b => b.side === 'e');
  assert(G.state.bullets.length > b0 && eb.length > 0, 'T4 远程敌人发射弹幕');

  // T5 弹幕命中玩家
  G.state.player.iframes = 0;
  G.state.player.shield = 0;
  const hp0 = G.state.player.hp;
  G.state.bullets.push({ x: G.state.player.x, y: G.state.player.y + 48, vx: 0, vy: -96, r: 6, dmg: 10, side: 'e', life: 2, owner: rf });
  run(0.65);   // 命中发生在 ~0.5s，断言时无敌帧仍在
  assert(G.state.player.hp < hp0, 'T5 敌方弹幕对玩家造成伤害', { hp0, hp1: G.state.player.hp });
  assert(G.state.player.iframes > 0, 'T5 受击后进入无敌帧', G.state.player.iframes);

  // T6 玩家自动射击命中敌人
  reset();
  const tf = G.state.foes[0];
  tf.x = G.state.player.x + 150; tf.y = G.state.player.y;
  const fh0 = tf.hp;
  run(3);
  assert(tf.hp < fh0 || tf.dead, 'T6 玩家自动射击命中敌人', { fh0, fh1: tf.hp });

  // T7 全灭 → 升级阶段 + 战利品
  reset();
  G.state.foes[0].items.length = 0;   // 清掉怪物自带装备，只留测试注入的一件
  G.state.foes[0].items.push(G.buildItem('weapon', 0, 1, 1));
  G.state.foes[0].agg = G.aggregate(G.state.foes[0].items);
  G.state.foes.forEach(f => { f.hp = 0.5; });
  run(5);
  assert(G.state.phase === 'upgrade', 'T7 全灭后进入升级阶段', G.state.phase);
  assert(G.state.loots.length === 1, 'T7 敌人装备掉落为战利品', G.state.loots.length);

  // T8 拾取 + 选卡 → 下一波
  G.takeLoot(0);
  assert(G.state.player.items.length === 1, 'T8 战利品装备到玩家');
  G.chooseUpgrade({ attr: 'atk', ri: 1, val: 9 }, {});
  assert(G.state.wave === 2, 'T8 选卡后进入第 2 波', G.state.wave);
  assert(G.state.phase === 'play', 'T8 选卡后回到 play 阶段', G.state.phase);

  // T9 事件触发（清完第 3 波后）
  reset();
  G.state.wave = 3;
  G.state.foes.forEach(f => { f.dead = true; f.hp = 0; });
  run(0.2);
  assert(G.state.phase === 'upgrade', 'T9 第 3 波全灭进入升级');
  G.clearLoot();
  G.advanceWave();   // wave → 4，cleared=3，应触发事件
  assert(G.state.phase === 'event', 'T9 清完第 3 波后触发场景事件', G.state.phase);
  G.chooseEventOption(G.EVENTS[0].options[2]);   // 离开
  assert(G.state.phase === 'play' && G.state.wave === 4, 'T9 事件选择后进入下一波', { phase: G.state.phase, wave: G.state.wave });

  // T10 词缀确定性 + BOSS 不带词缀
  const w3 = G.composeWave(3);
  assert(w3[0].affix && w3[0].affix.key === G.AFFIXES[0].key, 'T10 第 3 波首个敌人带「重甲」词缀', w3[0].affix && w3[0].affix.key);
  const w5 = G.composeWave(5);
  assert(G.isBossWave(5), 'T10 第 5 波是 BOSS 波');
  assert(w5[0].type === 'boss' && !w5[0].affix, 'T10 BOSS 不带词缀');
  const w7 = G.composeWave(7);
  assert(w7.some(f => f.affix), 'T10 第 7 波敌人带词缀');
  const w3b = G.composeWave(3);
  assert(w3[0].affix.key === w3b[0].affix.key, 'T10 词缀分配确定性（两次编成一致）');

  // T11 BOSS 扇形弹幕
  reset();
  G.state.wave = 5;
  G.state.foes = G.composeWave(5);
  const boss = G.state.foes[0];
  boss.x = 480; boss.y = 100;
  G.state.player.x = 480; G.state.player.y = 300;
  boss.atkCd = 0;
  run(0.5);
  assert(G.state.bullets.filter(b => b.side === 'e').length >= 3, 'T11 BOSS 发射 3 向扇形弹幕', G.state.bullets.length);

  // T12 尖刺反伤
  reset();
  G.state.player.shield = 0;
  G.state.player.iframes = 0;
  const sf = G.state.foes[0];
  sf.affix = G.AFFIXES[4];   // spikes
  sf.baseDef = Math.round(sf.baseDef * 0.6);
  G.refresh(sf);
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

  // T14 疾步之靴加速（移速在移动时按词缀乘算，不直接改 p.speed）
  reset();
  const p = G.state.player;
  p.items.push(G.buildItem('helm', 2, 2, 1));   // 稀有疾步之靴：+12% 移速
  G.refresh(p);
  assert(p.agg.swiftstep > 0, 'T14 疾步之靴聚合生效', p.agg.swiftstep);
  engineKeys.add('d');
  const sx = p.x;
  run(0.5);
  engineKeys.delete('d');
  const moved = p.x - sx;
  assert(moved > 190 * 0.5 * 1.05, 'T14 移速实际提升（12% 加成）', { moved: Math.round(moved), expect: Math.round(190 * 0.5 * 1.12) });

  console.log('\n功能测试结果: ' + pass + ' 通过, ' + fail + ' 失败');
  return fail;
}

/* ============================================================
   平衡模拟：简单走位 bot，统计到达波次分布
   ============================================================ */
function simulate(runs) {
  console.log('\n=== 平衡模拟（' + runs + ' 局，走位 bot） ===');

  // 自动推进弹窗流程：战利品全拿（按 planFor 最优）→ 选攻击卡 → 事件选安全项
  function autoAdvance() {
    const st = G.state;
    if (st.phase === 'upgrade') {
      // 战利品逐件处理
      let guard = 0;
      while (G.lootPending() > 0 && guard++ < 10) {
        const idx = st.loots.findIndex(e => !e.done);
        if (idx < 0) break;
        G.takeLoot(idx);
      }
      // 选攻击卡（提高输出）
      G.chooseUpgrade({ attr: 'atk', ri: 1, val: 9 }, {});
      return;
    }
    if (st.phase === 'event') {
      // 总是选最后一个（离开/婉拒/绕行等安全项）
      const overlay = sandbox.document._els.eventOverlay;
      if (overlay.classList.contains('show')) {
        G.chooseEventOption(G.EVENTS[0].options[G.EVENTS[0].options.length - 1]);
      }
    }
  }

  /** 人类化走位 bot：
      - 每 0.28s 才重新决策一次（反应延迟）
      - 12% 概率失误：朝敌人方向移动（真实玩家会犯错）
      - 不刻意躲弹幕，主要靠保持距离 + 无敌帧 */
  let botTimer = 0;
  function botControl(dt) {
    const st = G.state;
    const p = st.player;
    const alive = st.foes.filter(f => !f.dead);
    botTimer -= dt;
    if (botTimer > 0) return;   // 反应延迟期间保持当前按键
    botTimer = 0.28;
    if (!alive.length || !p) { engineKeys.clear(); return; }

    // 找最近敌人
    let near = null, nd = Infinity;
    for (const f of alive) {
      const d = G.dist(p.x, p.y, f.x, f.y);
      if (d < nd) { nd = d; near = f; }
    }

    engineKeys.clear();
    if (!near) return;

    let dx, dy;
    if (Math.random() < 0.06) {
      // 失误：朝敌人走
      dx = near.x - p.x; dy = near.y - p.y;
    } else if (near.type === 'ranged' && nd > 320) {
      dx = near.x - p.x; dy = near.y - p.y;   // 远程太远则靠近输出
    } else {
      // 远离最近敌人 + 横向偏移避免被逼进墙角
      dx = p.x - near.x; dy = p.y - near.y;
      dx += (p.x > 480 ? 1 : -1) * 60;
    }

    if (Math.abs(dx) > 8) engineKeys.add(dx > 0 ? 'd' : 'a');
    if (Math.abs(dy) > 8) engineKeys.add(dy > 0 ? 's' : 'w');
  }

  const wavesReached = [];
  const start = Date.now();

  for (let r = 0; r < runs; r++) {
    reset();
    let guard = 0;
    while (G.state.phase !== 'over' && guard++ < 200000) {
      botControl(STEP);
      if (G.state.phase === 'play') {
        G.update(STEP);
      } else {
        autoAdvance();
      }
      // 防卡死：升级/事件流程卡住时跳过
      if (guard % 50000 === 0) autoAdvance();
    }
    wavesReached.push(G.state.wave);
  }

  wavesReached.sort((a, b) => a - b);
  const med = wavesReached[Math.floor(runs / 2)];
  const p10 = wavesReached[Math.floor(runs * 0.1)];
  const p90 = wavesReached[Math.floor(runs * 0.9)];
  const avg = (wavesReached.reduce((a, b) => a + b, 0) / runs).toFixed(1);

  console.log('  中位: ' + med + ' 波 | p10: ' + p10 + ' | p90: ' + p90 + ' | 平均: ' + avg);
  console.log('  分布: ' + wavesReached.join(', '));
  console.log('  耗时: ' + ((Date.now() - start) / 1000).toFixed(1) + 's');
}

/* ---------- 入口 ---------- */
const simRuns = process.argv.includes('--sim') ? Number(process.argv[process.argv.indexOf('--sim') + 1] || 20) : 0;
const failures = featureTests();
if (simRuns > 0) simulate(simRuns);
process.exit(fail > 0 ? 1 : 0);
