/* ============================================================
   无头测试 harness（实时版 · 时间驱动 endless）
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
    getContext() { return makeCtx(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 600 }; }
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
sandbox.__TEST__ = true;   // 让 main.js boot 跳过开局选武器界面，直接 startRun（保持测试可控）

const ctx = vm.createContext(sandbox);

const SCRIPTS = [
  'js/core/config.js', 'js/core/utils.js', 'js/core/audio.js', 'js/core/engine.js', 'js/core/touch.js',
  'js/game/equipment.js', 'js/game/skills.js', 'js/game/build.js', 'js/game/state.js', 'js/game/combat.js',
  'js/game/bullets.js', 'js/game/player.js', 'js/game/enemies.js', 'js/game/waves.js',
  'js/game/loot.js', 'js/game/cards.js', 'js/game/events.js', 'js/game/hazards.js', 'js/game/tasks.js', 'js/game/flow.js',
  'js/ui/ui.js', 'js/render/sprites.js', 'js/render/render.js', 'js/main.js'
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

/** 长时间运行：自动处理升级/战利品/事件弹窗（不移动玩家） */
function runFull(seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    const ph = G.state.phase;
    if (ph === 'play') G.update(STEP);
    else if (ph === 'levelup') G.chooseLevelCard({ kind: 'attr', attr: 'atk', val: 5 });
    else if (ph === 'loot') {
      let g = 0;
      while (G.lootPending() > 0 && g++ < 5) {
        const i2 = G.state.loots.findIndex(e => !e.done);
        if (i2 < 0) break;
        G.takeLoot(i2);
      }
      G.continueLoot();
    }
    else if (ph === 'event') {
      const site = G.state.activeSite;
      const opts = (site && site.evt ? site.evt : G.EVENTS[0]).options;
      G.chooseEventOption(opts[opts.length - 1]);
    }
    else if (ph === 'eventpick') {
      const cards = G.pickBuildCards(G.state.player, 3);
      G.chooseLevelCard(cards[0]);
    }
    else break;
  }
}

function reset() { G.engine.mouse.active = false; G.startRun(); }

/* ============================================================
   功能测试
   ============================================================ */
function featureTests() {
  console.log('\n=== 功能测试 ===');

  // T1 开局：无波次，敌人按时间源源刷新
  reset();
  assert(G.state.phase === 'play', 'T1 开局进入 play 阶段');
  assert(G.state.foes.length === 0, 'T1 开局没有预置敌人（时间驱动刷怪）', G.state.foes.length);
  assert(G.state.chests.length === 1, 'T1 开局有一个引导宝箱', G.state.chests.length);
  assert(G.state.sites.length === 1, 'T1 开局只有一个事件地点', G.state.sites.length);
  assert(G.state.obstacles.length >= 4, 'T1 初始世界有随机障碍物', G.state.obstacles.length);
  assert(G.CFG.world.w >= 50000 && G.CFG.world.h >= 50000, 'T1 巨大地图（模拟无边界）', G.CFG.world);
  const alive0 = G.state.foes.length;
  run(10);
  assert(G.state.foes.length > alive0, 'T1 敌人源源不断刷新', { t0: alive0, t10s: G.state.foes.length });
  assert(G.state.foes.length <= G.aliveCap(1), 'T1 存活数不超过上限', { n: G.state.foes.length, cap: G.aliveCap(1) });

  // T2 世界边界仅在极远处存在（正常游玩触不到）
  reset();
  const pEdge = G.state.player;
  pEdge.x = G.CFG.world.w - 300; pEdge.y = G.CFG.world.h / 2;
  const edgeX0 = pEdge.x;
  engineKeys.add('d');
  run(1);
  engineKeys.delete('d');
  assert(pEdge.x > edgeX0 + 80 && pEdge.x <= G.CFG.world.w - pEdge.r + 0.01,
    'T2 玩家可自由移动，仅在极远世界边缘受限', { x0: edgeX0, x1: pEdge.x });

  // T3 近战敌人追击（重装型：慢速但持续逼近）
  reset();
  const foe = G.makeEnemy(1, 0);
  G.state.obstacles = [];   // 清空障碍，排除绕行转向干扰
  G.state.foes.push(foe);
  foe.x = G.state.player.x - 400; foe.y = G.state.player.y;
  const d0 = G.dist(foe.x, foe.y, G.state.player.x, G.state.player.y);
  run(1.5);
  const d1 = G.dist(foe.x, foe.y, G.state.player.x, G.state.player.y);
  assert(d1 < d0, 'T3 近战敌人向玩家靠近', { d0: Math.round(d0), d1: Math.round(d1) });
  assert(G.CFG.melee.speed < G.CFG.player.speed, 'T3 近战移速慢于玩家（重装型）', { melee: G.CFG.melee.speed, player: G.CFG.player.speed });

  // T3b 玩家移速全场景最快
  const spdMax = Math.max(G.CFG.melee.speed, G.CFG.ranged.speed, G.CFG.mage.speed, G.CFG.boss.speed, G.CFG.mimic.crawl, G.CFG.mimic.dashSpd);
  assert(G.CFG.player.speed > Math.max(G.CFG.melee.speed, G.CFG.ranged.speed, G.CFG.boss.speed),
    'T3b 玩家常速快于所有敌兵（跳扑瞬发除外）', { player: G.CFG.player.speed, maxEnemy: spdMax });

  // T4 远程敌人发射弹幕（弹幕已降速）
  reset();
  const rf = G.makeEnemy(1, 6);   // idx 6 → ranged（idx%10: 5-7 为远程）
  G.state.foes.push(rf);
  rf.x = G.state.player.x; rf.y = G.state.player.y - 260;
  rf.atkCd = 0;
  const b0 = G.state.bullets.length;
  run(0.3);
  const eb = G.state.bullets.filter(b => b.side === 'e');
  assert(G.state.bullets.length > b0 && eb.length > 0, 'T4 远程敌人发射弹幕');
  assert(G.CFG.ranged.bulletSpeed < 200, 'T4 敌方弹幕速度已降低', G.CFG.ranged.bulletSpeed);

  // T4b 远程敌人贴近玩家时不再直线急速后撤（改为侧向环绕，距离基本保持）
  reset();
  const rfNear = G.makeEnemy(1, 6);
  G.state.foes = [rfNear];
  const pl = G.state.player;
  rfNear.x = pl.x + 90; rfNear.y = pl.y;   // 90 < keepMin(200)，处于"太近"区间
  G.state.obstacles = [];
  rfNear.atkCd = 999;                        // 屏蔽开火，专测走位
  const dNear0 = G.dist(rfNear.x, rfNear.y, pl.x, pl.y);
  run(1.2);
  const dNear1 = G.dist(rfNear.x, rfNear.y, pl.x, pl.y);
  assert(dNear1 < dNear0 + 40, 'T4b 远程敌人贴近时不再急速后撤',
    { before: Math.round(dNear0), after: Math.round(dNear1) });

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
  const tf = G.makeEnemy(1, 0);
  G.state.foes.push(tf);
  tf.x = G.state.player.x + 150; tf.y = G.state.player.y;
  const fh0 = tf.hp;
  run(3);
  assert(tf.hp < fh0 || tf.dead, 'T6 玩家自动射击命中敌人', { fh0, fh1: tf.hp });

  // T15 经验获取与自动升级（不再自动成长三维）
  reset();
  const p15 = G.state.player;
  const lv0 = p15.level;
  const atk0 = p15.baseAtk, hp0b = p15.baseHp;
  p15.hp = 10;                          // 先压低血量验证升级回满
  G.gainXp(G.xpNeed(p15.level));       // 喂满一级经验
  assert(p15.level === lv0 + 1, 'T15 经验满自动升级', { lv0, lv1: p15.level });
  assert(p15.hp === p15.maxHp, 'T15 升级血量回满', { hp: p15.hp, maxHp: p15.maxHp });
  assert(p15.baseAtk === atk0 && p15.baseHp === hp0b, 'T15 升级不再自动成长三维', { atk0, atk1: p15.baseAtk });
  assert(G.state.pendingLevelUps === 1, 'T15 升级累积待处理选项', G.state.pendingLevelUps);

  // T16 六条攻击方式线：解锁卡 + 随机维度卡（v9.18 重设计）
  const modeByKey = k => G.MODE_POOL.find(c => c.key === k);
  const unlockCard = k => G.SKILL_CARDS.find(c => c.kind === 'skill' && c.line === k && c.sub === 'unlock');
  const dimCard = (k, d) => G.SKILL_CARDS.find(c => c.kind === 'skill' && c.line === k && c.dim === d);
  const dimTotal = G.LINE_KEYS.reduce((n, k) => n + G.LINES[k].dims.length, 0);
  assert(G.LINE_KEYS.length === 8 && G.SKILL_CARDS.length === 8 + dimTotal,
    'T16 八条攻击方式线（解锁卡+维度卡）', { lines: G.LINE_KEYS, cards: G.SKILL_CARDS.length });
  assert(G.LINE_KEYS.includes('mine'), 'T16 地雷线保留', G.LINE_KEYS);
  assert(G.LINE_KEYS.includes('fireball') && G.LINE_KEYS.includes('boomerang'), 'T16 火球/回旋镖线已加入', G.LINE_KEYS);
  assert(!modeByKey('homing'), 'T16 追踪箭已从卡池删除');
  // 箭矢维度：数量/射速/弹射/穿透（分裂弹幕已删除）
  assert(p15.skills.arrow === 1, 'T16 箭矢初始解锁', p15.skills.arrow);
  assert(!dimCard('arrow', 'split'), 'T16 箭矢·分裂弹幕卡已删除');
  const aCount16 = dimCard('arrow', 'count');
  aCount16.apply(p15);
  assert(p15.shots === 2, 'T16 箭矢·数量维度 +1 支', p15.shots);
  const aRate16 = dimCard('arrow', 'rate');
  aRate16.apply(p15);
  assert(Math.abs(p15.atkCdMul - 0.88) < 1e-9, 'T16 箭矢·射速维度间隔 −12%', p15.atkCdMul);
  dimCard('arrow', 'pierce').apply(p15);
  assert(p15.pierce === 1, 'T16 箭矢·穿透维度', p15.pierce);
  dimCard('arrow', 'bounce').apply(p15);
  assert(p15.bounce === 1, 'T16 箭矢·弹射维度', p15.bounce);
  assert(aCount16.max(p15) === false, 'T16 数量维度未满仍可入池');
  // 解锁其余五条线；未解锁时其维度卡不出现
  const chainDimBefore = dimCard('chain', 'jumps');
  assert(chainDimBefore.max(p15) === true, 'T16 未解锁线的维度卡不入池');
  ['shock', 'chain', 'drone', 'mine', 'orbit'].forEach(k => {
    const c = unlockCard(k);
    c.apply(p15);
    assert(p15.skills[k] === 1, 'T16 解锁 ' + G.LINES[k].name, p15.skills[k]);
  });
  assert(chainDimBefore.max(p15) === false, 'T16 解锁后维度卡可入池');
  // 闪电初始伤害明显偏低（0.5×攻击），伤害维度 +0.15
  assert(Math.abs(p15.sk.chain.mult - 0.3) < 1e-9, 'T16 闪电初始伤害 0.3×攻击', p15.sk.chain.mult);
  dimCard('chain', 'dmg').apply(p15);
  assert(Math.abs(p15.sk.chain.mult - 0.55) < 1e-9, 'T16 闪电·伤害维度 +0.25', p15.sk.chain.mult);
  dimCard('chain', 'bolts').apply(p15);
  assert(p15.sk.chain.bolts === 2, 'T16 闪电·闪电数量维度', p15.sk.chain.bolts);
  // 震荡波次级震荡波维度
  dimCard('shock', 'echo').apply(p15);
  assert(p15.sk.shock.echo === 1, 'T16 震荡波·连锁震荡维度', p15.sk.shock.echo);
  // 飞刃：解锁后 2 枚，数量维度 +2
  assert(p15.sk.orbit.count === 3, 'T16 飞刃解锁 3 枚', p15.sk.orbit.count);
  dimCard('orbit', 'count').apply(p15);
  assert(p15.sk.orbit.count === 5, 'T16 飞刃·数量维度 +2 枚', p15.sk.orbit.count);
  assert(p15.sk.orbit.r >= 92, 'T16 飞刃绕行半径已上调', p15.sk.orbit.r);
  assert(Math.abs(p15.sk.orbit.interval - 3.5) < 1e-9, 'T16 飞刃重新部署间隔缩短至3.5s', p15.sk.orbit.interval);
  // 浮游炮维度：数量/子弹伤害/存在时间
  dimCard('drone', 'count').apply(p15);
  assert(p15.sk.drone.count === 2, 'T16 浮游炮·数量维度', p15.sk.drone.count);
  dimCard('drone', 'life').apply(p15);
  assert(Math.abs(p15.sk.drone.life - 5.5) < 1e-9, 'T16 浮游炮·存在时间维度', p15.sk.drone.life);
  // 地雷维度：伤害/数量/冷却/范围
  dimCard('mine', 'dmg').apply(p15);
  assert(Math.abs(p15.sk.mine.mult - 1.85) < 1e-9, 'T16 地雷·伤害维度 +0.25', p15.sk.mine.mult);
  dimCard('mine', 'count').apply(p15);
  assert(p15.sk.mine.count === 2, 'T16 地雷·布雷数量维度', p15.sk.mine.count);
  dimCard('mine', 'rate').apply(p15);
  assert(Math.abs(p15.sk.mine.cd - 3.0 * 0.88) < 1e-9, 'T16 地雷·部署冷却维度', p15.sk.mine.cd);
  dimCard('mine', 'range').apply(p15);
  assert(p15.sk.mine.r === 100, 'T16 地雷·范围维度 +20', p15.sk.mine.r);
  // 全局冷却卡：所有间隔 −10%
  const cdrCard16 = modeByKey('cdr');
  assert(!!cdrCard16, 'T16 全局冷却卡存在');
  cdrCard16.apply(p15);
  assert(p15.cdr === 1 && Math.abs(p15.sk.chain.cd - 3.0 * 0.9) < 1e-9
    && Math.abs(p15.sk.orbit.interval - 3.5 * 0.9) < 1e-9
    && Math.abs(p15.sk.drone.interval - 6.5 * 0.9) < 1e-9
    && Math.abs(p15.sk.mine.cd - 3.0 * 0.88 * 0.9) < 1e-9,
    'T16 全局冷却卡同时缩短所有攻击间隔', { cdr: p15.cdr, chain: p15.sk.chain.cd, orbit: p15.sk.orbit.interval, drone: p15.sk.drone.interval, mine: p15.sk.mine.cd });

  // T16b 通用辅助卡：减速箭 / 护盾生成 / 幸运
  const slowC = modeByKey('slow'), aegisC = modeByKey('aegis'), luckCard16 = modeByKey('luck');
  slowC.apply(p15);
  assert(p15.cardSlow === 1, 'T16b 减速箭卡生效', p15.cardSlow);
  aegisC.apply(p15);
  assert(p15.shieldEvery === 8 && p15.shieldVal === 10, 'T16b 护盾生成卡生效', { every: p15.shieldEvery, val: p15.shieldVal });
  const luck0 = p15.luck; luckCard16.apply(p15);
  assert(p15.luck === luck0 + 1, 'T16b 幸运卡生效', p15.luck);

  // 减速箭命中减速（吸血已删除）
  reset();
  const p16 = G.state.player;
  p16.cardSlow = 1;
  p16.hp = Math.max(1, p16.hp - 30);
  const sf16 = G.makeEnemy(1, 0);
  G.state.foes.push(sf16);
  sf16.x = p16.x + 120; sf16.y = p16.y;
  const sf16hp0 = sf16.hp, p16hp0 = p16.hp;
  G.state.bullets.push({ x: p16.x, y: p16.y, vx: 250, vy: 0, r: 5, dmg: 10, crit: false, side: 'p', life: 2, owner: p16, pierceLeft: 0, hit: [] });
  run(0.5);
  assert(sf16.hp < sf16hp0, 'T16b 箭矢命中敌人', { sf16hp0, sf16hp1: sf16.hp });
  assert(sf16.slowT > 0 && sf16.slowMul < 1, 'T16b 减速箭命中后敌人减速', { slowT: sf16.slowT, slowMul: sf16.slowMul });
  assert(G.state.player.hp === p16hp0, 'T16b 已删除吸血：命中不回血', { before: p16hp0, after: G.state.player.hp });

  // 散射：一次 volley 生成 2 支箭，箭矢寿命 = 射程/弹速（含弹速乘算）
  reset();
  const p16c = G.state.player;
  p16c.shots = 2;
  const vtarget = G.makeEnemy(1, 0);
  G.state.foes.push(vtarget);
  vtarget.x = p16c.x + 200; vtarget.y = p16c.y;
  const nb0 = G.state.bullets.length;
  G.fireVolley(p16c, vtarget);
  assert(G.state.bullets.length - nb0 === 2, 'T16 散射 volley 发射 2 支箭', G.state.bullets.length - nb0);
  const nb = G.state.bullets[G.state.bullets.length - 1];
  const bSpd = G.CFG.player.bulletSpeed * p16c.bulletSpeedMul;
  assert(Math.abs(nb.life - p16c.range / bSpd) < 0.01, 'T16 箭矢寿命与射程/弹速绑定', nb.life);

  // T16c 卡池不重复且卡牌种类合法
  reset();
  const p16d = G.state.player;
  const cards3 = G.makeLevelCards(p16d);
  const keys = cards3.map(c => c.key || c.attr);
  assert(cards3.length === 3 && new Set(keys).size === 3, 'T16c 每次升级 3 张不重复卡', keys.join(','));
  assert(cards3.every(c => ['weapon', 'passive', 'heal'].includes(c.kind)),
    'T16c 卡牌种类合法（仅武器/被动/回血兜底）', cards3.map(c => c.kind).join(','));
  assert(cards3.some(c => c.kind === 'weapon' || c.kind === 'passive'),
    'T16c VS构筑：每批升级至少含一张武器/被动卡', cards3.map(c => c.kind).join(','));

  // T17 等级里程碑解锁新地图（每 3 级一档：4/7/10 级解锁）
  reset();
  G.state.player.level = 3;
  G.gainXp(G.xpNeed(3));
  assert(G.state.player.level === 4, 'T17 升到 4 级', G.state.player.level);
  assert(G.state.mapIdx === 1, 'T17 4 级即解锁第二张地图（降档修复）', G.state.mapIdx);
  assert(G.MAPS[G.state.mapIdx].name === '荒芜骨林', 'T17 新地图主题生效', G.MAPS[G.state.mapIdx].name);

  // T18 动态障碍物：随移动生成与移除
  reset();
  const obs0 = G.state.obstacles.length;
  for (let i = 0; i < 8; i++) G.spawnObstacleNearPlayer();
  assert(G.state.obstacles.length > obs0, 'T18 岩脉随玩家移动生成', { obs0, obs1: G.state.obstacles.length });
  // 一条岩脉 3~5 块，数量上限按 cap×4（每脉最多 4 块）
  assert(G.state.obstacles.length <= G.CFG.obstacles.cap * 4 + 4, 'T18 岩脉块数有上限', G.state.obstacles.length);
  // 移走后应被清除
  G.state.player.x = 100; G.state.player.y = 1300;
  G.cullObstacles();
  const farAll = G.state.obstacles.every(o => G.dist(100, 1300, o.x, o.y) <= G.CFG.obstacles.cullDist);
  assert(farAll, 'T18 远处障碍物被移除');

  // T19 敌人随机出现在玩家附近
  reset();
  const f19 = G.makeEnemy(1, 0);
  const d19 = G.dist(f19.x, f19.y, G.state.player.x, G.state.player.y);
  assert(d19 >= 620 && d19 <= 980, 'T19 敌人刷新在视口之外的环带', Math.round(d19));

  // T-E1 分钟整点出现精英怪
  reset();
  G.state.eliteT = 59.5;
  run(1);
  const elites = G.state.foes.filter(f => f.elite);
  assert(elites.length === 1, 'T-E1 每分钟整点出现一只精英', { elites: elites.length });
  assert(elites[0].hp > G.curveHp(1) * 1.5, 'T-E1 精英血量显著高于普通怪', Math.round(elites[0].hp));
  assert(!!elites[0].affix, 'T-E1 精英必带词缀');

  // T-E2 精英死亡原地掉落装备宝箱
  const chestN0 = G.state.chests.length;
  G.dealDamage(G.state.player, elites[0], 99999);
  assert(G.state.chests.length === chestN0 + 1, 'T-E2 精英击杀原地掉落宝箱', { chestN0, chestN1: G.state.chests.length });
  const dropped = G.state.chests[G.state.chests.length - 1];
  assert(G.dist(dropped.x, dropped.y, elites[0].x, elites[0].y) < 30, 'T-E2 宝箱掉落在精英原地', { ex: Math.round(elites[0].x), cx: Math.round(dropped.x) });

  // T-E3 每 5 分钟为 BOSS（不带词缀）
  const boss = G.makeElite(5);
  assert(boss.type === 'boss' && !boss.affix, 'T-E3 第 5 分钟精英为 BOSS 且不带词缀', { type: boss.type, affix: boss.affix && boss.affix.key });
  assert(G.isBossMinute(5) && !G.isBossMinute(4), 'T-E3 isBossMinute 判定正确');

  // T-M 分钟推进与最佳纪录（临时提高玩家生命上限，避免挂机被围殴致死中断计时）
  reset();
  G.state.player.baseHp = 99999;
  G.refresh(G.state.player);
  runFull(61.5);
  assert(G.state.wave === 2, 'T-M 60 秒后进入第 2 分钟阶段', { wave: G.state.wave, time: Math.round(G.state.time) });
  assert(G.state.best === 2, 'T-M 最佳纪录按分钟记录', G.state.best);

  // T-S1 宝箱无周期刷新（只有精英掉落 + 开局引导）
  reset();
  runFull(30);
  assert(G.state.chests.length <= 1, 'T-S1 地图不再周期刷新宝箱（30 秒内无新宝箱）', G.state.chests.length);
  assert(G.CFG.events.spawnEvery >= 40, 'T-S1 事件刷新间隔已放宽', G.CFG.events.spawnEvery);
  assert(G.CFG.events.cap === 2, 'T-S1 事件地点上限降为 2', G.CFG.events.cap);

  // T7 宝箱：走近开启 → 免费升级三选一（装备已移除，宝箱给强化）
  reset();
  G.state.chests.push({ x: G.state.player.x, y: G.state.player.y, opened: false, rarBonus: 0, t: 0 });
  run(0.4);
  assert(G.state.phase === 'levelup', 'T7 走近宝箱自动开启弹出升级选项', G.state.phase);
  assert((G.state.pendingChestUps || 0) >= 1, 'T7 宝箱计入免费强化次数', G.state.pendingChestUps);
  const atkBefore7 = G.state.player.baseAtk;
  G.chooseLevelCard({ kind: 'attr', attr: 'atk', val: 5 });
  assert(G.state.phase === 'play', 'T7 选择强化后回战斗', G.state.phase);
  assert(G.state.player.baseAtk === atkBefore7 + 5 && (G.state.pendingChestUps || 0) === 0,
    'T7 宝箱强化生效并消耗', { baseAtk: G.state.player.baseAtk, chest: G.state.pendingChestUps });

  // T9 事件地点：走近触发 → 选择 → 地点消失
  reset();
  const site = { x: G.state.player.x, y: G.state.player.y, evt: G.EVENTS[0], used: false };
  G.state.sites.push(site);
  run(0.3);
  assert(G.state.phase === 'event', 'T9 走近事件地点触发弹窗', G.state.phase);
  G.chooseEventOption(G.EVENTS[0].options[2]);   // 离开
  assert(G.state.phase === 'play', 'T9 事件选择后回到战斗', G.state.phase);
  assert(site.used === true, 'T9 事件地点一次性（触发后消失）');

  // T9-event 事件层改造：随机陷阱已移除 / 加权随机 / 风险明码标价
  assert(G.CFG.events.trapChance === undefined && !G.CFG.traps && !G.TRAPS && !G.resolveTrap,
    'T9-event 35% 随机背刺陷阱系统已彻底移除');
  assert(G.CFG.events.weights && G.CFG.events.weights.shrine > G.CFG.events.weights.merchant,
    'T9-event 事件加权配置：商人更稀有', G.CFG.events.weights);
  assert(G.EVENTS.every(e => e.color && e.options.some(o => o.risk)),
    'T9-event 每种事件都有专属颜色与明码标价的风险文案');
  const rndEv = Math.random;
  try {
    Math.random = () => 0;
    const k1 = G.pickEvent().key, k2 = G.pickEvent().key;
    const keys = G.EVENTS.map(e => e.key);
    assert(keys.includes(k1) && keys.includes(k2) && k1 !== k2, 'T9-event 加权抽取且避免连续重复', { k1, k2 });
  } finally { Math.random = rndEv; }

  // T9-shrine 血契：献祭生命上限 → 武器升级 + 明码标价的敌人攻击提升
  reset();
  const pSh = G.state.player;
  const shLv = G.weaponLevel(pSh, 'arrow'), shHp = pSh.baseHp;
  G.state.sites.push({ x: pSh.x, y: pSh.y, evt: G.EVENTS[0], used: false });
  run(0.3);
  G.chooseEventOption(G.EVENTS[0].options[0]);
  assert(G.weaponLevel(pSh, 'arrow') === shLv + 1, 'T9-shrine 血契使武器直接 +1 级', G.weaponLevel(pSh, 'arrow'));
  assert(pSh.baseHp < shHp && G.state.phase === 'play', 'T9-shrine 献祭生命上限后回到战斗', { hp: pSh.baseHp, phase: G.state.phase });
  assert(G.state.eventFoeAtkMul >= 1.19 && G.state.eventFoeUntil > G.state.time, 'T9-shrine 风险：期间敌人攻击提升', G.state.eventFoeAtkMul);
  const riskFoe = G.makeEnemy(1, 0);
  G.state.eventFoeUntil = 0;
  const normalFoe = G.makeEnemy(1, 0);
  assert(riskFoe.atk > normalFoe.atk, 'T9-shrine 风险期内刷出的敌人攻击更高', { risk: riskFoe.atk, normal: normalFoe.atk });

  // T9-passive 灵魂献祭：1 级被动转移给另一被动（推动进化配方）
  reset();
  const pTr = G.state.player;
  G.upgradePassive(pTr, 'might'); G.upgradePassive(pTr, 'armor');
  const m0 = G.passiveLevel(pTr, 'might'), a0 = G.passiveLevel(pTr, 'armor');
  G.state.sites.push({ x: pTr.x, y: pTr.y, evt: G.EVENTS[0], used: false });
  run(0.3);
  G.chooseEventOption(G.EVENTS[0].options[1]);
  const m1 = G.passiveLevel(pTr, 'might'), a1 = G.passiveLevel(pTr, 'armor');
  assert(m1 + a1 === m0 + a0 && (m1 !== m0 || a1 !== a0), 'T9-passive 献祭一级被动、另一被动 +1 级', { before: [m0, a0], after: [m1, a1] });

  // T9-merchant 商人：付血 → 三选一「指定」构筑升级弹窗
  reset();
  const pMe = G.state.player;
  const meHp = pMe.hp, meArrow = G.weaponLevel(pMe, 'arrow');
  G.state.sites.push({ x: pMe.x, y: pMe.y, evt: G.EVENTS[2], used: false });
  run(0.3);
  G.chooseEventOption(G.EVENTS[2].options[0]);
  assert(G.state.phase === 'eventpick' && G.state.eventPick === true, 'T9-merchant 付费后进入指定强化弹窗', G.state.phase);
  assert(pMe.hp < meHp && G.el.cards.children.length === 3, 'T9-merchant 扣除生命并展示三张构筑卡', { hp: pMe.hp, cards: G.el.cards.children.length });
  G.chooseLevelCard({ kind: 'weapon', name: '指定升级', icon: '⚔', val: '+1', desc: '箭矢 +1', apply: pp => G.upgradeWeapon(pp, 'arrow') });
  assert(G.state.phase === 'play' && !G.state.eventPick && G.weaponLevel(pMe, 'arrow') === meArrow + 1,
    'T9-merchant 指定升级生效且不消耗升级队列', G.weaponLevel(pMe, 'arrow'));

  // T9-fork 歧路：精英换宝箱 / 搜寻物资换回血 + 武器升级
  reset();
  const pFo = G.state.player;
  G.state.sites.push({ x: pFo.x, y: pFo.y, evt: G.EVENTS[1], used: false });
  run(0.3);
  const foesBefore = G.state.foes.filter(f => !f.dead).length;
  G.chooseEventOption(G.EVENTS[1].options[0]);
  assert(G.state.foes.filter(f => !f.dead).length === foesBefore + 1 && G.state.foes.some(f => f.elite),
    'T9-fork 挑战精英：强敌入场（击杀掉宝箱）');
  reset();
  const pSe = G.state.player;
  pSe.hp = 10;
  const seArrow = G.weaponLevel(pSe, 'arrow');
  G.state.sites.push({ x: pSe.x, y: pSe.y, evt: G.EVENTS[1], used: false });
  run(0.3);
  G.chooseEventOption(G.EVENTS[1].options[1]);
  assert(pSe.hp > 10 && G.weaponLevel(pSe, 'arrow') === seArrow + 1, 'T9-fork 搜寻物资：回血 + 武器 +1 级', { hp: pSe.hp, lv: G.weaponLevel(pSe, 'arrow') });

  // T9-spring 泉水：回满血 + 明确标注的敌人增强代价
  reset();
  const pSp = G.state.player;
  pSp.hp = 1;
  G.state.sites.push({ x: pSp.x, y: pSp.y, evt: G.EVENTS[3], used: false });
  run(0.3);
  G.chooseEventOption(G.EVENTS[3].options[0]);
  assert(pSp.hp >= pSp.maxHp && G.state.eventFoeAtkMul >= 1.29, 'T9-spring 回满血并触发明示代价', { hp: pSp.hp, mul: G.state.eventFoeAtkMul });

  // T9-hazard 事件地点优先刷在地形附近（引导引怪进陷阱）
  reset();
  G.state.sites = []; G.state.obstacles = []; G.state.chests = [];
  const pHaz = G.state.player;
  const anchor = { x: pHaz.x + 300, y: pHaz.y };
  G.state.hazAnchors = [anchor]; G.state.zones = [];
  const rndSite = Math.random;
  try { Math.random = () => 0; G.spawnSite(); } finally { Math.random = rndSite; }
  const hazSite = G.state.sites[0];
  assert(hazSite && G.dist(hazSite.x, hazSite.y, anchor.x, anchor.y) < 100,
    'T9-hazard 事件地点贴近灾害锚点', hazSite && { x: hazSite.x, y: hazSite.y });

  // T9a 经验需求十级一档：档内恒定，跨档跳增且后期加速
  const n1 = G.xpNeed(1), n2 = G.xpNeed(2), n10 = G.xpNeed(10), n11 = G.xpNeed(11), n20 = G.xpNeed(20), n21 = G.xpNeed(21);
  assert(n1 === n2 && n2 === n10, 'T9a 1-10 级同挡（每级恒定）', { n1, n2, n10 });
  assert(n11 === G.xpNeed(20) && n11 > n10, 'T9a 11-20 级新挡且高于上一档', { n10, n11, n20 });
  assert(n21 > n11, 'T9a 21 级起再进下一挡', { n11, n21 });
  assert(n1 === 30, 'T9a 首挡每级 30 经验（前期更快）', n1);
  // 后期加速：相邻档增量本身随档数扩大（第 10 档 ≈ 第 2 档的 5 倍）
  const d2 = n21 - n11, d10 = G.xpNeed(91) - G.xpNeed(81);
  assert(d10 > d2 * 4, 'T9a 后期档位跳增明显放大（抑制后期升级过快）', { earlyJump: d2, lateJump: d10 });

  // T9b 真实卡池选卡（含无 apply 的属性卡）不能卡死流程
  reset();
  G.state.pendingLevelUps = 2;
  G.showLevelUp();
  for (let round = 0; round < 2; round++) {
    const cards = G.makeLevelCards(G.state.player);
    assert(cards.length === 3, 'T9b 卡池抽出 3 张', cards.length);
    const before = G.state.player.baseAtk + G.state.player.baseHp + G.state.player.baseDef;
    G.chooseLevelCard(cards[0]);                          // 无论哪张（含属性卡）都必须安全
    assert(G.state.phase !== 'busy', 'T9b 选卡后不卡在 busy', G.state.phase);
    const after = G.state.player.baseAtk + G.state.player.baseHp + G.state.player.baseDef;
    if (cards[0].kind === 'attr') {
      assert(after > before, 'T9b 属性卡实际提升基础三维', { before, after });
    }
  }
  assert(G.state.pendingLevelUps === 0, 'T9b 连升全部处理完', G.state.pendingLevelUps);

  // T10 词缀确定性 + 精英/BOSS 强度
  const e3 = G.makeEnemy(3, 0);
  assert(e3.affix && e3.affix.key === G.AFFIXES[0].key, 'T10 第 3 分钟首个敌人带「重甲」词缀', e3.affix && e3.affix.key);
  const e1 = G.makeEnemy(1, 0);
  const e1hp = e1.hp;
  const e4 = G.makeEnemy(4, 0);
  assert(e4.hp > e1hp, 'T10 敌人强度随分钟增长', { m1: e1hp, m4: e4.hp });
  const elite1 = G.makeElite(1);
  // 精英 1 分钟必带词缀（迅捷 −25% 血），抵消后仍应明显高于同类型普通怪
  assert(elite1.elite === true && elite1.hp > e1hp * 1.4, 'T10 精英强度显著高于普通怪', { elite: elite1.hp, normal: e1hp });
  assert(elite1.xp >= 25, 'T10 精英提供大量经验', elite1.xp);

  // T25 精英/BOSS 经验差距：BOSS 经验应显著高于精英（≥2.5 倍）
  const eliteXp = elite1.xp;
  const bossXpU = G.makeElite(5);
  assert(bossXpU.xp > eliteXp * 2.5, 'T25 BOSS 经验显著高于精英（≥2.5 倍）', { boss: bossXpU.xp, elite: eliteXp });
  const elite5 = G.makeElite(4);
  assert(elite5.xp < bossXpU.xp * 0.6, 'T25 同期 BOSS 经验远高于精英', { elite5: elite5.xp, boss: bossXpU.xp });

  // T26 v9.13 新特性
  // T26a 反弹箭：弹幕碰墙反弹
  reset();
  const pRic = G.state.player;
  pRic.bounce = 1;
  G.state.foes = [];
  pRic.atkCd = 999;                         // 禁用期间玩家持续开火，避免干扰反弹弹幕观测
  pRic.x = G.CFG.world.w - 300; pRic.y = G.CFG.world.h / 2;   // 靠近极远的世界边缘测试墙壁反弹
  G.state.bullets = [];
  G.state.bullets.push({ x: G.CFG.world.w - 40, y: pRic.y, vx: 600, vy: 0, r: 4, dmg: 1, side: 'p', life: 2, hit: [] });
  run(0.25);
  const bounced = G.state.bullets.filter(b => b.side === 'p' && b.vx < 0);
  assert(bounced.length > 0, 'T26a 弹幕碰右墙后反弹（vx 反向）', G.state.bullets.length);
  // 超出反弹次数后消散
  pRic.bounce = 1;
  G.state.bullets.push({ x: pRic.x + 40, y: pRic.y, vx: 600, vy: 0, r: 4, dmg: 1, side: 'p', life: 5, hit: [], bounces: 1 });
  run(1.0);
  assert(!G.state.bullets.some(b => b.bounces >= 2), 'T26b 反弹次数用尽后弹幕消散');

  // T26f 法师不占刷怪名额
  reset();
  const mage = G.makeEnemy(1, 8);   // idx%10 === 8 → 法师
  mage.type = 'mage';
  G.state.foes = [mage];
  assert(G.state.foes.length === 1, 'T26f 场上有 1 只法师');
  G.state.spawnT = G.spawnInterval(1) - 0.1;   // 只差 0.1s 即到刷怪点
  run(0.5);
  assert(G.state.foes.length > 1, 'T26f 法师在场时其他敌人仍正常刷新', G.state.foes.length);

  // T26g 体型随玩家攻击与敌人血量成长（击杀箭数越多体型越大）
  reset();
  const pSz = G.state.player;
  const foeLow = G.makeEnemy(1, 0);
  pSz.baseAtk = 200; G.refresh(pSz);      // 高攻击 → 箭数少 → 体型小
  const foeSmall = G.makeEnemy(1, 0);
  pSz.baseAtk = 5; G.refresh(pSz);        // 低攻击 → 箭数多 → 体型大
  const foeBig = G.makeEnemy(1, 0);
  assert(foeBig.r > foeSmall.r, 'T26g 同血量下玩家攻击越低敌人显形越大（箭数多）', { big: foeBig.r, small: foeSmall.r });

  // T26h 反弹箭碰障碍物反弹
  reset();
  const pObs = G.state.player;
  pObs.bounce = 1;
  G.state.foes = [];
  G.state.obstacles = [{ x: pObs.x + 100, y: pObs.y - 200, w: 60, h: 200 }];   // 竖直障碍在右侧
  G.state.bullets.push({ x: pObs.x + 60, y: pObs.y, vx: 500, vy: 0, r: 4, dmg: 1, side: 'p', life: 2, hit: [] });
  run(0.5);
  const bouncedObs = G.state.bullets.filter(b => b.side === 'p' && b.vx < 0);
  assert(bouncedObs.length > 0, 'T26h 弹幕碰障碍物后反弹（vx 反向）', G.state.bullets.map(b => b.vx).join(','));

  // T26i 法师数量上限：超上限后不再生成法师
  reset();
  const mageA = G.makeEnemy(1, 8); mageA.type = 'mage';
  const mageB = G.makeEnemy(1, 9); mageB.type = 'mage';
  G.state.foes = [mageA, mageB];      // 场上已有 2 只法师 = mageCap
  G.state.spawnT = G.spawnInterval(1) - 0.1;
  run(0.5);
  const mageCount = G.state.foes.filter(f => !f.dead && f.type === 'mage').length;
  assert(mageCount <= G.CFG.spawn.mageCap, 'T26i 法师不超过 mageCap', mageCount);
  assert(G.state.foes.length > 2, 'T26i 法师满员时改刷其他类型敌人', G.state.foes.length);

  // T11 BOSS 扇形弹幕
  reset();
  const boss2 = G.makeElite(5);
  G.state.foes.push(boss2);
  boss2.x = G.state.player.x; boss2.y = G.state.player.y - 200;
  boss2.atkCd = 0;
  run(0.5);
  assert(G.state.bullets.filter(b => b.side === 'e').length >= 3, 'T11 BOSS 发射 3 向扇形弹幕', G.state.bullets.length);

  // T12 尖刺反伤
  reset();
  G.state.player.shield = 0;
  G.state.player.iframes = 0;
  const sf = G.makeEnemy(1, 0);
  G.state.foes.push(sf);
  sf.affix = G.AFFIXES[4];
  const php0 = G.state.player.hp;
  G.dealDamage(G.state.player, sf, 10);
  assert(G.state.player.hp < php0, 'T12 尖刺词缀反伤生效', { php0, php1: G.state.player.hp });

  // T13 血刃流血 DoT
  reset();
  const bf = G.makeEnemy(1, 0);
  G.state.foes.push(bf);
  G.applyBleed(bf, { dmg: 5, turns: 3 });
  const bhp0 = bf.hp;
  run(3.5);
  assert(bf.hp < bhp0 || bf.dead, 'T13 流血每秒跳伤害', { bhp0, bhp1: bf.hp });

  // T14 贯穿箭穿透敌人
  reset();
  const p14 = G.state.player;
  p14.pierce = 1;
  const fa = G.makeEnemy(1, 0);
  G.state.foes.push(fa);
  fa.x = p14.x + 100; fa.y = p14.y;
  const fahp0 = fa.hp;
  G.state.bullets.push({ x: p14.x, y: p14.y, vx: 250, vy: 0, r: 5, dmg: 5, crit: false, side: 'p', life: 2, owner: p14, pierceLeft: 1, hit: [] });
  run(1);
  assert(fa.hp < fahp0, 'T14 贯穿箭命中敌人', { fahp0, fh1: fa.hp });

  // T21 数量型强化伤害衰减
  // T21a 散射箭：2 支箭各 70% 攻击
  reset();
  const p21 = G.state.player;
  p21.atk = 10; p21.atkT = 0;
  p21.shots = 2; p21.shotDmgMul = 0.7;
  const m21 = G.makeEnemy(1, 0);
  m21.type = 'melee'; m21.speed = 0;
  m21.x = p21.x + 80; m21.y = p21.y;   // 正对扇形中央
  m21.hp = 100; m21.maxHp = 100;
  G.state.foes = [m21];
  const m21hp0 = m21.hp;
  run(0.9);   // 首轮射击在 0.4s，箭矢 0.32s 后命中；下一轮在 1.2s 不会触发
  const m21dmg = m21hp0 - m21.hp;
  assert(m21dmg > 0, 'T21a 散射箭命中敌人', { m21dmg });
  // 70% 系数下两支箭总伤 ≈ 14（±暴击容差只允许更低），原全额应是 20
  assert(m21dmg <= 14, 'T21a 单箭伤害为 70% 攻击（两箭 ≤14）', { m21dmg });

  // T21b 贯穿衰减：第二个被穿透的敌人受伤 < 首个
  reset();
  const p21b = G.state.player;
  p21b.pierce = 1;
  const fall21a = G.makeEnemy(1, 0); fall21a.type = 'melee'; fall21a.speed = 0;
  const fall21b = G.makeEnemy(1, 0); fall21b.type = 'melee'; fall21b.speed = 0;
  fall21a.x = p21b.x + 60; fall21a.y = p21b.y; fall21a.hp = 100; fall21a.maxHp = 100;
  fall21b.x = p21b.x + 160; fall21b.y = p21b.y; fall21b.hp = 100; fall21b.maxHp = 100;
  G.state.foes = [fall21a, fall21b];
  G.state.bullets.push({ x: p21b.x, y: p21b.y, vx: 250, vy: 0, r: 5, dmg: 10, crit: false, side: 'p', life: 2, owner: p21b, pierceLeft: 1, hit: [] });
  run(1);
  const fd1 = 100 - fall21a.hp, fd2 = 100 - fall21b.hp;
  assert(fd1 > 0 && fd2 > 0, 'T21b 贯穿命中两个敌人', { fd1, fd2 });
  assert(fd2 < fd1, 'T21b 穿透伤害衰减（第二目标 < 首目标）', { fd1, fd2 });
  assert(Math.abs(fd2 - Math.round(fd1 * 0.7)) <= 1, 'T21b 衰减系数为 0.7', { fd1, fd2 });

  // T21c 环绕飞刃：解锁 2 枚 → 数量维度升到 4 枚（周期出现，平时收起）
  reset();
  const p21c = G.state.player;
  const unlockOrbit21c = G.SKILL_CARDS.find(c => c.line === 'orbit' && c.sub === 'unlock');
  unlockOrbit21c.apply(p21c);
  assert(p21c.skills.orbit === 1 && p21c.sk.orbit.count === 3, 'T21c 飞刃解锁为 3 枚', p21c.sk.orbit.count);
  const mul1 = p21c.orbitDmgMul;
  const orbitDim21c = G.SKILL_CARDS.find(c => c.line === 'orbit' && c.dim === 'count');
  orbitDim21c.apply(p21c);
  assert(p21c.sk.orbit.count === 5, 'T21c 飞刃数量维度 +2 枚', p21c.sk.orbit.count);
  assert(p21c.orbitDmgMul >= mul1, 'T21c 飞刃伤害倍率不降低', { mul1, mul2: p21c.orbitDmgMul });
  assert(p21c.orbits === 0, 'T21c 飞刃平时收起（周期出现）', p21c.orbits);

  // T21d 幸运值系统
  // T21d1 幸运卡在 5 级池中且可叠加、有上限
  reset();
  const p21d = G.state.player;
  p21d.level = 5;
  const luckCard = G.MODE_POOL.find(c => c.key === 'luck');
  assert(!!luckCard, 'T21d 幸运卡存在于攻击方式池');
  luckCard.apply(p21d);
  luckCard.apply(p21d);
  assert(p21d.luck === 2, 'T21d 幸运卡每次 +1', p21d.luck);
  assert(luckCard.max(p21d) === false, 'T21d 幸运未达上限时仍可出现');
  p21d.luck = 8;
  assert(luckCard.max(p21d) === true, 'T21d 幸运 8 时达到上限');
  // T21d2 高幸运显著抬升平均稀有度
  let baseSum = 0, luckSum = 0;
  for (let i = 0; i < 800; i++) { baseSum += G.rollRarity(1, 0); luckSum += G.rollRarity(1, 8); }
  const baseAvg = baseSum / 800, luckAvg = luckSum / 800;
  assert(luckAvg > baseAvg + 0.15, 'T21d 幸运 8 的平均稀有度显著高于幸运 0', { baseAvg: baseAvg.toFixed(2), luckAvg: luckAvg.toFixed(2) });

  // T22 敌人体系重做 + 鼠标瞄准
  // T22a 角色分工：近战高攻高防 / 远程低攻低防 / 法师不动
  reset();
  const meleeF = G.makeEnemy(1, 0);   // melee
  const rangedF = G.makeEnemy(1, 6);  // ranged
  const mageF = G.makeEnemy(1, 9);    // mage
  assert(meleeF.type === 'melee' && rangedF.type === 'ranged' && mageF.type === 'mage',
    'T22a 类型分布正确', { m: meleeF.type, r: rangedF.type, g: mageF.type });
  assert(meleeF.atk > rangedF.atk, 'T22a 近战攻击高于远程', { melee: meleeF.atk, ranged: rangedF.atk });
  const meleeF6 = G.makeEnemy(6, 0), rangedF6 = G.makeEnemy(6, 6);
  assert(meleeF6.def > rangedF6.def, 'T22a 近战防御高于远程', { melee: meleeF6.def, ranged: rangedF6.def });
  assert(mageF.speed === 0, 'T22a 法师完全不能移动', mageF.speed);
  assert(G.CFG.ranged.speed > G.CFG.melee.speed, 'T22a 远程移速快于近战');

  // T22b 法师 AoE：预警后爆发，只对玩家生效（不伤敌人）
  reset();
  const mg = G.makeEnemy(1, 9);
  G.state.foes = [mg];
  mg.atkCd = 0;
  const pT22 = G.state.player;
  pT22.iframes = 0; pT22.shield = 0;
  const mgPhp0 = pT22.hp;
  const aoeFoe = G.makeEnemy(1, 0);
  aoeFoe.x = pT22.x + 20; aoeFoe.y = pT22.y;
  const aoeFoeHp0 = aoeFoe.hp;
  G.state.foes.push(aoeFoe);
  run(0.1);   // 法师咏唱 → mageAoes 出现
  assert(G.state.mageAoes.length > 0, 'T22b 法师咏唱出 AoE 预警');
  assert(G.CFG.mage.aoeR <= 60, 'T22b 法师 AoE 半径收紧（≤60）', G.CFG.mage.aoeR);
  const aoe = G.state.mageAoes[0];
  aoe.x = pT22.x; aoe.y = pT22.y;
  aoe.t = aoe.warn - 0.05;    // 即将爆发
  run(0.15);
  assert(pT22.hp < mgPhp0, 'T22b AoE 爆发对圈内玩家造成伤害', { mgPhp0, mgPhp1: pT22.hp });
  assert(aoeFoe.hp === aoeFoeHp0, 'T22b AoE 不再伤害敌人', { aoeFoeHp0, aoeFoeHp1: aoeFoe.hp });

  // T22c 宝箱怪：预警 → 直线跳扑 → 突进中接触伤害
  reset();
  const mm = G.makeEnemy(1, 0);
  mm.type = 'mimic';
  mm.x = G.state.player.x + 200; mm.y = G.state.player.y;
  mm.lungeT = 0; mm.tele = null; mm.dash = null;
  G.state.foes = [mm];
  const pT22c = G.state.player;
  pT22c.iframes = 0; pT22c.shield = 0;
  const mhp0 = pT22c.hp;
  run(1.0);   // 距离 200 < 330 → 预警 0.75s → 跳扑（朝锁定方向）
  const hitByDash = pT22c.hp < mhp0;
  const movedCloser = G.dist(mm.x, mm.y, pT22c.x, pT22c.y) < 200;
  assert(hitByDash || movedCloser, 'T22c 宝箱怪完成跳扑（命中或位移）', { hitByDash, moved: movedCloser });
  // 预警阶段有 tele（在 run 过程中出现过——直接构造验证）
  reset();
  const mm2 = G.makeEnemy(1, 0);
  mm2.type = 'mimic';
  mm2.x = G.state.player.x + 200; mm2.y = G.state.player.y;
  mm2.lungeT = 0; mm2.tele = null; mm2.dash = null;
  G.state.foes = [mm2];
  run(0.5);   // 冷却 0 → 触发预警（0.75s 未结束，仍处于 tele）
  assert(!!mm2.tele, 'T22c 宝箱怪进入预警阶段（方向已锁定）');

  // T22d 鼠标方向射击：无鼠标时兜底最近敌人，有鼠标时朝鼠标方向
  reset();
  const pAim = G.state.player;
  G.engine.mouse.active = false;
  const aimFoe = G.makeEnemy(1, 0);
  aimFoe.speed = 0;
  aimFoe.x = pAim.x + 150; aimFoe.y = pAim.y;   // 正右方
  G.state.foes = [aimFoe];
  pAim.atkT = 0;
  pAim.shots = 1; pAim.shotDmgMul = 1;
  run(0.7);
  const aimed = aimFoe.hp < aimFoe.maxHp;
  assert(aimed, 'T22d 无鼠标时兜底瞄准最近敌人');
  // 有鼠标：放在玩家左侧 → 箭矢 vx < 0
  reset();
  const pAim2 = G.state.player;
  const vx0 = G.state.bullets.length;
  G.engine.mouse.active = true;
  G.engine.mouse.cx = pAim2.x - 100;   // 相机为 0（玩家在中心附近）
  G.engine.mouse.cy = pAim2.y;
  const aimFoe2 = G.makeEnemy(1, 0);
  aimFoe2.speed = 0;
  aimFoe2.x = pAim2.x + 150; aimFoe2.y = pAim2.y;
  G.state.foes = [aimFoe2];
  pAim2.atkT = 0;
  run(0.2);
  const fired = G.state.bullets.filter(b => b.side === 'p');
  assert(fired.some(b => b.vx < 0), 'T22d 有鼠标时箭矢朝鼠标方向（左侧）发射');

  // T23 升级效率卡：随机混入混合卡池，经验获取可叠加放大
  reset();
  const pXp = G.state.player;
  pXp.level = 2;
  let xpSeen = false, kindsOK = true;
  for (let i = 0; i < 60; i++) {
    const cards = G.makeLevelCards(pXp);
    if (cards.length !== 3) kindsOK = false;
    if (cards.some(c => c.key === 'xpgain')) xpSeen = true;
  }
  assert(!xpSeen, 'T23a 升级效率卡已移出升级卡池', xpSeen);
  assert(kindsOK, 'T23a 每次升级都出 3 张', kindsOK);
  const xpCard = G.XP_CARD;
  xpCard.apply(pXp);
  xpCard.apply(pXp);
  assert(Math.abs(pXp.xpMul - 1.4) < 1e-9, 'T23b 升级效率可叠加（+20% ×2）', pXp.xpMul);
  G.gainXp(10);
  assert(pXp.xp === 14, 'T23c 击杀经验按倍率放大', pXp.xp);

  // T15 地图陷阱系统
  // T15a 初始地图无陷阱
  reset();
  assert(G.state.zones.length === 0 && G.state.hazards.length === 0 && G.hazardKind() === null,
    'T15a 初始地图（深渊洞窟）无陷阱', { zones: G.state.zones.length, kind: G.hazardKind() });
  // T15a2 岩脉掩体数量（4 条初始，最多 cap=8 条，每脉 3~5 块）
  assert(G.state.obstacles.length <= 4 * 5 && G.CFG.obstacles.cap === 8,
    'T15a2 初始岩脉数量受控', { blocks: G.state.obstacles.length, veins: new Set(G.state.obstacles.map(o => o.veinId)).size });

  // T15b 熔岩裂隙：火球预警 → 爆发伤害
  reset();
  G.switchMap(2);
  G.ensureTerrainAroundPlayer();      // 无边界地图：陷阱按地块按需生成
  assert(G.hazardKind() === 'fire', 'T15b 熔岩裂隙陷阱种类为 fire');
  assert(G.state.hazAnchors.length > 0, 'T15b 玩家附近已生成火球固定锚点', G.state.hazAnchors.length);
  const f15 = G.makeEnemy(1, 0);
  G.state.foes.push(f15);
  const hp15 = f15.hp;
  G.spawnBurst('fire', 1);
  const hz = G.state.hazards[0];
  hz.x = f15.x; hz.y = f15.y; hz.t = hz.warn - 0.05;   // 即将爆发
  run(0.3);
  assert(hz.hit && (f15.hp < hp15 || f15.dead), 'T15b 火球爆发命中范围内敌人', { hp15, hp2: f15.hp, hit: hz.hit });

  // T15c 腐雾沼泽：减速泥潭同时影响玩家与敌人
  reset();
  G.switchMap(4);
  G.ensureTerrainAroundPlayer();
  assert(G.hazardKind() === 'swamp', 'T15c 腐雾沼泽陷阱种类为 swamp');
  assert(G.state.zones.length > 0, 'T15c 泥潭区域已布置', G.state.zones.length);
  const psw = G.state.player;
  G.state.zones = [{ kind: 'swamp', x: psw.x, y: psw.y, r: 92 }];   // 单一泥潭，排除随机相邻区域干扰
  assert(G.zoneSlowMul(psw.x, psw.y) === G.CFG.hazards.swamp.slowMul, 'T15c 泥潭中的单位被减速');
  assert(G.zoneSlowMul(psw.x + 500, psw.y) === 1, 'T15c 泥潭外不受影响');

  // T15d 虚空回廊：引力裂隙拉拽单位
  reset();
  G.switchMap(3);
  assert(G.hazardKind() === 'vortex', 'T15d 虚空回廊陷阱种类为 vortex');
  G.state.zones = [{ kind: 'vortex', x: G.state.player.x, y: G.state.player.y, r: 200 }];
  const vf = G.makeEnemy(1, 0);
  vf.type = 'melee';
  vf.speed = 0;          // 静止敌人：排除追击 AI 干扰，只验证引力
  vf.x = G.state.player.x + 80; vf.y = G.state.player.y;
  G.state.foes = [vf];
  const dv0 = G.dist(vf.x, vf.y, G.state.player.x, G.state.player.y);
  run(0.5);
  const dv1 = G.dist(vf.x, vf.y, G.state.player.x, G.state.player.y);
  assert(dv1 < dv0 - 20, 'T15d 裂隙把敌人拉向中心', { d0: dv0.toFixed(1), d1: dv1.toFixed(1) });
  // 玩家同样被拉拽
  const pvx = G.state.player;
  G.state.foes = [];
  pvx.x = G.state.player.x + 80; pvx.y = G.state.player.y;
  const dp0 = G.dist(pvx.x, pvx.y, G.state.zones[0].x, G.state.zones[0].y);
  run(0.5);
  const dp1 = G.dist(pvx.x, pvx.y, G.state.zones[0].x, G.state.zones[0].y);
  assert(dp1 < dp0 - 20, 'T15d 裂隙把玩家拉向中心', { d0: dp0.toFixed(1), d1: dp1.toFixed(1) });

  // T15e 荒芜骨林：骨刺周期生成
  reset();
  G.switchMap(1);
  assert(G.hazardKind() === 'spikes', 'T15e 荒芜骨林陷阱种类为 spikes');
  G.state.hazT = G.CFG.hazards.spikes.every - 0.01;
  run(0.2);
  assert(G.state.hazards.length > 0, 'T15e 骨刺预警圈按周期出现', G.state.hazards.length);

  // T16 升级卡池混合化：属性/攻击方式/幸运/升级效率每级一同随机出现
  const M16 = G.ATTR_META;
  assert(M16.hp.vals[4] === 62 && M16.atk.vals[4] === 14 && M16.def.vals[4] === 6,
    'T16a 属性卡数值再次削弱（单张不再过强）', { hp: M16.hp.vals[4], atk: M16.atk.vals[4], def: M16.def.vals[4] });
  reset();
  {
    const pm = G.state.player;
    let sawMode = false, sawAttr = false;
    for (let i = 0; i < 60; i++) {
      const cards = G.makeLevelCards(pm);
      if (cards.some(c => c.kind === 'weapon' || c.kind === 'passive')) sawMode = true;
      if (cards.some(c => c.kind === 'attr' || c.kind === 'mode' || c.kind === 'ultimate')) sawAttr = true;
    }
    assert(sawMode && !sawAttr, 'T16a 卡池仅武器/被动，属性与通用卡已移除', { sawMode, sawAttr });
  }
  reset();
  {
    const pm = G.state.player;
    pm.xpMul = G.CFG.levelup.xpMulCap;   // 升级效率达上限 → 不再入池
    let xpShown = false;
    for (let i = 0; i < 60; i++) {
      if (G.makeLevelCards(pm).some(c => c.key === 'xpgain')) xpShown = true;
    }
    assert(!xpShown, 'T16a 升级效率满级后不再出现', xpShown);
  }

  // T17 障碍伪装陷阱
  reset();
  const p17 = G.state.player;
  p17.iframes = 0;
  G.state.obstacles = [{ x: p17.x - 20, y: p17.y - 20, w: 40, h: 40, trap: { armed: true, trigT: 0 } }];
  const hp17 = p17.hp;
  run(0.2);
  const t17 = G.state.obstacles[0].trap;
  assert(!t17.armed && t17.trigT > 0, 'T17 陷阱靠近后触发并现形', t17);
  assert(p17.hp < hp17, 'T17 陷阱对玩家造成固定伤害', { hp17, hp2: p17.hp });
  run(1);
  assert(G.state.obstacles[0].trap.trigT <= 0, 'T17 尖刺现形动画按时结束');

  // T18 宝箱怪
  reset();
  G.state.chests = [];
  G.state.chests.push({ x: G.state.player.x + 10, y: G.state.player.y, opened: false, rarBonus: 1, t: 0, mimic: true });
  run(0.3);
  const mim = G.state.foes.find(f => !f.dead && f.name === '宝箱怪');
  assert(mim && G.state.phase === 'play', 'T18a 开箱瞬间宝箱怪现形（不弹战利品）', { has: !!mim, ph: G.state.phase });
  if (mim) {
    const chestsBefore = G.state.chests.length;
    G.dealDamage(G.state.player, mim, 99999);
    const mc = G.state.chests[G.state.chests.length - 1];
    assert(G.state.chests.length > chestsBefore && mc.mimic === false,
      'T18b 击杀宝箱怪掉落真宝箱', G.state.chests.length);
  }
  // 普通宝箱不受影响
  reset();
  G.state.chests = [];
  G.state.chests.push({ x: G.state.player.x + 10, y: G.state.player.y, opened: false, rarBonus: 0, t: 0, mimic: false });
  run(0.3);
  assert(G.state.phase === 'levelup', 'T18c 普通宝箱仍正常弹出强化选项');

  // T19 双侧边栏：右侧只放攻击方式（维度等级），左侧放属性（三维置顶）+ 输出统计
  reset();
  G.ui.syncTopbar();
  const side = sandbox.document._els.eqSide;
  const dmgSideT19 = sandbox.document._els.dmgSide;
  assert(side && side.innerHTML.indexOf('武器构筑') >= 0 && side.innerHTML.indexOf('武器') >= 0
    && side.innerHTML.indexOf('被动道具') >= 0,
    'T19a 右侧栏渲染VS构筑（武器槽+被动槽）', side && side.innerHTML.slice(0, 200));
  assert(!!dmgSideT19 && dmgSideT19.innerHTML.indexOf('属性') >= 0 && dmgSideT19.innerHTML.indexOf('输出统计') >= 0,
    'T19a 左侧栏渲染属性与输出统计');
  assert(side.innerHTML.indexOf('生命') < 0 && dmgSideT19.innerHTML.indexOf('生命') >= 0,
    'T19a 三维等非攻击属性已移到左侧');
  assert(side.innerHTML.indexOf('空置') < 0 && side.innerHTML.indexOf('eq-slot') < 0
    && dmgSideT19.innerHTML.indexOf('空置') < 0, 'T19b 装备槽位已从两侧边栏移除');

  // T20 伤害不超过目标当前血量（溢出不结算）
  reset();
  const f20 = G.makeEnemy(1, 0);
  G.state.foes.push(f20);
  f20.hp = 7;
  const dealt = G.dealDamage(G.state.player, f20, 100, { flat: true, noThorn: true });
  assert(dealt === 7 && f20.dead, 'T20a 敌人 7 血吃 100 攻只掉 7', dealt);
  const f20b = G.makeEnemy(1, 0);
  G.state.foes.push(f20b);
  const dealt2 = G.dealDamage(G.state.player, f20b, 3, { flat: true, noThorn: true });
  assert(dealt2 === 3, 'T20b 未溢出时伤害正常', dealt2);

  /* ================= T24：体型随血量 + BOSS 技能轮换 + 固定陷阱 ================= */

  // T24a 体型与血量正相关
  const sLow = G.makeEnemy(1, 0);     // 第 1 分钟：低血量
  const sHigh = G.makeEnemy(9, 1);    // 第 9 分钟：高血量
  assert(G.sizeScale(sLow.hp) < G.sizeScale(sHigh.hp), 'T24a 血量越高体型系数越大',
    { low: G.sizeScale(sLow.hp).toFixed(2), high: G.sizeScale(sHigh.hp).toFixed(2) });
  assert(sLow.r <= sHigh.r, 'T24a 高血量敌人半径更大', { rLow: sLow.r, rHigh: sHigh.r });
  const bossSz = G.makeElite(5);      // BOSS 血量最高 → 体型最大
  assert(bossSz.r > G.CFG.boss.r * 1.5, 'T24a BOSS 半径显著大于基础值', { bossR: bossSz.r });

  // T24b BOSS 技能轮换：扇形 → 环射 → 冲撞预警 → 召唤
  reset();
  const bk = G.makeElite(5);
  G.state.foes = [bk];
  const pBk = G.state.player;
  bk.x = pBk.x + 300; bk.y = pBk.y;
  bk.atkCd = 0;
  const fanned = [];
  for (let k = 0; k < 4; k++) {
    const b0 = G.state.bullets.length;
    const f0 = G.state.foes.length;
    bk.bossDash = null;
    bk.atkCd = 0;
    bk.skillIdx = (k + 3) % 4;   // 使下一技能轮到第 k 个（fan/ring/dash/summon）
    run(0.2);
    fanned.push({
      bullets: G.state.bullets.length - b0,
      foes: G.state.foes.length - f0,
      dashing: !!bk.bossDash
    });
  }
  assert(fanned[0].bullets > 0, 'T24b BOSS 第 1 技能：扇形弹幕', fanned[0]);
  assert(fanned[1].bullets >= G.CFG.boss.ringCount - 4, 'T24b BOSS 第 2 技能：全向环射', fanned[1]);
  assert(fanned[2].dashing, 'T24b BOSS 第 3 技能：进入冲撞预警', fanned[2]);
  assert(fanned[3].foes >= G.CFG.boss.summonCount, 'T24b BOSS 第 4 技能：召唤援军', fanned[3]);

  // T24c 固定陷阱：地块哈希确定性（同一世界坐标每次生成位置一致）
  reset();
  G.state.mapIdx = 4;                    // 沼泽（zones）
  G.setupHazards(); G.ensureTerrainAroundPlayer();
  const swampZones1 = JSON.stringify(G.state.zones.map(z => [Math.round(z.x), Math.round(z.y), Math.round(z.r)]));
  G.setupHazards(); G.ensureTerrainAroundPlayer();
  const swampZones2 = JSON.stringify(G.state.zones.map(z => [Math.round(z.x), Math.round(z.y), Math.round(z.r)]));
  assert(swampZones1 === swampZones2 && G.state.zones.length > 0, 'T24c 泥潭位置按地块确定性生成', G.state.zones.length);
  G.state.mapIdx = 2;                    // 熔岩（锚点）
  G.setupHazards(); G.ensureTerrainAroundPlayer();
  const anchors1 = JSON.stringify(G.state.hazAnchors.map(a => [Math.round(a.x), Math.round(a.y)]));
  G.setupHazards(); G.ensureTerrainAroundPlayer();
  const anchors2 = JSON.stringify(G.state.hazAnchors.map(a => [Math.round(a.x), Math.round(a.y)]));
  assert(anchors1 === anchors2 && G.state.hazAnchors.length > 0, 'T24c 火球落点锚点按地块确定性生成', G.state.hazAnchors.length);
  // 无边界地形换入换出：玩家远行后生成全新地块的锚点
  const px24c = G.state.player.x;
  G.state.player.x += 5000;
  G.ensureTerrainAroundPlayer();
  const anchorsFar = JSON.stringify(G.state.hazAnchors.map(a => [Math.round(a.x), Math.round(a.y)]));
  assert(anchorsFar !== anchors2 && G.state.hazAnchors.length > 0, 'T24c 玩家远行后地形按地块换入换出', G.state.hazAnchors.length);
  // 爆发按玩家附近锚点顺序轮换
  const nearAnchors = G.state.hazAnchors.filter(a => G.dist(a.x, a.y, G.state.player.x, G.state.player.y) < G.CFG.terrain.activeRadius);
  G.state.hazards = [];
  G.spawnBurst('fire', 1); G.spawnBurst('fire', 1);
  const firstBurst = [G.state.hazards[0], G.state.hazards[1]];
  assert(firstBurst[0].x === nearAnchors[0].x && firstBurst[1].x === nearAnchors[1].x,
    'T24c 爆发落点按附近锚点顺序轮换', { got: firstBurst.map(h => h.x), want: nearAnchors.slice(0, 2).map(a => a.x) });
  G.state.player.x = px24c;

  // T24d 敌人不与玩家重叠
  reset();
  const ovF = G.makeEnemy(1, 0);
  ovF.type = 'melee'; ovF.speed = 0;
  const pOv = G.state.player;
  ovF.x = pOv.x; ovF.y = pOv.y + 5;    // 与玩家几乎重合
  G.state.foes = [ovF];
  run(0.1);
  const ovD = G.dist(ovF.x, ovF.y, pOv.x, pOv.y);
  assert(ovD >= ovF.r + pOv.r - 0.5, 'T24d 重叠敌人被推出玩家圆', { dist: ovD.toFixed(1), min: (ovF.r + pOv.r).toFixed(1) });

  /* ================= T27：怪物属性重设计 ================= */
  // T27a 平滑曲线（对标 VS）：每分钟连续递增，取消两分钟档内恒定的断崖
  assert(G.curveHp(1) < G.curveHp(2) && G.curveHp(2) < G.curveHp(3), 'T27a 生命平滑逐分钟递增', [G.curveHp(1), G.curveHp(2), G.curveHp(3)]);
  assert(G.curveAtk(1) < G.curveAtk(2) && G.curveAtk(2) < G.curveAtk(3), 'T27a 攻击平滑逐分钟递增', [G.curveAtk(1), G.curveAtk(2), G.curveAtk(3)]);
  assert(G.curveDef(1) < G.curveDef(2) && G.curveDef(2) < G.curveDef(3), 'T27a 减伤率平滑逐分钟递增', [G.curveDef(1), G.curveDef(2), G.curveDef(3)]);
  // T27a2 生命/防御整体 +20%（相对旧基准 28 / 5+4×tier），攻击不变
  assert(Math.abs(G.curveHp(1) / 28 - 1.2) < 0.05 && Math.abs(G.curveHp(11) / (28 * Math.pow(1.55, 5)) - 1.2) < 0.05,
    'T27a2 怪物生命整体 +20%（每档精确）', { hp1: G.curveHp(1), hp11: G.curveHp(11) });
  assert(Math.abs(G.curveDef(1) - 6) < 1e-9 && Math.abs(G.curveDef(3) - 10.8) < 1e-9,
    'T27a2 怪物减伤率整体 +20%', { d1: G.curveDef(1), d3: G.curveDef(3) });
  assert(G.curveAtk(1) === Math.round(9.2), 'T27a2 怪物攻击未变', G.curveAtk(1));

  // T27b 敌人防御是减伤率（百分比），不是减法护甲
  reset();
  const t27Melee = G.makeEnemy(1, 0);
  assert(t27Melee.type === 'melee' && t27Melee.def > 0 && t27Melee.def <= 60, 'T27b 近战减伤率为百分比数值', t27Melee.def);
  const t27P = G.state.player;
  const t27Hp0 = t27Melee.hp;
  t27P.atk = 10; t27P.x = t27Melee.x; t27P.y = t27Melee.y;
  G.dealDamage(t27P, t27Melee, 10, { pierce: 0 });
  assert(t27Hp0 - t27Melee.hp < 10, 'T27b 敌人减伤率真实降低受到的伤害', { dealt: t27Hp0 - t27Melee.hp });
  reset();
  const t27Melee2 = G.makeEnemy(1, 0);
  const t27Hp20 = t27Melee2.hp;
  G.dealDamage(G.state.player, t27Melee2, 10, { pierce: 80 });
  assert(t27Hp20 - t27Melee2.hp > t27Hp0 - t27Melee.hp, 'T27b 破甲提升对敌伤害', { pierced: t27Hp20 - t27Melee2.hp, plain: t27Hp0 - t27Melee.hp });

  // T27c 四类怪定位：血量/攻击/速度按设计分化
  reset();
  const t27M = G.makeEnemy(1, 0), t27R = G.makeEnemy(1, 6), t27G = G.makeEnemy(1, 9);
  assert(t27M.hp > t27R.hp && t27R.hp > t27G.hp, 'T27c 血量：近战 > 远程 > 法师', { m: t27M.hp, r: t27R.hp, g: t27G.hp });
  assert(t27G.atk > t27M.atk && t27M.atk > t27R.atk, 'T27c 攻击：法师 > 近战 > 远程', { m: t27M.atk, r: t27R.atk, g: t27G.atk });
  assert(t27R.speed > G.CFG.melee.speed && t27M.speed > G.CFG.player.speed * 0.5, 'T27c 移速：远程快于近战', { r: t27R.speed, m: t27M.speed });
  assert(t27G.xp > t27M.xp && t27G.xp > t27R.xp, 'T27c 经验：法师 ×2 高于其他类型', { m: t27M.xp, r: t27R.xp, g: t27G.xp });

  // T27d 经验按血量给：同类型高分钟怪经验更多
  reset();
  const t27Lo = G.makeEnemy(1, 0), t27Hi = G.makeEnemy(9, 0);
  assert(t27Hi.xp > t27Lo.xp * 2, 'T27d 高血量敌人提供更多经验', { lo: t27Lo.xp, hi: t27Hi.xp });

  // T27e 精英光环：范围内小怪攻击提升，范围外不受影响
  reset();
  const t27El = G.makeElite(1);
  t27El.x = 500; t27El.y = 500;
  const t27Near = G.makeEnemy(1, 0), t27Far = G.makeEnemy(1, 5);
  t27Near.x = 520; t27Near.y = 500;
  t27Far.x = 1200; t27Far.y = 500;
  G.state.foes = [t27El, t27Near, t27Far];
  G.applyEliteAura(G.state.foes);
  assert(Math.abs(t27Near.auraAtkMul - G.CFG.elite.auraAtkMul) < 1e-9, 'T27e 光环内小怪攻击倍率生效', t27Near.auraAtkMul);
  assert(t27Far.auraAtkMul === 1, 'T27e 光环外小怪不受影响', t27Far.auraAtkMul);

  // T27f BOSS 半血狂暴：攻击提升、技能加速、环射加弹
  reset();
  const t27Boss = G.makeElite(5);
  t27Boss.hp = Math.floor(t27Boss.maxHp * 0.45);
  const t27Atk0 = t27Boss.atk;
  G.state.foes = [t27Boss];
  const t27P2 = G.state.player;
  t27Boss.x = t27P2.x + 300; t27Boss.y = t27P2.y;
  run(0.1);
  assert(t27Boss.raged === true, 'T27f BOSS 半血触发狂暴');
  assert(t27Boss.atk > t27Atk0, 'T27f 狂暴后攻击提升', { before: t27Atk0, after: t27Boss.atk });
  assert(G.CFG.boss.rageSkillMul < 1 && G.CFG.boss.rageRingAdd > 0 && G.CFG.boss.rageSpeedMul > 1, 'T27f 狂暴配置：技能加速/加弹/加速');

  // T27g 词缀数据集中化：正面数值在 data 中，affixDataOf 统一读取
  assert(G.AFFIXES.every(a => a.data && typeof a.data === 'object'), 'T27g 所有词缀正面数值集中在 data', G.AFFIXES.map(a => a.key).join(','));
  const t27Swift = G.AFFIXES.find(a => a.key === 'swift');
  assert(G.affixDataOf({ affix: t27Swift }).speedMul === t27Swift.data.speedMul, 'T27g affixDataOf 兼容直接赋 affix');

  // T27h 法师满员改刷近战（不是远程）
  reset();
  const t27Ma = G.makeEnemy(1, 8); t27Ma.type = 'mage';
  const t27Mb = G.makeEnemy(1, 9); t27Mb.type = 'mage';
  G.state.foes = [t27Ma, t27Mb];
  G.state.spawnT = G.spawnInterval(1) - 0.1;
  run(0.5);
  const t27New = G.state.foes.filter(f => !f.dead && f !== t27Ma && f !== t27Mb);
  assert(t27New.some(f => f.type === 'melee'), 'T27h 法师满员后补刷近战', t27New.map(f => f.type).join(','));

  // T28 无边界地图 / 屏幕外刷怪 / 法师闪现 / 后期曲线
  reset();
  {
    const V = G.CFG.viewport;
    let allOut = true, minD = Infinity;
    for (let i = 0; i < 30; i++) {
      const s = G.spawnNearPlayer();
      const dx = Math.abs(s.x - G.state.player.x), dy = Math.abs(s.y - G.state.player.y);
      const d = Math.hypot(dx, dy);
      minD = Math.min(minD, d);
      if (!(dx > V.w / 2 || dy > V.h / 2)) allOut = false;
    }
    assert(allOut && minD > Math.hypot(V.w / 2, V.h / 2), 'T28a 敌人刷新点始终在视口之外', { minD: Math.round(minD) });
  }

  reset();
  {
    const pBlink = G.state.player, M = G.CFG.mage;
    const mage = G.makeEnemy(1, 8);
    mage.type = 'mage'; mage.speed = 0; mage.x = pBlink.x + 1200; mage.y = pBlink.y;
    mage.blinkT = 0; mage.blinkWarnT = 0; mage.blinkTo = null;
    G.state.foes = [mage];
    run(0.1);
    const warned = mage.blinkWarnT > 0 && !!mage.blinkTo;
    run(0.5);
    const bd = G.dist(mage.x, mage.y, pBlink.x, pBlink.y);
    assert(warned && bd >= M.blinkMin - 30 && bd <= M.blinkMax + 30,
      'T28b 法师远离玩家后预警闪现到玩家周围（不移动）', { warned, bd: Math.round(bd) });
  }

  assert(G.CFG.world.w >= 50000 && G.CFG.world.h >= 50000, 'T28c 巨大地图模拟无边界');
  assert(G.cellHash(3, 7, 11) === G.cellHash(3, 7, 11) && G.cellHash(3, 7, 11) !== G.cellHash(4, 7, 11),
    'T28c 地形地块哈希确定且随坐标变化');

  assert(G.xpNeed(11) < 85 && G.xpNeed(91) > G.xpNeed(11) * 18,
    'T28d 前期经验降低、后期需求增大', { early: G.xpNeed(11), late: G.xpNeed(91) });
  assert(G.aliveCap(20) >= 30 && G.spawnInterval(20) <= 0.6,
    'T28e 后期敌人数量与刷新密度明显提高', { cap: G.aliveCap(20), interval: G.spawnInterval(20) });
  assert(G.aliveCap(1) >= 3 && G.aliveCap(5) < G.aliveCap(15) && G.aliveCap(15) < G.aliveCap(25),
    'T28e2 前期稀疏、随阶段递增', [G.aliveCap(1), G.aliveCap(5), G.aliveCap(15), G.aliveCap(25)]);
  assert(G.spawnInterval(1) > G.spawnInterval(20), 'T28e2 前期刷怪间隔长于后期',
    [G.spawnInterval(1), G.spawnInterval(20)]);

  reset();
  {
    const pXpCap = G.state.player;
    for (let i = 0; i < 6; i++) G.XP_CARD.apply(pXpCap);
    assert(Math.abs(pXpCap.xpMul - 1.6) < 1e-9 && G.XP_CARD.max(pXpCap),
      'T28f 升级效率倍率封顶 1.6（后期升级不被过度加速）', pXpCap.xpMul);
  }

  const t28Hp11 = G.curveHp(11), t28Hp21 = G.curveHp(21);
  const t28Atk11 = G.curveAtk(11), t28Atk21 = G.curveAtk(21);
  assert(t28Hp21 > t28Hp11 * 3 && t28Atk21 > t28Atk11 * 2,
    'T28g 怪物后期血量/攻击指数增长（跟上高等级玩家）',
    { hp: [t28Hp11, t28Hp21], atk: [t28Atk11, t28Atk21] });
  const xp11 = G.makeEnemy(11, 0).xp, xp21 = G.makeEnemy(21, 0).xp;
  assert(xp21 < xp11 * 3, 'T28g 击杀经验按血量开方，不随怪物指数暴涨', { xp11, xp21 });

  /* ================= T29：吸血删除 / 装备扩充 / 岩脉 / 技能线 / BOSS ================= */
  // T29a 吸血全部移除（装备系统已删除）
  reset();
  assert(!G.MODE_POOL.some(c => c.key === 'leech'), 'T29a 吸血箭卡已删除');
  assert(!('leech' in G.state.player.agg) && !('vamp' in G.state.player.agg),
    'T29a 玩家不再含吸血词条', Object.keys(G.state.player.agg).join(','));
  const pHp0 = G.state.player.hp;
  G.dealDamage(null, G.state.player, 10, { flat: true, noThorn: true, ignoreIframes: true });
  assert(G.state.player.hp === pHp0 - 10, 'T29a 受击不再吸血回血');

  // T29c 不规则岩脉
  reset();
  const rocks = G.state.obstacles;
  assert(rocks.length > 0 && rocks.every(o => Array.isArray(o.pts) && o.pts.length >= 5),
    'T29c 障碍物为不规则多边形', rocks.length);
  assert(new Set(rocks.map(o => o.veinId)).size >= 1 && rocks.some(o => o.veinId),
    'T29c 多边形组成岩脉', [...new Set(rocks.map(o => o.veinId))].length);

  // T29d 六条技能线实际生效（解锁 + 周期触发）
  reset();
  const p29 = G.state.player;
  const unlock29 = k => G.SKILL_CARDS.find(c => c.line === k && c.sub === 'unlock');
  ['shock', 'chain', 'drone', 'mine'].forEach(k => unlock29(k).apply(p29));
  const foe29 = G.makeEnemy(1, 0);
  foe29.x = p29.x + 100; foe29.y = p29.y;
  p29.sk.shock.t = 0;
  const hp29 = foe29.hp;
  G.state.foes = [foe29];
  run(0.1);
  assert(G.state.skillFx.some(f => f.kind === 'shock'), 'T29d 震荡波触发特效');
  assert(p29.skills.shock === 1 && p29.skills.chain === 1 && p29.skills.drone === 1 && p29.skills.mine === 1,
    'T29d 四条新技能线已解锁', p29.skills);

  // T30 输出统计：伤害按攻击方式归集
  reset();
  assert(!!G.state.dmgStats, 'T30 开局初始化输出统计', G.state.dmgStats);
  const p30 = G.state.player;
  const foe30 = G.makeEnemy(1, 0);
  foe30.x = p30.x + 120; foe30.y = p30.y;
  foe30.maxHp = 200; foe30.hp = 200;   // 高血量避免中途死亡中断归集
  foe30.res = null;                    // 剥离类型抗性，专测归集
  G.state.foes = [foe30];
  G.dealDamage(p30, foe30, 10, { tag: 'arrow', flat: true, noThorn: true });
  G.dealDamage(p30, foe30, 15, { tag: 'chain', flat: true, noThorn: true });
  G.dealDamage(p30, foe30, 5, { tag: 'shock', flat: true, noThorn: true });
  G.dealDamage(p30, foe30, 7, { tag: 'orbit', flat: true, noThorn: true });
  G.dealDamage(p30, foe30, 9, { tag: 'drone', flat: true, noThorn: true });
  G.dealDamage(p30, foe30, 12, { tag: 'mine', flat: true, noThorn: true });
  assert(G.state.dmgStats.arrow === 10 && G.state.dmgStats.chain === 15 && G.state.dmgStats.shock === 5
    && G.state.dmgStats.orbit === 7 && G.state.dmgStats.drone === 9 && G.state.dmgStats.mine === 12,
    'T30 六种攻击方式伤害分别归集', G.state.dmgStats);
  // 玩家承受的伤害（无 tag / 敌人来源）不计入
  const php30 = p30.hp;
  G.dealDamage(foe30, p30, 8, { flat: true, noThorn: true, ignoreIframes: true });
  G.dealDamage(p30, foe30, 6, { flat: true, noThorn: true });   // 未带 tag
  assert(G.state.dmgStats.arrow === 10 && p30.hp < php30, 'T30 无 tag 与玩家承伤不计数', G.state.dmgStats);
  // UI：伤害行 HTML 可生成且含六类
  const dmgHtml30 = G.ui.dmgRowsHtml(G.state.dmgStats);
  assert(['箭矢', '连锁闪电', '震荡波', '环绕飞刃', '浮游炮', '感应地雷'].every(n => dmgHtml30.indexOf(n) >= 0),
    'T30 输出统计 UI 含全部六类');

  // T31 障碍绕行：敌人被障碍物挡路时能绕过去，不会永久卡住
  reset();  const p31 = G.state.player;
  const foe31 = G.makeEnemy(1, 0);
  foe31.x = p31.x - 220; foe31.y = p31.y;
  const wallX = p31.x - 110;
  G.state.obstacles = [{
    x: wallX, y: p31.y, cx: wallX, cy: p31.y, r: 85, veinId: 't31', trap: null,
    pts: [{ x: -60, y: -85 }, { x: 45, y: -75 }, { x: 75, y: 5 }, { x: 30, y: 80 }, { x: -55, y: 72 }]
      .map(q => ({ x: wallX + q.x, y: p31.y + q.y }))
  }];
  G.state.foes = [foe31];
  const d0_31 = G.dist(foe31.x, foe31.y, p31.x, p31.y);
  for (let i = 0; i < 420; i++) { if (foe31.dead) break; G.updateEnemies(1 / 60); }
  const d1_31 = G.dist(foe31.x, foe31.y, p31.x, p31.y);
  assert(d1_31 < d0_31 - 80, 'T31 敌人能绕过障碍接近玩家（不卡死）', { d0: Math.round(d0_31), d1: Math.round(d1_31) });
  // 绕行后敌人不应残留在障碍物内部
  assert(!G.state.obstacles.some(o => G.circlePoly(foe31.x, foe31.y, foe31.r, o)),
    'T31 绕行过程中敌人不被卡进障碍物');

  // T32 敌人类型抗性/弱点 + 新类型生成 + 各攻击方式初始 DPS 对齐
  reset();
  const t32 = i => G.makeEnemy(1, i).type;
  assert(t32(0) === 'melee' && t32(3) === 'brute' && t32(4) === 'flyer'
    && t32(6) === 'ranged' && t32(8) === 'melee' && t32(9) === 'mage',
    'T32 敌人分布（近战/重甲/飞行近战/远程1%/法师；轰炸者已删除）',
    [0, 3, 4, 6, 8, 9].map(t32).join(','));
  // 远程占比 = 现有的 1/10（idx%100===6 一档 ≈1%）；轰炸者不再出现
  const dist200 = Array.from({ length: 200 }, (_, i) => G.makeEnemy(1, i).type);
  assert(dist200.filter(t => t === 'ranged').length === 2 && dist200.every(t => t !== 'bomber'),
    'T32 远程怪占比降至1%（现有1/10）且无轰炸者',
    { ranged: dist200.filter(t => t === 'ranged').length, bomber: dist200.filter(t => t === 'bomber').length });
  const p32 = G.state.player;
  const mk32 = t => {
    const f = G.makeEnemy(1, 0);
    f.type = t; f.res = G.ENEMY_RES[t] || null;
    f.maxHp = 500; f.hp = 500;
    return f;
  };
  const m32 = mk32('melee'), b32 = mk32('brute'), f32 = mk32('flyer'), r32 = mk32('ranged');
  G.state.foes = [m32, b32, f32, r32];
  // 重甲：地雷弱点 ×1.7 > 近战 ×1.4
  G.dealDamage(p32, m32, 10, { tag: 'mine', flat: true, noThorn: true });
  G.dealDamage(p32, b32, 10, { tag: 'mine', flat: true, noThorn: true });
  assert(500 - b32.hp > 500 - m32.hp, 'T32 重甲受到的地雷伤害高于普通近战（弱点）',
    { melee: 500 - m32.hp, brute: 500 - b32.hp });
  // 重甲：弹幕抗性 ×0.55（比近战 0.85 更低）
  const bHp0_32 = b32.hp;
  G.dealDamage(p32, b32, 10, { tag: 'arrow', flat: true, noThorn: true });
  assert(500 - bHp0_32 + b32.hp === 0 || (bHp0_32 - b32.hp) <= 7,
    'T32 重甲受箭矢伤害降低（×0.55）', bHp0_32 - b32.hp);
  // 飞行：震荡波半伤(×0.5)、地雷仍免疫，箭矢弱点
  const dealt32 = G.dealDamage(p32, f32, 50, { tag: 'shock', flat: true, noThorn: true });
  const dealt32b = G.dealDamage(p32, f32, 50, { tag: 'mine', flat: true, noThorn: true });
  assert(dealt32 === 25 && f32.hp === 475, 'T32 飞行单位受震荡波半伤(×0.5)', dealt32);
  assert(dealt32b === 0, 'T32 飞行单位仍免疫地雷', dealt32b);
  const dealt32c = G.dealDamage(p32, f32, 10, { tag: 'arrow', flat: true, noThorn: true });
  assert(dealt32c > 10, 'T32 飞行单位弱箭矢（×1.15）', dealt32c);
  // 远程：近身伤害降低（震荡波 ×0.65）
  const dealt32d = G.dealDamage(p32, r32, 10, { tag: 'shock', flat: true, noThorn: true });
  assert(dealt32d < 10 && dealt32d >= 6, 'T32 远程敌人受近身伤害降低（×0.65）', dealt32d);
  // 初始 DPS 对齐：各攻击方式典型战斗 DPS 与箭矢相差不超过 0.15~2.4 倍
  // （飞刃定位为「难命中的高单次伤害」，名义 DPS 偏高但实战命中率低，故上限放宽到 2.4）
  const arrowDps32 = p32.atk * p32.shotDmgMul / (G.CFG.player.atkCd * p32.atkCdMul);
  const dpsPairs32 = [
    ['闪电', p32.sk.chain.mult * p32.atk * 2 / p32.sk.chain.cd],        // 2 跳 AoE（低乘区工具型）
    ['震荡波', p32.sk.shock.mult * p32.atk * 3 / p32.sk.shock.cd],      // 半径内 3 目标
    ['飞刃', p32.orbitDmgMul * p32.atk / 0.45],                          // 贴身每 0.45s
    ['浮游炮', p32.sk.drone.mult * p32.atk / p32.sk.drone.cd],
    ['地雷', p32.sk.mine.mult * p32.atk * 2 / p32.sk.mine.cd]           // 常炸到 2 个
  ];
  dpsPairs32.forEach(pr => {
    const ratio32 = pr[1] / arrowDps32;
    assert(ratio32 > 0.15 && ratio32 < 2.4,
      'T32 ' + pr[0] + ' 初始 DPS 与箭矢对齐（×' + ratio32.toFixed(2) + '）', ratio32);
  });

  // T33a 多目标伤害递减：闪电每多弹射 1 目标 ×0.8
  reset();
  const p33 = G.state.player;
  G.SKILL_CARDS.find(c => c.line === 'chain' && c.sub === 'unlock').apply(p33);
  const fa33 = G.makeEnemy(1, 0), fb33 = G.makeEnemy(1, 0);
  fa33.maxHp = 300; fa33.hp = 300; fa33.res = null;
  fb33.maxHp = 300; fb33.hp = 300; fb33.res = null;
  fa33.x = p33.x + 100; fa33.y = p33.y;
  fb33.x = p33.x + 100; fb33.y = p33.y + 150;
  G.state.foes = [fa33, fb33];
  G.state.obstacles = [];
  G.fireChainBolt(p33, fa33, new Set());
  const dA33 = 300 - fa33.hp, dB33 = 300 - fb33.hp;
  assert(dA33 > 0 && dB33 > 0, 'T33a 闪电命中主目标与弹射目标', { dA: dA33, dB: dB33 });
  assert(Math.abs(dB33 - dA33 * 0.8) <= 1, 'T33a 弹射目标伤害 ×0.8 递减', { dA: dA33, dB: dB33 });

  // T33b 震荡波：距离衰减——越靠外伤害越低（近距满伤、远距衰减），与命中数无关
  reset();
  const p33b = G.state.player;
  G.SKILL_CARDS.find(c => c.line === 'shock' && c.sub === 'unlock').apply(p33b);
  const near33 = G.makeEnemy(1, 0), far33 = G.makeEnemy(1, 0);
  [near33, far33].forEach(f => { f.maxHp = 4000; f.hp = 4000; f.res = null; });
  const R33 = p33b.sk.shock.r;
  near33.x = p33b.x + R33 * 0.1; near33.y = p33b.y;    // 近中心
  far33.x = p33b.x + R33 * 0.95; far33.y = p33b.y;     // 接近边缘
  G.state.foes = [near33, far33];
  G.shockBlast(p33b, p33b.x, p33b.y, R33, p33b.sk.shock.mult, false);
  const nearDmg33 = 4000 - near33.hp, farDmg33 = 4000 - far33.hp;
  assert(nearDmg33 > 0 && farDmg33 > 0, 'T33b 震荡波近远目标均受伤', { near: nearDmg33, far: farDmg33 });
  assert(farDmg33 < nearDmg33, 'T33b 震荡波越向外伤害越低', { near: nearDmg33, far: farDmg33 });
  assert(farDmg33 >= nearDmg33 * 0.35, 'T33b 边缘伤害不低于中心35%', { near: nearDmg33, far: farDmg33 });
  // 与命中数无关：同样距离下 1 个目标和 3 个目标伤害一致
  reset();
  const p33b2s = G.state.player;
  G.SKILL_CARDS.find(c => c.line === 'shock' && c.sub === 'unlock').apply(p33b2s);
  const mkF = d => { const f = G.makeEnemy(1, 0); f.maxHp = 4000; f.hp = 4000; f.res = null; f.x = p33b2s.x + d; f.y = p33b2s.y; return f; };
  const oneF = mkF(60), threeF = [mkF(60), mkF(70), mkF(80)];
  G.state.foes = [oneF];
  G.shockBlast(p33b2s, p33b2s.x, p33b2s.y, p33b2s.sk.shock.r, p33b2s.sk.shock.mult, false);
  const oneDmg33 = 4000 - oneF.hp;
  G.state.foes = threeF;
  G.shockBlast(p33b2s, p33b2s.x, p33b2s.y, p33b2s.sk.shock.r, p33b2s.sk.shock.mult, false);
  assert(4000 - threeF[0].hp === oneDmg33, 'T33b 同距离下伤害不受命中数影响',
    { one: oneDmg33, three: 4000 - threeF[0].hp });

  // T33b2 震荡波撞墙反弹已取消：主波触及障碍物也不再生成反弹特效
  reset();
  const p33b2 = G.state.player;
  G.SKILL_CARDS.find(c => c.line === 'shock' && c.sub === 'unlock').apply(p33b2);
  G.state.foes = [];
  G.state.obstacles = [{ x: p33b2.x + 100, y: p33b2.y, r: 40 }];
  G.state.skillFx = [];
  G.shockBlast(p33b2, p33b2.x, p33b2.y, p33b2.sk.shock.r, p33b2.sk.shock.mult, true);
  assert(!G.state.skillFx.some(f => f.kind === 'shockBounce'), 'T33b2 震荡波不再生成反弹特效',
    G.state.skillFx.map(f => f.kind));

  // T33c 地雷引信：到期自动引爆
  reset();
  const p33c = G.state.player;
  G.SKILL_CARDS.find(c => c.line === 'mine' && c.sub === 'unlock').apply(p33c);
  p33c.sk.mine.t = 0;
  G.state.foes = [];
  run(0.3);
  assert(G.state.mines.length === 1, 'T33c 地雷已布设', G.state.mines.length);
  p33c.sk.mine.cd = 999;   // 拉长冷却，专测引信
  p33c.sk.mine.t = 999;    // 取消下一次部署
  run(G.MINE_FUSE + 0.2);
  assert(G.state.mines.length === 0, 'T33c 地雷到期自动引爆', G.state.mines.length);

  // T33d 解救俘虏任务（清怪解救）
  reset();
  const p33d = G.state.player;
  G.startTask('escort');
  assert(!!G.state.task && G.state.task.kind === 'escort', 'T33d 解救任务开启');
  const npc33 = G.state.task.npc;
  const guards33 = G.state.task.guards;
  assert(npc33.name === '囚徒' && npc33.captive === true, 'T33d 囚徒已生成且被囚禁', npc33.name);
  assert(guards33.length === 6 && guards33.every(g => g.guard === true), 'T33d 生成6名守卫', guards33.length);
  // 守卫环绕囚徒（半径 78~104）
  assert(guards33.every(g => G.dist(g.x, g.y, npc33.x, npc33.y) >= 70 && G.dist(g.x, g.y, npc33.x, npc33.y) <= 115),
    'T33d 守卫环绕囚徒');
  // 囚徒站桩：run 一小段位置不变
  const npcPos0_33 = { x: npc33.x, y: npc33.y };
  run(0.5);
  assert(G.dist(npc33.x, npc33.y, npcPos0_33.x, npcPos0_33.y) < 1, 'T33d 囚徒站桩不移动');
  // 守卫索敌玩家而非囚徒（解救任务里 taskFocus 始终返回玩家）
  G.state.obstacles = [];
  const guard0 = guards33[0];
  guard0.x = npc33.x + 120; guard0.y = npc33.y;
  p33d.x = npc33.x - 400; p33d.y = npc33.y;
  assert(G.taskFocus(guard0) === p33d, 'T33d 守卫索敌玩家而非囚徒');
  const gx0 = guard0.x;
  run(1.2);
  assert(guard0.x < gx0 - 10, 'T33d 守卫朝玩家方向移动', { from: Math.round(gx0), to: Math.round(guard0.x) });
  // 杀光守卫 → 解救成功转同伴
  guards33.forEach(g => { g.dead = true; });
  run(0.1);
  assert(!!G.state.companion && G.state.task === null, 'T33d 杀光守卫解救成功转同伴');
  const foe33e = G.makeEnemy(1, 0);
  foe33e.x = G.state.companion.x + 120; foe33e.y = G.state.companion.y;
  foe33e.maxHp = 200; foe33e.hp = 200; foe33e.res = null;
  G.state.foes = [foe33e];
  run(1.5);
  assert(foe33e.hp < 200, 'T33d 同伴自动射击敌人', 200 - foe33e.hp);
  // 囚徒死亡 → 失败惩罚
  reset();
  G.startTask('escort');
  const baseHp0_33 = G.state.player.baseHp;
  const npc33b = G.state.task.npc;
  npc33b.hp = 1;
  G.dealDamage(G.state.task.guards[0], npc33b, 100, { flat: true, noThorn: true });
  run(0.1);
  assert(npc33b.dead && G.state.task === null, 'T33d 囚徒遇害任务结束');
  assert(G.state.player.baseHp < baseHp0_33, 'T33d 失败惩罚：最大生命下降', G.state.player.baseHp);
  // 超时 → 失败
  reset();
  G.startTask('escort');
  G.state.task.time = 0.01;
  run(0.1);
  assert(G.state.task === null && !G.state.companion, 'T33d 超时解救失败');

  // T33f 地形与目标联动：解救任务可落在灾害附近，地形击杀计入清怪进度
  reset();
  const pHz = G.state.player;
  const hzAnchor = { x: pHz.x + 250, y: pHz.y };
  G.state.hazAnchors = [hzAnchor]; G.state.zones = [];
  const rndTask = Math.random;
  try { Math.random = () => 0; G.startTask('escort'); } finally { Math.random = rndTask; }
  const taskHz = G.state.task;
  assert(taskHz && taskHz.nearHazard && G.dist(taskHz.npc.x, taskHz.npc.y, hzAnchor.x, hzAnchor.y) < 1,
    'T33f 解救任务优先落在灾害锚点附近');
  const hzGuards = taskHz.guards;
  const hzx = hzGuards[0].x, hzy = hzGuards[0].y;
  hzGuards.forEach(g => { g.x = hzx; g.y = hzy; g.hp = 1; });
  G.state.hazards.push({ kind: 'fire', x: hzx, y: hzy, r: 60, t: 1.2, warn: 1.1, hit: false, boomT: 0, dmg: 999 });
  G.updateHazards(0.2);
  assert(hzGuards.every(g => g.dead && g.hazardKilled), 'T33f 火球击杀守卫并标记地形击杀');
  G.updateTasks(0.02);
  assert(G.state.task === null && !!G.state.companion, 'T33f 地形击杀计入解救进度并完成任务');

  // T33e 水晶任务
  reset();
  G.startTask('crystal');
  const crystals33 = G.state.task.crystals;
  assert(crystals33.length === 2 && G.state.foes.includes(crystals33[0]), 'T33e 水晶已生成并加入战场');
  crystals33.forEach(c => G.dealDamage(G.state.player, c, 500, { flat: true, noThorn: true }));
  run(0.1);   // 下一帧结算任务成功
  assert(G.state.task === null && (G.state.player.taskCdr || 0) === 1, 'T33e 摧毁水晶奖励 taskCdr');
  reset();
  G.startTask('crystal');
  G.state.task.time = 0.01;
  run(0.1);
  assert(G.state.task === null && (G.state.enemyRageT || 0) > 50, 'T33e 水晶超时进入敌人增伤期', G.state.enemyRageT);

  // T33f 流星任务
  reset();
  G.startTask('stars');
  const luck0_33 = G.state.player.luck;
  G.state.task.stars.forEach((s, i) => {
    s.x = G.state.player.x + (i < 2 ? 20 : 500);
    s.y = G.state.player.y;
  });
  run(0.5);
  assert(G.state.player.luck === luck0_33 + 1, 'T33f 收集流星幸运 +1', G.state.player.luck);

  // T29e BOSS 血量压迫感
  const boss29 = G.makeElite(5);
  const norm29 = G.makeEnemy(5, 0);
  assert(boss29.hp > norm29.hp * 8, 'T29e BOSS 血量远高于同期普通怪（持久战）', { boss: boss29.hp, norm: norm29.hp });
  assert(G.CFG.elite.bossHpMul >= 8, 'T29e BOSS 血量倍率配置', G.CFG.elite.bossHpMul);

  // T29g 升级选卡期间游戏完全暂停
  reset();
  G.gainXp(G.xpNeed(1));
  G.update(1 / 60);
  const tPause = G.state.time, foesPause = G.state.foes.length;
  G.update(1 / 60); G.update(1 / 60);
  assert(G.state.phase === 'levelup' && G.state.time === tPause && G.state.foes.length === foesPause,
    'T29g 升级弹窗期间 update 不推进游戏', { phase: G.state.phase, dt: G.state.time - tPause });

  // ============ T34 超级武器（进化走 build.js，试炼Boss已删除） ============
  const dimCard34 = (k, d) => G.SKILL_CARDS.find(c => c.kind === 'skill' && c.line === k && c.dim === d);
  const unlock34 = k => G.SKILL_CARDS.find(c => c.kind === 'skill' && c.line === k && c.sub === 'unlock');
  /** 把某线所有维度直接拉满（绕过升级流程，专测终极逻辑） */
  const maxLine = (p, k) => {
    if (!p.skills[k] && unlock34(k)) unlock34(k).apply(p);
    G.LINES[k].dims.forEach(d => { p.sd[k][d.key] = d.max; });
    G.applySkillBuild(p);
  };

  // T34a 核心字段与满级判定（试炼/终极卡系统已删除）
  reset();
  const p34 = G.state.player;
  assert(p34.evolved && Object.keys(p34.evolved).length === 0 && !('ultReady' in p34),
    'T34a 进化集合初始为空且无试炼标记', { evolved: p34.evolved, ultReady: p34.ultReady });
  assert(!G.ULT_CARDS && !G.ultimateCandidates && !G.onTrialBossKilled,
    'T34a 试炼Boss与终极卡系统已彻底移除');
  assert(!G.isLineMaxed(p34, 'arrow'), 'T34a 未满级时判定为 false');
  maxLine(p34, 'arrow');
  assert(G.isLineMaxed(p34, 'arrow'), 'T34a 全维度满级判定为 true');
  assert(!G.isLineMaxed(p34, 'chain'), 'T34a 其他线仍非满级');

  // T34d VS构筑：满级不触发试炼Boss；改为「武器满级 + 配方被动满级」自动进化
  reset();
  const p34d = G.state.player;
  p34d.weapons.shock = G.BUILD.WEAPON_MAX;
  p34d.passives.area = G.BUILD.PASSIVE_MAX;
  G.rebuildFromBuild(p34d);
  const evolved = G.checkEvolution(p34d);
  assert(evolved === 'shock' && p34d.evolved && p34d.evolved.shock === true,
    'T34d 满级+配方被动满级自动进化', { evolved, evolvedMap: p34d.evolved });
  G.state.obstacles = [];
  G.state.foes = [];
  G.state.taskT = 999;
  G.updateTasks(1 / 60);
  assert(!G.state.task || G.state.task.kind !== 'trial', 'T34d VS构筑下不再触发试炼Boss',
    G.state.task && G.state.task.kind);

  // T34e 多重进化：每局可拥有多把超级武器（各配方独立判定）
  reset();
  const p34e = G.state.player;
  p34e.weapons.shock = G.BUILD.WEAPON_MAX;
  p34e.passives.area = G.BUILD.PASSIVE_MAX;
  G.rebuildFromBuild(p34e);
  const evo1 = G.checkEvolution(p34e);
  p34e.weapons.mine = G.BUILD.WEAPON_MAX;
  p34e.passives.armor = G.BUILD.PASSIVE_MAX;   // 地雷配方需 armor
  G.rebuildFromBuild(p34e);
  const evo2 = G.checkEvolution(p34e);
  assert(evo1 === 'shock' && evo2 === 'mine' && G.evolvedCount(p34e) === 2 &&
    p34e.evolved.shock === true && p34e.evolved.mine === true,
    'T34e 一局可进化多把超级武器', { evo1, evo2, count: G.evolvedCount(p34e) });
  // 各自的终极质变同时生效：震荡波无视衰减 + 地雷连锁引爆
  assert(p34e.sk.shock.ultNoFalloff === true && p34e.sk.mine.ultChain === true,
    'T34e 多把超级武器的质变效果并存',
    { shock: p34e.sk.shock.ultNoFalloff, mine: p34e.sk.mine.ultChain });
  // 已进化的线不会重复进化
  const evo3 = G.checkEvolution(p34e);
  assert(evo3 === null && G.evolvedCount(p34e) === 2, 'T34e 已进化武器不重复进化', evo3);

  // T34f 六条超级武器质变效果（用作弊码赋予终极后断言运行参数）
  const checkUlt = (k, fn) => {
    reset();
    const p = G.state.player;
    G.grantUltimate(p, k);
    fn(p, G);
  };
  // 箭矢：箭数翻倍、穿5、射速+25%、穿透不衰减
  checkUlt('arrow', (p) => {
    const base = 1 + G.LINES.arrow.dims.find(d => d.key === 'count').max;
    assert(p.shots === base * 2, 'T34f 箭矢终极箭数翻倍', p.shots);
    assert(p.pierce >= 5 && p.ultPierceNoDecay === true, 'T34f 箭矢终极穿透5且不衰减', p.pierce);
    assert(Math.abs(p.arrowRangeMul - 1.55) < 1e-9, 'T34f 箭矢终极射程×1.55', p.arrowRangeMul);
    // 实际箭矢寿命：终极应比普通射程远（life = p.range × arrowRangeMul / 弹速）
    G.state.bullets = [];
    G.fireVolley(p);
    const ultLife = G.state.bullets[0].life;
    const normalLife = p.range / (G.CFG.player.bulletSpeed * p.bulletSpeedMul);
    assert(ultLife > normalLife * 1.5, 'T34f 箭矢终极子弹寿命变长（攻击范围更大）',
      { ult: ultLife.toFixed(3), normal: normalLife.toFixed(3) });
  });
  // 闪电：每跳不递减、目标+4、道数翻倍、麻痹延长
  checkUlt('chain', (p) => {
    assert(p.sk.chain.ultNoDecay === true && p.sk.chain.ultStun === 0.8, 'T34f 闪电终极不递减+麻痹延长');
    assert(p.sk.chain.jumps >= 6 && p.sk.chain.bolts >= 2, 'T34f 闪电终极目标+4道数翻倍',
      { jumps: p.sk.chain.jumps, bolts: p.sk.chain.bolts });
  });
  // 震荡波：半径×1.8、伤害×1.5、无视衰减（反弹已取消）
  checkUlt('shock', (p) => {
    const base = 180 + 24 * G.LINES.shock.dims.find(d => d.key === 'range').max;
    assert(Math.abs(p.sk.shock.r - base * 1.8) < 1, 'T34f 震荡波终极半径×1.8', p.sk.shock.r);
    assert(p.sk.shock.ultNoFalloff === true && p.sk.shock.ultBounces === undefined,
      'T34f 震荡波终极无视衰减（无反弹）', { noFalloff: p.sk.shock.ultNoFalloff, bounces: p.sk.shock.ultBounces });
  });
  // 飞刃：数量+6、常驻、命中半径放大、转速×1.4
  checkUlt('orbit', (p) => {
    assert(p.sk.orbit.ultPersistent === true && p.orbitHitRadius > 14, 'T34f 飞刃终极常驻+命中半径放大', p.orbitHitRadius);
    assert(p.sk.orbit.count >= 9, 'T34f 飞刃终极数量+6', p.sk.orbit.count);
  });
  // 浮游炮：数量+3、射速×1.6、穿透3、常驻
  checkUlt('drone', (p) => {
    assert(p.sk.drone.ultPersistent === true && p.sk.drone.ultPierce === 3, 'T34f 浮游炮终极常驻+穿透3');
    assert(p.sk.drone.count >= 4 && p.sk.drone.cd < 0.8, 'T34f 浮游炮终极数量+3射速提升',
      { count: p.sk.drone.count, cd: p.sk.drone.cd });
  });
  // 地雷：布雷翻倍、半径×2、连锁引爆
  checkUlt('mine', (p) => {
    assert(p.sk.mine.ultChain === true, 'T34f 地雷终极连锁引爆标记');
    const base = 80 + 20 * G.LINES.mine.dims.find(d => d.key === 'range').max;
    assert(Math.abs(p.sk.mine.r - base * 2) < 1, 'T34f 地雷终极半径×2', p.sk.mine.r);
  });

  // T34g 作弊码：直接赋予终极武器
  reset();
  const p34g = G.state.player;
  assert(G.grantUltimate(p34g, 'shock') === true, 'T34g 作弊码赋予终极武器');
  assert(p34g.evolved && p34g.evolved.shock === true, 'T34g 作弊码锁定终极', p34g.evolved);
  assert(G.isLineMaxed(p34g, 'shock'), 'T34g 作弊码拉满该线全维度');
  assert(p34g.sk.shock.ultNoFalloff === true, 'T34g 作弊码终极质变已生效');
  // 叠加：再赋予另一条线，两把超级武器质变并存
  G.grantUltimate(p34g, 'chain');
  assert(p34g.evolved.shock === true && p34g.evolved.chain === true &&
    p34g.sk.chain.ultNoDecay === true && p34g.sk.shock.ultNoFalloff === true,
    'T34g 作弊码可叠加多把终极（互不覆盖）');

  // ===== T36 远程怪极少化 + 飞刃终极三层反向刀阵 + 多段伤害 =====
  // T36a 类型分布：远程 idx%100===6 一档（≈1%，现有 1/10），idx7/8 改刷近战，轰炸者已删除
  const dist36 = Array.from({ length: 10 }, (_, i) => G.makeEnemy(1, i).type);
  assert(dist36[6] === 'ranged' && dist36[7] === 'melee' && dist36[8] === 'melee',
    'T36a idx6远程(idx%100===6)/idx7、idx8近战', dist36.join(','));
  const dist100 = Array.from({ length: 100 }, (_, i) => G.makeEnemy(1, i).type);
  assert(dist100.filter(t => t === 'ranged').length === 1 && dist100.every(t => t !== 'bomber'),
    'T36a 远程怪占比降至1%（现有1/10）且无轰炸者',
    { ranged: dist100.filter(t => t === 'ranged').length, bomber: dist100.filter(t => t === 'bomber').length });

  // T36b 飞刃终极三层结构：ring 0/1/2 三层，外/内环反向（dir=-1）、半径递增
  reset();
  const p36 = G.state.player;
  G.grantUltimate(p36, 'orbit');
  p36.orbits = p36.sk.orbit.count;   // 模拟终极常驻（游戏循环 updateSkills 中展开）
  assert(p36.orbitTriple === true, 'T36b 飞刃终极三层刀阵标记');
  const bs36 = G.orbitPositions(p36);
  const rings36 = [...new Set(bs36.map(b => b.ring))].sort();
  assert(rings36.length === 3 && rings36[0] === 0 && rings36[2] === 2, 'T36b 三层刀刃均有 ring 标记', rings36);
  const radOf = r => G.dist(p36.x, p36.y, bs36.find(b => b.ring === r).x, bs36.find(b => b.ring === r).y);
  assert(radOf(1) > radOf(0) && radOf(0) > radOf(2), 'T36b 外环>主环>内环半径', [radOf(0), radOf(1), radOf(2)]);
  assert(bs36.find(b => b.ring === 1).dir === -1 && bs36.find(b => b.ring === 2).dir === -1
    && bs36.find(b => b.ring === 0).dir === 1, 'T36b 外环/内环反向旋转');
  const cntMain = bs36.filter(b => b.ring === 0).length;
  assert(cntMain > bs36.filter(b => b.ring === 1).length
    && cntMain > bs36.filter(b => b.ring === 2).length, 'T36b 主环数量多于外/内环',
    { main: cntMain, outer: bs36.filter(b => b.ring === 1).length, inner: bs36.filter(b => b.ring === 2).length });

  // T36c 多段伤害：同一敌人被三层各命中一次（独立冷却），一帧内掉三段血
  reset();
  const p36c = G.state.player;
  G.grantUltimate(p36c, 'orbit');
  p36c.orbits = p36c.sk.orbit.count;
  p36c.orbitR = 30;              // 缩小三层半径，保证都在敌人判定范围内
  p36c.orbitHitRadius = 60;
  const foe36 = G.makeEnemy(1, 0);
  foe36.x = p36c.x; foe36.y = p36c.y;
  foe36.hp = foe36.maxHp = 100000; foe36.def = 0; foe36.shield = 0;
  G.state.foes = [foe36];
  const hp36a = foe36.hp;
  G.updateOrbitBlades(p36c, 0.016);
  const dmg36 = hp36a - foe36.hp;
  const oneHit36 = p36c.atk * p36c.orbitDmgMul;
  assert(dmg36 >= oneHit36 * 2.5, 'T36c 三层同帧多段伤害（≥2.5段）', { dmg: dmg36, oneHit: oneHit36 });
  assert(foe36.orbitRingCd && foe36.orbitRingCd.filter(c => c > 0).length === 3,
    'T36c 三层各自触发独立冷却', foe36.orbitRingCd);
  // 紧接着一帧内冷却未结束，不再重复伤害
  const hp36b = foe36.hp;
  G.updateOrbitBlades(p36c, 0.016);
  assert(foe36.hp === hp36b, 'T36c 冷却期内不再重复结算');

  // T36d 重开清空三层标记
  reset();
  assert(G.state.player.orbitTriple === false, 'T36d 重开后飞刃三层标记清空');

  // ===== T37 开局选择初始武器 =====
  // T37a 默认 startRun() 仍解锁箭矢（兼容旧调用/测试）
  G.startRun();
  assert(G.state.player.skills.arrow === 1 && G.state.player.startLine === 'arrow', 'T37a 默认开局仍是箭矢');

  // T37b 每把武器都能作为初始武器，且仅解锁该线
  const allLines = G.LINE_KEYS;
  assert(allLines.length === 8, 'T37b 共八条攻击线可选', allLines.length);
  allLines.forEach(line => {
    G.startRun(line);
    const p = G.state.player;
    const unlocked = allLines.filter(k => p.skills[k] === 1);
    assert(p.startLine === line && p.skills[line] === 1 && unlocked.length === 1,
      'T37b 初始武器=' + line + ' 仅解锁该线', { start: p.startLine, unlocked });
  });

  // T37c 选闪电开局：闪电可用（有技能参数），箭矢未解锁
  G.startRun('chain');
  const p37 = G.state.player;
  assert(p37.skills.arrow === 0 && p37.skills.chain === 1, 'T37c 闪电开局箭矢未解锁',
    { arrow: p37.skills.arrow, chain: p37.skills.chain });
  assert(p37.sk.chain && p37.sk.chain.jumps >= 2, 'T37c 闪电开局技能参数正常', p37.sk.chain);

  // T37d 初始武器无维度升级（1 级基础）
  G.startRun('shock');
  const sd37 = G.state.player.sd.shock;
  assert(Object.keys(sd37).every(d => sd37[d] === 0), 'T37d 初始武器无维度卡升级', sd37);

  // T37e 选武器界面存在且导出
  assert(typeof G.ui.showStartSelect === 'function', 'T37e 开局选择界面函数已导出');
  assert(!!G.$('startOverlay') && !!G.$('startCards'), 'T37e 开局选择界面 DOM 存在');

  // T37f 非箭矢武器开局：不会自动射出箭矢（修复：持续射击需箭矢线解锁）
  G.startRun('chain');
  G.state.bullets = [];
  run(1.5);
  const arrowBullets37 = G.state.bullets.filter(b => b.side === 'p');
  assert(arrowBullets37.length === 0, 'T37f 闪电开局不射箭矢', arrowBullets37.length);
  // 抽到箭矢解锁卡后恢复射击
  const unlockArrow37 = G.SKILL_CARDS.find(c => c.line === 'arrow' && c.sub === 'unlock');
  unlockArrow37.apply(G.state.player);
  G.state.bullets = [];
  run(1.5);
  assert(G.state.bullets.some(b => b.side === 'p'), 'T37f 解锁箭矢后恢复射击',
    G.state.bullets.filter(b => b.side === 'p').length);

  // ===== T38 飞刃防贴身：飞行判定增强 + 伤害加强 =====
  G.startRun('orbit');
  const p38 = G.state.player;
  assert(Math.abs(p38.orbitDmgMul - 1.1) < 1e-9, 'T38 飞刃单次伤害倍率提升到1.1', p38.orbitDmgMul);
  const groundFoe38 = G.makeEnemy(1, 0);    // melee 地面
  const flyFoe38 = G.makeEnemy(1, 4);       // flyer 飞行
  const reachGround38 = G.orbitHitRadiusFor(p38, groundFoe38);
  const reachFly38 = G.orbitHitRadiusFor(p38, flyFoe38);
  assert(flyFoe38.fly === true, 'T38 测试对象为飞行单位');
  assert(reachFly38 > reachGround38 * 1.4, 'T38 飞刃对飞行单位命中判定显著放大',
    { ground: reachGround38.toFixed(1), fly: reachFly38.toFixed(1) });
  // 近距离飞行怪能被飞刃扫到（放在飞刃环内侧）
  p38.orbits = p38.sk.orbit.count;
  p38.orbitR = 60;
  flyFoe38.x = p38.x + 50; flyFoe38.y = p38.y;
  flyFoe38.hp = flyFoe38.maxHp = 100000; flyFoe38.def = 0; flyFoe38.shield = 0;
  G.state.foes = [flyFoe38];
  G.state.obstacles = [];
  const hpFly38 = flyFoe38.hp;
  run(0.8);
  assert(flyFoe38.hp < hpFly38, 'T38 飞刃能打到贴身飞行怪', hpFly38 - flyFoe38.hp);

  // ===== T39 震荡波扩散波面命中 + 命中音效节流 =====
  G.startRun('shock');
  const p39 = G.state.player;
  // 放一个远处敌人（波尚未扫到时不应受伤）
  const farFoe39 = G.makeEnemy(1, 0);
  farFoe39.maxHp = 100000; farFoe39.hp = 100000; farFoe39.def = 0; farFoe39.shield = 0; farFoe39.res = null;
  const R39 = p39.sk.shock.r;
  farFoe39.x = p39.x + R39 * 0.9; farFoe39.y = p39.y;
  G.state.foes = [farFoe39];
  G.state.skillFx = [];
  G.spawnShockWave(p39, p39.x, p39.y, R39, p39.sk.shock.mult);
  const w39 = G.state.skillFx.find(f => f.wave).wave;
  assert(w39 && w39.r === 0, 'T39 扩散波从中心半径0开始', w39 && w39.r);
  // 推进一小步：波面半径 >0 但还没到远敌（0.9R），远敌不受伤
  G.advanceShockWaves(0.05);
  const rAfter39 = w39.r;
  assert(rAfter39 > 0 && rAfter39 < R39 * 0.9, 'T39 波面逐步扩散', rAfter39);
  assert(farFoe39.hp === 100000, 'T39 波面未扫到时敌人不受伤', 100000 - farFoe39.hp);
  // 继续推进直到波面扫过远敌
  for (let i = 0; i < 20 && w39.r < R39; i++) G.advanceShockWaves(0.05);
  assert(farFoe39.hp < 100000, 'T39 波面扫到后敌人才受伤', 100000 - farFoe39.hp);
  assert(w39.hit.has(farFoe39), 'T39 敌人被波面标记命中一次');

  // 音效节流：连续多次 sfxHit 在极短时间内只播放一次
  G.resetHitSfx();
  const playsBefore39 = G.getHitSfxPlays();
  for (let i = 0; i < 8; i++) G.sfxHit(false);
  const playsAfter39 = G.getHitSfxPlays() - playsBefore39;
  assert(playsAfter39 === 1, 'T39 同帧多次命中音效只播放一次', playsAfter39);

  // ===== T40 飞行敌人骚扰攻击：命中后飞远，再回来 =====
  // T40a 掠袭者：贴近命中后切脱离并拉远距离
  reset();
  const p40 = G.state.player;
  const fly40 = G.makeEnemy(1, 4);   // flyer
  fly40.x = p40.x + 30; fly40.y = p40.y;
  fly40.atkCd = 0;
  G.state.foes = [fly40];
  G.state.obstacles = [];
  const hp40 = p40.hp;
  assert(fly40.diveState === 'approach', 'T40a 掠袭者初始为逼近状态');
  run(0.1);
  assert(fly40.diveState === 'retreat', 'T40a 掠袭者命中后切脱离', fly40.diveState);
  const dFly40 = G.dist(fly40.x, fly40.y, p40.x, p40.y);
  run(0.5);
  const dFly40b = G.dist(fly40.x, fly40.y, p40.x, p40.y);
  assert(dFly40b > dFly40, 'T40a 脱离期间飞离玩家', { from: dFly40.toFixed(1), to: dFly40b.toFixed(1) });
  // 拉到安全距离后转回逼近
  for (let i = 0; i < 120 && fly40.diveState === 'retreat'; i++) run(0.05);
  assert(fly40.diveState === 'approach', 'T40a 飞远后重新逼近准备下次攻击', fly40.diveState);
  // T40b 飞行轰炸者已删除：不再生成 bomber 类型
  const b40 = G.makeEnemy(1, 8);
  assert(b40.type === 'melee' && !G.CFG.bomber, 'T40b 飞行轰炸者已彻底删除（idx8 改刷近战）', b40.type);

  // ===== T41 VS构筑系统：武器8级 / 槽位取舍 / 被动 / 进化配方 =====
  const B = G.BUILD;
  // T41a 开局一件武器、无被动
  reset();
  const p41 = G.state.player;
  assert(!!p41.weapons && !!p41.passives, 'T41a 构筑字段已初始化');
  assert(G.weaponCount(p41) === 1 && G.weaponLevel(p41, 'arrow') === 1, 'T41a 开局仅1件初始武器');
  assert(G.passiveCount(p41) === 0, 'T41a 开局无被动');

  // T41b 武器固定8级路线：升级逐级、满级锁定
  G.upgradeWeapon(p41, 'arrow');
  assert(G.weaponLevel(p41, 'arrow') === 2, 'T41b 武器升到Lv2', G.weaponLevel(p41, 'arrow'));
  assert(p41.shots === 2, 'T41b Lv2维度映射到运行参数（箭矢2支）', p41.shots);
  for (let i = 0; i < 10; i++) G.upgradeWeapon(p41, 'arrow');
  assert(G.weaponLevel(p41, 'arrow') === B.WEAPON_MAX, 'T41b 武器满级锁定在8', G.weaponLevel(p41, 'arrow'));

  // T41c 武器槽动态上限（池子数量的 2/3，当前 8 池 → 5 格）
  reset();
  const p41c = G.state.player;
  const wSlotsC = G.BUILD.WEAPON_SLOTS, pSlotsC = G.BUILD.PASSIVE_SLOTS;
  assert(wSlotsC === G.slotCount(Object.keys(G.BUILD.WEAPON_LEVELS).length)
      && pSlotsC === G.slotCount(G.BUILD.PASSIVE_IDS.length),
    'T41c 武器/被动槽位随池子数量动态计算', { wSlotsC, pSlotsC });
  assert(wSlotsC === 5 && pSlotsC === 5, 'T41c 当前 8 池 → 各 5 格', [wSlotsC, pSlotsC]);
  // 槽位计算器：池子增减时按比例变化（6→4、8→5、10→7，最小 1）
  assert(G.slotCount(6) === 4 && G.slotCount(8) === 5 && G.slotCount(10) === 7 && G.slotCount(1) === 1,
    'T41c 槽位随池子数量动态变化（6→4/8→5/10→7/1→1）',
    [G.slotCount(6), G.slotCount(8), G.slotCount(10), G.slotCount(1)]);
  // 开局已有 1 把武器，再填满剩余槽位
  const otherWeaponsC = Object.keys(G.BUILD.WEAPON_LEVELS).filter(k => !p41c.weapons[k]);
  otherWeaponsC.slice(0, wSlotsC - 1).forEach(k => G.addWeapon(p41c, k));
  assert(G.weaponCount(p41c) === wSlotsC, 'T41c 武器槽可填满', G.weaponCount(p41c));
  const extraWeaponC = otherWeaponsC.find(k => !p41c.weapons[k]);
  assert(extraWeaponC && G.addWeapon(p41c, extraWeaponC) === false, 'T41c 满槽后不能再加武器');

  // T41d 被动槽动态上限 + 属性增益生效
  reset();
  const p41d = G.state.player;
  const atk41d0 = p41d.atk;
  G.upgradePassive(p41d, 'might');
  assert(G.passiveLevel(p41d, 'might') === 1 && p41d.atk > atk41d0,
    'T41d 力量被动生效（攻击提升）', { atk0: atk41d0, atk1: p41d.atk });
  const restPassivesD = G.BUILD.PASSIVE_IDS.filter(id => !p41d.passives[id]);
  restPassivesD.slice(0, pSlotsC - 1).forEach(id => G.upgradePassive(p41d, id));
  assert(G.passiveCount(p41d) === pSlotsC, 'T41d 被动槽可填满', G.passiveCount(p41d));
  const extraPassiveD = restPassivesD.find(id => !p41d.passives[id]);
  assert(extraPassiveD && G.upgradePassive(p41d, extraPassiveD) === false, 'T41d 满槽后不能再加新被动');

  // T41e 进化配方：仅武器满级+指定被动满级才进化
  reset();
  const p41e = G.state.player;
  p41e.weapons.arrow = B.WEAPON_MAX;
  G.rebuildFromBuild(p41e);
  assert(G.checkEvolution(p41e) === null, 'T41e 仅武器满级不进化');
  p41e.passives.might = B.PASSIVE_MAX;   // arrow 配方 = might
  G.rebuildFromBuild(p41e);
  assert(G.checkEvolution(p41e) === 'arrow' && p41e.evolved.arrow === true,
    'T41e 武器满级+力量满级→进化贯穿诸天', p41e.ultimate);

  // T41e2 八把武器进化配方一一对应，无重复被动
  const recipes41 = G.BUILD.EVOLVE_RECIPE;
  const recipeVals41 = Object.keys(recipes41).map(k => recipes41[k]);
  assert(G.LINE_KEYS.length === 8 && Object.keys(recipes41).length === 8,
    'T41e2 八把武器均有进化配方', recipes41);
  assert(new Set(recipeVals41).size === 8,
    'T41e2 八配方被动互不重复', recipeVals41);
  assert(recipeVals41.every(id => !!G.BUILD.PASSIVES[id]),
    'T41e2 配方被动均为合法被动道具', recipeVals41);

  // T41f 卡池：优先含武器/被动构筑卡，满级武器不再出升级卡
  reset();
  const p41f = G.state.player;
  const bag41f = G.makeLevelCards(p41f);
  assert(bag41f.some(c => c.kind === 'weapon' || c.kind === 'passive'),
    'T41f 升级卡池含构筑卡', bag41f.map(c => c.kind).join(','));
  p41f.weapons.arrow = B.WEAPON_MAX;
  G.rebuildFromBuild(p41f);
  const bag41f2 = G.makeLevelCards(p41f);
  assert(!bag41f2.some(c => c.kind === 'weapon' && c.line === 'arrow' && !c.isNew),
    'T41f 满级武器不再出现在升级卡池', bag41f2.map(c => c.key || c.attr).join(','));

  // T41g 端到端：通过升级弹窗选构筑卡确实推进构筑（多次抽卡池确保覆盖武器/被动）
  reset();
  const p41g = G.state.player;
  let wCard = null, pCard = null;
  for (let i = 0; i < 30 && (!wCard || !pCard); i++) {
    G.makeLevelCards(p41g).forEach(c => {
      if (c.kind === 'weapon' && !wCard) wCard = c;
      if (c.kind === 'passive' && !pCard) pCard = c;
    });
  }
  assert(!!wCard && !!pCard, 'T41g 卡池能提供武器卡与被动卡');
  G.state.pendingLevelUps = 1;
  G.showLevelUp();
  G.chooseLevelCard(wCard);
  assert(G.weaponLevel(G.state.player, wCard.line) >= 1 && G.weaponCount(G.state.player) >= 1,
    'T41g 选武器卡后构筑推进', { line: wCard.line, lv: G.weaponLevel(G.state.player, wCard.line), count: G.weaponCount(G.state.player) });
  G.state.pendingLevelUps = 1;
  G.showLevelUp();
  G.chooseLevelCard(pCard);
  assert(G.passiveLevel(G.state.player, pCard.pid) >= 1, 'T41g 选被动卡后获得被动',
    G.passiveLevel(G.state.player, pCard.pid));

  // ===== T42：对标 VS 的怪物刷新策略 / 血量平滑 / 数量上限 =====
  // T42a 四阶段划分：1-5 试探 / 6-15 爬升 / 16-25 高压 / 26+ 满负荷
  assert(G.spawnPhase(1) === 0 && G.spawnPhase(5) === 0 && G.spawnPhase(6) === 1 &&
    G.spawnPhase(15) === 1 && G.spawnPhase(16) === 2 && G.spawnPhase(25) === 2 &&
    G.spawnPhase(26) === 3 && G.spawnPhase(60) === 3,
    'T42a 四阶段按分钟正确划分', [1, 5, 6, 15, 16, 25, 26, 60].map(G.spawnPhase));
  // T42b 成群批量：阶段越靠后单次刷越多
  const batches42 = [1, 8, 18, 30].map(m => G.spawnBatch(m));
  assert(batches42[0][1] < batches42[1][1] && batches42[1][1] < batches42[2][1] &&
    batches42[2][1] < batches42[3][1],
    'T42b 成群批量随阶段递增', batches42);
  assert(batches42.every(b => b[1] >= 2), 'T42b 每阶段都成群（至少2只）', batches42);
  // T42c 上限对标：capMax=200，后期逼近但受阶段倍率约束
  assert(G.CFG.spawn.capMax === 200 && G.aliveCap(60) === 200,
    'T42c 后期存活上限达200', G.aliveCap(60));
  assert(G.aliveCap(1) < G.aliveCap(30) && G.aliveCap(30) <= 200,
    'T42c 数量随阶段爬升且不越界', [G.aliveCap(1), G.aliveCap(30)]);
  // T42d 血量平滑：逐分钟递增且无两分钟断崖（相邻增幅均匀）
  const hps42 = [1, 2, 3, 4, 5].map(m => G.curveHp(m));
  const jumps42 = [];
  for (let i = 1; i < hps42.length; i++) jumps42.push(hps42[i] / hps42[i - 1]);
  assert(jumps42.every(j => j > 1.05 && j < 1.45),
    'T42d 血量逐分钟平滑增长（无断崖）', { hp: hps42, jumps: jumps42.map(j => j.toFixed(2)) });
  // 档首锚点不变：奇数分钟值与旧阶梯（33.6×1.55^tier）一致
  assert(Math.abs(G.curveHp(11) - 33.6 * Math.pow(1.55, 5)) < 1,
    'T42d 奇数分钟锚点保持原阶梯强度', G.curveHp(11));
  // T42e 成群从四周：一批怪的出生角度分散（非同一方向）
  reset();
  const p42 = G.state.player;
  const wall42 = [];
  for (let i = 0; i < 6; i++) {
    const base = 0.5, angle = base + (i / 6) * Math.PI * 1.6;
    wall42.push(G.spawnNearPlayer(angle));
  }
  // 至少分布在两个象限（以玩家为中心判断方位）
  const quadrants42 = new Set(wall42.map(s => (s.x >= p42.x ? 1 : 0) + (s.y >= p42.y ? 2 : 0)));
  assert(quadrants42.size >= 2, 'T42e 成群敌人分散到玩家四周', [...quadrants42]);

  // ===== T-M 移动端适配：虚拟摇杆 / 输入合并 / 性能降级 / 构筑面板 =====
  // T-M1 摇杆纯函数：死区与归一化（BASE_R=58，DEAD=0.14）
  const sv0 = G.touch.stickVector(0, 0);
  assert(sv0.dx === 0 && sv0.dy === 0, 'T-M1 摇杆零偏移无输出');
  const svDead = G.touch.stickVector(4, 3);   // 半径 5 < 死区 ≈8.1
  assert(svDead.dx === 0 && svDead.dy === 0, 'T-M1 死区内无输出', svDead);
  const svEdge = G.touch.stickVector(58, 0);  // 满偏 → 幅度 1
  assert(Math.abs(Math.hypot(svEdge.dx, svEdge.dy) - 1) < 0.02 && svEdge.dx > 0.9,
    'T-M1 满偏输出归一化幅度1', svEdge);
  const svHalf = G.touch.stickVector(29, 0);  // 半程（死区外）→ 缓速幅度
  const magHalf = Math.hypot(svHalf.dx, svHalf.dy);
  assert(magHalf > 0.2 && magHalf < 0.9, 'T-M1 半程缓速幅度', magHalf.toFixed(2));
  const svDiag = G.touch.stickVector(41, 41);
  assert(Math.hypot(svDiag.dx, svDiag.dy) <= 1.01, 'T-M1 斜向不超速',
    Math.hypot(svDiag.dx, svDiag.dy).toFixed(2));

  // T-M2 触屏检测：无头/桌面环境为 false，摇杆不启用
  assert(G.touch.isTouchDevice() === false, 'T-M2 无头/桌面环境不启用触控');
  assert(!!G.engine.touch && G.engine.touch.active === false, 'T-M2 引擎默认无触控输入');

  // T-M3 moveVec 合并：键盘 + 摇杆向量叠加，玩家侧幅度钳制保持键盘手感
  reset();
  G.engine.keys.clear();
  G.engine.keys.add('d');
  const mv0 = G.engine.moveVec();
  assert(mv0.dx === 1 && mv0.dy === 0, 'T-M3 键盘输入不变', mv0);
  G.engine.touch.active = true; G.engine.touch.dx = 0.4; G.engine.touch.dy = 0;
  const mv1 = G.engine.moveVec();
  assert(Math.abs(mv1.dx - 1.4) < 1e-9 && mv1.dy === 0, 'T-M3 键盘+摇杆向量合并', mv1);
  G.engine.keys.clear(); G.engine.keys.add('w'); G.engine.keys.add('d');
  G.engine.touch.active = false;
  const mvDiag = G.engine.moveVec();
  assert(Math.abs(Math.hypot(mvDiag.dx, mvDiag.dy) - Math.SQRT2) < 1e-9, 'T-M3 键盘对角保持原样');
  const pM3 = G.state.player;
  G.state.obstacles = []; G.state.sites = [];   // 排除碰撞/事件干扰
  const x0M3 = pM3.x, y0M3 = pM3.y;
  run(1);
  assert(G.dist(pM3.x, pM3.y, x0M3, y0M3) > 100, 'T-M3 键盘对角仍全速移动',
    Math.round(G.dist(pM3.x, pM3.y, x0M3, y0M3)));
  G.engine.keys.clear();

  // T-M4 摇杆模拟量：0.4 幅度 → 1 秒位移 ≈ 0.4 × speed（缓速走位）
  reset();
  G.state.obstacles = []; G.state.sites = [];
  const pSlow = G.state.player;
  const x0S = pSlow.x;
  G.engine.touch.active = true; G.engine.touch.dx = 0.4; G.engine.touch.dy = 0;
  run(1);
  const distS = pSlow.x - x0S;
  const expectS = G.CFG.player.speed * 0.4;
  assert(Math.abs(distS - expectS) < expectS * 0.15, 'T-M4 摇杆小幅=按比例缓速走位',
    { dist: Math.round(distS), expect: Math.round(expectS) });
  G.touch.release();
  assert(G.engine.touch.active === false, 'T-M4 释放摇杆后输入清零');

  // T-M5 性能降级：lowFx 时敌人上限软降 120，关闭后恢复
  assert(G.CFG.perf && G.CFG.perf.lowFx === false, 'T-M5 桌面默认 fullFx');
  const capM = G.aliveCap(60);
  G.CFG.perf.lowFx = true;
  assert(G.aliveCap(60) <= G.CFG.perf.capMaxMobile && G.aliveCap(60) < capM,
    'T-M5 lowFx 敌人上限软降', G.aliveCap(60));
  G.CFG.perf.lowFx = false;
  assert(G.aliveCap(60) === capM, 'T-M5 关闭降级后恢复', G.aliveCap(60));

  // T-M6 构筑面板：play 阶段打开即暂停，关闭恢复，反复开关安全
  reset();
  assert(typeof G.ui.showBuildPanel === 'function' && typeof G.ui.hideBuildPanel === 'function',
    'T-M6 构筑面板函数已导出');
  G.ui.showBuildPanel();
  assert(G.el.buildOverlay.classList.contains('show') && G.state.paused === true, 'T-M6 打开面板并暂停');
  G.ui.hideBuildPanel();
  assert(!G.el.buildOverlay.classList.contains('show') && G.state.paused === false, 'T-M6 关闭面板并恢复');
  G.ui.showBuildPanel();
  G.ui.hideBuildPanel();
  assert(G.state.paused === false, 'T-M6 反复开关面板安全');

  // T-M7 自动索敌：触屏指针（合成鼠标事件的根源）不得接管瞄准
  assert(typeof G.engine.pointerMove === 'function', 'T-M7 指针处理函数已导出');
  G.engine.pointerMove({ clientX: 300, clientY: 200, pointerType: 'touch' });
  assert(G.engine.mouse.active === false, 'T-M7 触屏指针不激活鼠标瞄准（保持自动索敌）',
    { active: G.engine.mouse.active, cx: G.engine.mouse.cx });
  G.engine.pointerMove({ clientX: 300, clientY: 200, pointerType: 'mouse' });
  assert(G.engine.mouse.active === true && G.engine.mouse.cx === 300 && G.engine.mouse.cy === 200,
    'T-M7 真实鼠标仍接管瞄准', { active: G.engine.mouse.active, cx: G.engine.mouse.cx, cy: G.engine.mouse.cy });
  // 无 pointerType 的旧事件（部分桌面环境）按鼠标处理，行为不变
  G.engine.pointerMove({ clientX: 480, clientY: 300 });
  assert(G.engine.mouse.cx === 480 && G.engine.mouse.cy === 300, 'T-M7 无 pointerType 时兼容旧鼠标行为');
  G.engine.mouse.active = false;   // 还原，避免影响后续测试

  // ===== T-NW 新增武器线：火球 / 回旋镖，被动：暴击 / 移速 =====
  // T-NW1 两条线可作为初始武器，解锁与运行参数齐全
  reset();
  G.startRun('fireball');
  const pNW1 = G.state.player;
  assert(pNW1.skills.fireball === 1 && !!pNW1.sk.fireball && pNW1.sk.fireball.count >= 1,
    'T-NW1 火球开局解锁且运行参数就绪', { sk: pNW1.sk.fireball });
  G.startRun('boomerang');
  const pNW1b = G.state.player;
  assert(pNW1b.skills.boomerang === 1 && !!pNW1b.sk.boomerang && pNW1b.sk.boomerang.legs === 2,
    'T-NW1 回旋镖开局解锁且默认 2 段往返', { sk: pNW1b.sk.boomerang });

  // T-NW2 火球成长表：8 级维度映射 → 运行参数
  reset();
  const pNW2 = G.state.player;
  G.addWeapon(pNW2, 'fireball');
  const fbDim0 = pNW2.sk.fireball.count;
  for (let i = 0; i < 7; i++) G.upgradeWeapon(pNW2, 'fireball');
  assert(G.weaponLevel(pNW2, 'fireball') === 8, 'T-NW2 火球可升到 Lv8');
  assert(pNW2.sk.fireball.count > fbDim0 && pNW2.sk.fireball.r > 70 && pNW2.sk.fireball.cd < 3.6
      && pNW2.sk.fireball.mult >= 3.7,
    'T-NW2 火球 Lv8 维度映射（数量/半径/频率/高伤）',
    { count: pNW2.sk.fireball.count, r: pNW2.sk.fireball.r, cd: pNW2.sk.fireball.cd, mult: pNW2.sk.fireball.mult });
  assert(G.LINES.fireball.dims.find(d => d.key === 'dmg').eff(3).indexOf('370') >= 0,
    'T-NW2 火球满级单次 370% 攻击（低频高伤定位）');

  // T-NW3 火球发射并爆炸命中敌人
  reset();
  G.startRun('fireball');
  const pNW3 = G.state.player;
  const foeNW3 = G.makeEnemy(1, 0);
  G.state.foes.push(foeNW3);
  foeNW3.x = pNW3.x + 120; foeNW3.y = pNW3.y;
  const foeHp0 = foeNW3.hp;
  G.fireFireballs(pNW3);
  assert(G.state.fireballs.length >= 1, 'T-NW3 火球已发射', G.state.fireballs.length);
  for (let i = 0; i < 60; i++) G.updateFireballs(1 / 60);
  assert(foeNW3.dead || foeNW3.hp < foeHp0, 'T-NW3 火球爆炸对敌人造成伤害',
    { hp0: foeHp0, hp1: foeNW3.hp, dead: foeNW3.dead });

  // T-NW4a 回旋镖逐把依次发射（不一次性全扔）
  reset();
  G.startRun('boomerang');
  const pNW4a = G.state.player;
  // 造 3 把的构筑：满级 Lv8 维度 count=2 → 3 把
  for (let i = 0; i < 7; i++) G.upgradeWeapon(pNW4a, 'boomerang');
  const cnt4a = pNW4a.sk.boomerang.count;
  assert(cnt4a === 3, 'T-NW4a 回旋镖满级 3 把', cnt4a);
  G.state.boomerangs = [];
  pNW4a.sk.boomerang.t = 0.001;   // 让下一帧触发一轮
  G.update(1 / 60);
  assert(G.state.boomerangs.length === 1, 'T-NW4a 一轮开始只发第 1 把', G.state.boomerangs.length);
  for (let i = 0; i < 20; i++) G.update(1 / 60);   // 跨越 gap=0.22s
  assert(G.state.boomerangs.length === 2, 'T-NW4a 间隔后发第 2 把', G.state.boomerangs.length);
  for (let i = 0; i < 20; i++) G.update(1 / 60);
  assert(G.state.boomerangs.length === 3, 'T-NW4a 再间隔后发第 3 把', G.state.boomerangs.length);
  assert(G.state.boomerangs.length < 4, 'T-NW4a 不会一次性全扔');

  // T-NW4 回旋镖发射、往返与多段命中
  reset();
  G.startRun('boomerang');
  const pNW4 = G.state.player;
  const foeNW4 = G.makeEnemy(1, 0);
  G.state.foes.push(foeNW4);
  foeNW4.baseHp = 99999; foeNW4.maxHp = 99999; foeNW4.hp = 99999;  // 防止被打死，验证多段
  foeNW4.x = pNW4.x + 140; foeNW4.y = pNW4.y;
  const foeHp4 = foeNW4.hp;
  G.fireBoomerangs(pNW4);
  assert(G.state.boomerangs.length >= 1, 'T-NW4 回旋镖已发射', G.state.boomerangs.length);
  let sawReturn = false;
  for (let i = 0; i < 200; i++) {
    G.updateBoomerangs(1 / 60);
    if (G.state.boomerangs.some(b => b.phase === 1)) sawReturn = true;
    if (!G.state.boomerangs.length) break;
  }
  assert(sawReturn, 'T-NW4 回旋镖飞出后折返');
  assert(foeNW4.hp < foeHp4, 'T-NW4 回旋镖往返对敌人造成伤害', { hp0: foeHp4, hp1: foeNW4.hp });

  // T-NW4b 回旋镖必须完整飞回玩家手里才结束一段（不能半路换向）
  reset();
  G.startRun('boomerang');
  const pNW4b = G.state.player;
  G.state.boomerangs = [];
  G.state.foes = [];   // 无敌人，纯验证飞行轨迹
  pNW4b.sk.boomerang.t = 0.001;
  G.update(1 / 60);   // 发出第 1 把
  const bm4b = G.state.boomerangs[0];
  assert(bm4b, 'T-NW4b 回旋镖已发出');
  // 推进到返回段（phase=1）
  let guard4b = 0;
  while (bm4b.phase === 0 && guard4b++ < 400) G.updateBoomerangs(1 / 60);
  assert(bm4b.phase === 1, 'T-NW4b 进入返回段', { phase: bm4b.phase });
  // 返回途中：制造 traveled 已超过单程 dist 但距离玩家仍很远的情形
  bm4b.x = pNW4b.x + 200; bm4b.y = pNW4b.y;
  bm4b.traveled = bm4b.dist + 10;
  G.updateBoomerangs(1 / 60);
  assert(G.state.boomerangs.length === 1 && bm4b.phase === 1,
    'T-NW4b 距离玩家远时不会因 traveled 超程提前结束',
    { n: G.state.boomerangs.length, phase: bm4b.phase, d: Math.round(G.dist(bm4b.x, bm4b.y, pNW4b.x, pNW4b.y)) });
  // 继续推进直到真正接近玩家，此时才结束第一段
  guard4b = 0;
  while (G.state.boomerangs.length && bm4b.legIdx === 0 && guard4b++ < 400) G.updateBoomerangs(1 / 60);
  assert(bm4b.legIdx >= 1, 'T-NW4b 真正飞回手里后才进入下一段', { legIdx: bm4b.legIdx, phase: bm4b.phase });

  // T-NW5 进化配方：火球+暴击、回旋镖+移速
  const recipeNW = G.BUILD.EVOLVE_RECIPE;
  assert(recipeNW.fireball === 'crit' && recipeNW.boomerang === 'movespeed',
    'T-NW5 新武器配方绑定暴击/移速', recipeNW);
  reset();
  const pNW5 = G.state.player;
  pNW5.weapons.fireball = 8; pNW5.passives.crit = 5;
  G.rebuildFromBuild(pNW5);
  assert(G.checkEvolution(pNW5) === 'fireball' && pNW5.evolved.fireball === true,
    'T-NW5 火球满级+暴击满级→陨火焚天');
  const fiUlt = pNW5.sk.fireball;
  assert(fiUlt.pierce === 2 && fiUlt.r > 70, 'T-NW5 陨火焚天：穿透2+半径放大', fiUlt);

  // T-NW6 终极回旋镖：4 段往返、穿透 +3
  reset();
  const pNW6 = G.state.player;
  pNW6.weapons.boomerang = 8; pNW6.passives.movespeed = 5;
  G.rebuildFromBuild(pNW6);
  assert(G.checkEvolution(pNW6) === 'boomerang' && pNW6.evolved.boomerang === true,
    'T-NW6 回旋镖满级+移速满级→无尽回旋');
  const boUlt = pNW6.sk.boomerang;
  assert(boUlt.legs === 4 && boUlt.pierce === 9, 'T-NW6 无尽回旋：4 段+穿透+3', boUlt);

  // T-NW7 暴击被动：概率暴击造成双倍伤害（固定式暴击不重复掷骰）
  reset();
  const pNW7 = G.state.player;
  G.upgradePassive(pNW7, 'crit');
  assert(Math.abs(pNW7.pasCrit - 0.05) < 1e-9, 'T-NW7 暴击被动 Lv1 = 5%', pNW7.pasCrit);
  const targetNW7 = G.makeEnemy(1, 0);
  targetNW7.baseDef = 0; targetNW7.def = 0;
  targetNW7.baseHp = 9999; targetNW7.maxHp = 9999; targetNW7.hp = 9999;  // 避免伤害被血量截断
  const rand0 = Math.random;
  Math.random = () => 0;   // 必定触发概率暴击
  const dealtCrit = G.dealDamage(pNW7, targetNW7, 100, { noThorn: true, noSplash: true, tag: 'fireball' });
  Math.random = rand0;
  assert(dealtCrit >= 200, 'T-NW7 概率暴击造成双倍伤害', dealtCrit);

  // T-NW8 移速被动：映射到 pasMoveSpeed，速度乘区生效
  reset();
  const pNW8 = G.state.player;
  G.upgradePassive(pNW8, 'movespeed');
  G.upgradePassive(pNW8, 'movespeed');
  assert(Math.abs(pNW8.pasMoveSpeed - 0.16) < 1e-9, 'T-NW8 移速 Lv2 = +16%', pNW8.pasMoveSpeed);

  // T-NW9 开局选武器卡片自适应：数量与内容均由数据生成，新增武器无需改 UI
  reset();
  const metaMissing9 = G.LINE_KEYS.filter(k => {
    const L = G.LINES[k];
    return !L.color || !L.tagline || !Array.isArray(L.stats);
  });
  assert(metaMissing9.length === 0, 'T-NW9 每条武器线都带展示元数据', metaMissing9);
  G.ui.showStartSelect();
  assert(G.el.startCards.children.length === G.LINE_KEYS.length,
    'T-NW9 开局卡片数量随武器线数量自动变化',
    { cards: G.el.startCards.children.length, lines: G.LINE_KEYS.length });
  const card9 = G.el.startCards.children[0];
  assert(card9.innerHTML.indexOf('sc-evo') >= 0 && card9.innerHTML.indexOf('sc-stat') >= 0,
    'T-NW9 卡片含自动生成的进化路线与数值标签');
  G.el.startOverlay.classList.remove('show');
  reset();

  // T-SP1 角色素材模块已导出，映射覆盖全部敌人类型与玩家
  assert(typeof G.sprites === 'object' && typeof G.sprites.getSprite === 'function',
    'T-SP1 角色素材模块已加载');
  const spTypes = ['melee', 'brute', 'flyer', 'ranged', 'mage', 'boss', 'mimic', 'companion', 'crystal'];
  assert(G.sprites.NAMES.includes('player') && spTypes.every(t => G.sprites.NAMES.includes(t)),
    'T-SP1 素材覆盖玩家与全部敌人类型', G.sprites.NAMES);
  assert(G.sprites.NAMES.includes('elite'), 'T-SP1 精英专用骑士素材存在');
  // T-SP2 翻面方向：素材原图朝左，目标在右必须镜像(-1)，在左保持(1)
  assert(G.render.spriteFace(100, 200) === -1 && G.render.spriteFace(100, 50) === 1,
    'T-SP2 目标在右翻面朝右、在左保持朝左',
    { right: G.render.spriteFace(100, 200), left: G.render.spriteFace(100, 50) });
  assert(G.render.spriteFace(100, 100) === -1 && G.render.spriteFace(100) === 1,
    'T-SP2 同位置按朝右处理、无目标保持默认');

  console.log('\n功能测试结果: ' + pass + ' 通过, ' + fail + ' 失败');
  return fail;
}

/* ============================================================
   平衡模拟：人类化走位 bot，统计存活分钟分布
   ============================================================ */
function simulate(runs) {
  console.log('\n=== 平衡模拟（' + runs + ' 局，人类化 bot） ===');

  // 自动推进弹窗流程
  function autoAdvance() {
    const st = G.state;
    if (st.phase === 'levelup') {
      // 用真实卡池选卡（真人优先攻击/防御，经验卡次之）
      const cards = G.makeLevelCards(st.player);
      if (cards.length) {
        const pick = cards.find(c => c.key === 'atk') || cards.find(c => c.key === 'def') ||
                     cards.find(c => c.kind === 'attr') || cards[0];
        G.chooseLevelCard(pick);
      }
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
      if (overlay.classList.contains('show') && st.activeSite && st.activeSite.evt) {
        const opts = st.activeSite.evt.options;
        G.chooseEventOption(opts[opts.length - 1]);
      }
      return;
    }
    if (st.phase === 'eventpick') {
      const cards = G.pickBuildCards(st.player, 3);
      if (cards.length) G.chooseLevelCard(cards[0]);
    }
  }

  /** 人类化走位 bot：0.28s 反应延迟 + 4% 失误 */
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

    // 无近身威胁时优先去开宝箱（装备唯一来源）
    const chest = st.chests.find(c => !c.opened && G.dist(p.x, p.y, c.x, c.y) < 520);
    if (chest && nd > 300) {
      const cx = chest.x - p.x, cy = chest.y - p.y;
      if (Math.abs(cx) > 12) engineKeys.add(cx > 0 ? 'd' : 'a');
      if (Math.abs(cy) > 12) engineKeys.add(cy > 0 ? 's' : 'w');
      return;
    }

    // 闪避法师 AoE 预警圈（真人会本能躲圈）
    const dodge = (st.mageAoes || []).find(a => G.dist(p.x, p.y, a.x, a.y) < a.r + 42);
    if (dodge) {
      const ax = p.x - dodge.x, ay = p.y - dodge.y;
      if (Math.abs(ax) > 8) engineKeys.add(ax > 0 ? 'd' : 'a');
      if (Math.abs(ay) > 8) engineKeys.add(ay > 0 ? 's' : 'w');
      return;
    }

    // 闪避 BOSS 冲撞预警（垂直于冲撞方向侧移）
    const dasher = alive.find(f => f.bossDash && f.bossDash.tele > 0 && G.dist(p.x, p.y, f.x, f.y) < 500);
    if (dasher) {
      const n = dasher.bossDash.n;
      const side = { x: -n.y, y: n.x };
      if (Math.abs(side.x) > 8) engineKeys.add(side.x > 0 ? 'd' : 'a');
      if (Math.abs(side.y) > 8) engineKeys.add(side.y > 0 ? 's' : 'w');
      return;
    }

    // 附近无近战/宝箱怪威胁时，优先清理射手、法师与宝箱怪（真人会打站桩目标）
    const meleeThreat = alive.some(f => (f.type === 'melee' || f.type === 'mimic' || f.type === 'flyer' || f.type === 'brute') && G.dist(p.x, p.y, f.x, f.y) < 230);
    let hunted = null;
    if (!meleeThreat) {
      let hd = Infinity;
      for (const f of alive) {
        if (f.type !== 'ranged' && f.type !== 'boss' && f.type !== 'mage' && f.type !== 'mimic') continue;
        const d = G.dist(p.x, p.y, f.x, f.y);
        if (d < hd) { hd = d; hunted = f; }
      }
    }

    let dx, dy;
    if (hunted) {
      // 朝目标走到自己的射程边缘（射程 × 0.85）
      const want = p.range * 0.85;
      const hd2 = G.dist(p.x, p.y, hunted.x, hunted.y);
      if (hd2 > want) { dx = hunted.x - p.x; dy = hunted.y - p.y; }
      else { dx = (p.x - hunted.x) + (p.y - hunted.y); dy = (p.y - hunted.y) - (p.x - hunted.x); }   // 切向环绕
    } else {
      // 威胁向量逃离：多个近战合围时沿合力方向撤（而不是只躲最近一个）
      let fx = 0, fy = 0;
      for (const f of alive) {
        const d = G.dist(p.x, p.y, f.x, f.y);
        if (d > 290 || d < 1) continue;
        const w = (f.type === 'melee' || f.type === 'mimic') ? 1.2 : (f.type === 'ranged') ? 0.55 : 0;
        if (w > 0) { fx += (p.x - f.x) / d * w; fy += (p.y - f.y) / d * w; }
      }
      if (fx || fy) {
        dx = fx; dy = fy;
        // 无边界地图：不再有世界中心可依托，按最近搜索方向自然漫游
      } else if (Math.random() < 0.04) {
        dx = near.x - p.x; dy = near.y - p.y;
      } else {
        dx = 0; dy = 0;
      }
    }

    if (Math.abs(dx) > 8) engineKeys.add(dx > 0 ? 'd' : 'a');
    if (Math.abs(dy) > 8) engineKeys.add(dy > 0 ? 's' : 'w');
  }

  const minutesReached = [];
  const levelsReached = [];
  const mapsReached = [];
  const killsReached = [];
  const start = Date.now();

  const MAX_STEPS = 60 * 60 * 30;   // 单局上限 30 分钟游戏时间

  for (let r = 0; r < runs; r++) {
    reset();
    let guard = 0;
    while (G.state.phase !== 'over' && guard++ < MAX_STEPS) {
      botControl(STEP);
      if (G.state.phase === 'play') {
        G.update(STEP);
      } else {
        autoAdvance();
      }
    }
    const pD = G.state.player;
    const killer = G.state.foes.find(f => !f.dead);
    console.log('  局' + (r + 1) + ': 存活 ' + G.state.wave + ' 分 · 击杀者 ' + (killer ? killer.type : '?') +
      ' · task=' + (G.state.task ? G.state.task.kind : '无') + ' · baseHp=' + pD.baseHp +
      ' · maxHp=' + Math.round(pD.maxHp) + ' · rage=' + Math.round(G.state.enemyRageT || 0));
    minutesReached.push(G.state.wave);
    levelsReached.push(G.state.player.level);
    mapsReached.push(G.state.mapIdx + 1);
    killsReached.push(G.state.kills);
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
  const w = stats(minutesReached), l = stats(levelsReached), m = stats(mapsReached), k = stats(killsReached);

  console.log('  存活分钟 中位: ' + w.med + ' | p10: ' + w.p10 + ' | p90: ' + w.p90 + ' | 平均: ' + w.avg);
  console.log('  等级     中位: ' + l.med + ' | p10: ' + l.p10 + ' | p90: ' + l.p90 + ' | 平均: ' + l.avg);
  console.log('  击杀     中位: ' + k.med + ' | 平均: ' + k.avg);
  console.log('  地图     中位: ' + m.med + ' | 最多: ' + Math.max(...mapsReached));
  console.log('  存活分钟分布: ' + minutesReached.join(', '));
  console.log('  耗时: ' + ((Date.now() - start) / 1000).toFixed(1) + 's');
}

/* ---------- 入口 ---------- */
const simRuns = process.argv.includes('--sim') ? Number(process.argv[process.argv.indexOf('--sim') + 1] || 20) : 0;
const failures = featureTests();
if (simRuns > 0) simulate(simRuns);
process.exit(fail > 0 ? 1 : 0);
