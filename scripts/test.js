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
  'js/game/loot.js', 'js/game/cards.js', 'js/game/events.js', 'js/game/hazards.js', 'js/game/flow.js',
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
  assert(G.CFG.world.w === 2000 && G.CFG.world.h === 1400, 'T1 大世界尺寸 2000×1400');
  const alive0 = G.state.foes.length;
  run(10);
  assert(G.state.foes.length > alive0, 'T1 敌人源源不断刷新', { t0: alive0, t10s: G.state.foes.length });
  assert(G.state.foes.length <= G.aliveCap(1), 'T1 存活数不超过上限', { n: G.state.foes.length, cap: G.aliveCap(1) });

  // T2 WASD 移动 + 世界边界
  reset();
  const y0 = G.state.player.y;
  engineKeys.add('w');
  run(1);
  engineKeys.delete('w');
  assert(G.state.player.y < y0 - 80, 'T2 W 键向上移动', { y0, y1: G.state.player.y });
  engineKeys.add('d');
  run(3);
  engineKeys.delete('d');
  assert(G.state.player.x <= 2000 - 13, 'T2 世界边界约束生效', G.state.player.x);

  // T3 近战敌人追击（重装型：慢速但持续逼近）
  reset();
  const foe = G.makeEnemy(1, 0);
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
  G.gainXp(G.xpNeed(p15.level));       // 喂满一级经验
  assert(p15.level === lv0 + 1, 'T15 经验满自动升级', { lv0, lv1: p15.level });
  assert(p15.baseAtk === atk0 && p15.baseHp === hp0b, 'T15 升级不再自动成长三维', { atk0, atk1: p15.baseAtk });
  assert(G.state.pendingLevelUps === 1, 'T15 升级累积待处理选项', G.state.pendingLevelUps);

  // T16 攻击方式卡池（MODE_POOL）与新卡效果；属性卡池（ATTR_POOL）
  const modeByKey = k => G.MODE_POOL.find(c => c.key === k);
  assert(!modeByKey('homing'), 'T16 追踪箭已从卡池删除');
  const haste = modeByKey('haste'), multi = modeByKey('multi'), orbit = modeByKey('orbit'), rangeC = modeByKey('range');
  haste.apply(p15);
  multi.apply(p15);
  orbit.apply(p15);
  const rng0 = p15.range;
  rangeC.apply(p15);
  assert(Math.abs(G.effAtkCd(p15) - G.CFG.player.atkCd * 0.82) < 0.01, 'T16 攻速提升卡生效', G.effAtkCd(p15));
  assert(p15.shots === 2, 'T16 散射箭卡生效', p15.shots);
  assert(p15.orbits === 2, 'T16 环绕飞刃卡生效', p15.orbits);
  assert(p15.range > rng0, 'T16 射程提升卡生效', { rng0, rng1: p15.range });

  // T16b 新攻击方式卡：暴击节奏 / 弹速 / 吸血箭 / 减速箭 / 护盾生成
  const critC = modeByKey('crit'), veloC = modeByKey('velocity'), leechC = modeByKey('leech'), slowC = modeByKey('slow'), aegisC = modeByKey('aegis');
  critC.apply(p15);
  assert(p15.critEvery === 4 && p15.critMult === 2.2, 'T16b 暴击节奏卡生效', { every: p15.critEvery, mult: p15.critMult });
  veloC.apply(p15);
  assert(p15.bulletSpeedMul > 1, 'T16b 弹速提升卡生效', p15.bulletSpeedMul);
  leechC.apply(p15);
  assert(p15.cardLeech === 6, 'T16b 吸血箭卡生效', p15.cardLeech);
  slowC.apply(p15);
  assert(p15.cardSlow === 1, 'T16b 减速箭卡生效', p15.cardSlow);
  aegisC.apply(p15);
  assert(p15.shieldEvery === 8 && p15.shieldVal === 10, 'T16b 护盾生成卡生效', { every: p15.shieldEvery, val: p15.shieldVal });

  // 减速箭命中减速 + 吸血箭回血（先扣血避免满血钳制）
  reset();
  const p16 = G.state.player;
  p16.cardSlow = 1; p16.cardLeech = 20;
  p16.hp = Math.max(1, p16.hp - 30);
  const sf16 = G.makeEnemy(1, 0);
  G.state.foes.push(sf16);
  sf16.x = p16.x + 120; sf16.y = p16.y;
  const sf16hp0 = sf16.hp, p16hp0 = p16.hp;
  G.state.bullets.push({ x: p16.x, y: p16.y, vx: 250, vy: 0, r: 5, dmg: 10, crit: false, side: 'p', life: 2, owner: p16, pierceLeft: 0, hit: [] });
  run(0.5);
  assert(sf16.hp < sf16hp0, 'T16b 箭矢命中敌人', { sf16hp0, sf16hp1: sf16.hp });
  assert(sf16.slowT > 0 && sf16.slowMul < 1, 'T16b 减速箭命中后敌人减速', { slowT: sf16.slowT, slowMul: sf16.slowMul });
  assert(G.state.player.hp > p16hp0, 'T16b 吸血箭命中后回血', { p16hp0, p16hp1: G.state.player.hp });

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

  // T16c 卡池按等级分流：3 的倍数级出攻击方式卡，其余等级出属性/经验卡
  reset();
  const p16d = G.state.player;
  p16d.level = 3;
  const cards3 = G.makeLevelCards(p16d);
  assert(cards3.every(c => c.kind === 'mode'), 'T16c 3 级升级只出攻击方式卡', cards3.map(c => c.kind).join(','));
  p16d.level = 10;
  const cards10 = G.makeLevelCards(p16d);
  assert(cards10.every(c => c.kind === 'attr' || c.key === 'xpgain'), 'T16c 非 3 倍数级（10 级）出属性/经验卡', cards10.map(c => c.key || c.kind).join(','));

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
  assert(G.state.obstacles.length > obs0, 'T18 障碍物随玩家移动生成', { obs0, obs1: G.state.obstacles.length });
  assert(G.state.obstacles.length <= G.CFG.obstacles.cap, 'T18 障碍物数量有上限', G.state.obstacles.length);
  // 移走后应被清除
  G.state.player.x = 100; G.state.player.y = 1300;
  G.cullObstacles();
  const farAll = G.state.obstacles.every(o => G.dist(100, 1300, o.x + o.w / 2, o.y + o.h / 2) <= G.CFG.obstacles.cullDist);
  assert(farAll, 'T18 远处障碍物被移除');

  // T19 敌人随机出现在玩家附近
  reset();
  const f19 = G.makeEnemy(1, 0);
  const d19 = G.dist(f19.x, f19.y, G.state.player.x, G.state.player.y);
  assert(d19 >= 300 && d19 <= 750, 'T19 敌人刷新在玩家周围环带', Math.round(d19));

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

  // T7 宝箱：走近开启 → 装备战利品 → 继续战斗
  reset();
  G.state.chests.push({ x: G.state.player.x, y: G.state.player.y, opened: false, rarBonus: 0, t: 0 });
  run(0.4);
  assert(G.state.phase === 'loot', 'T7 走近宝箱自动开启进入战利品', G.state.phase);
  assert(G.state.loots.length >= 1, 'T7 宝箱开出装备', G.state.loots.length);
  let g7 = 0;
  while (G.lootPending() > 0 && g7++ < 5) G.takeLoot(G.state.loots.findIndex(e => !e.done));
  assert(G.state.player.items.length >= 1, 'T7 宝箱装备到玩家');
  G.continueLoot();
  assert(G.state.phase === 'play', 'T7 处理完战利品回战斗', G.state.phase);

  // T9 事件地点：走近触发 → 选择 → 地点消失（临时关闭陷阱保证确定性）
  reset();
  const trapChanceBak = G.CFG.events.trapChance;
  G.CFG.events.trapChance = 0;
  const site = { x: G.state.player.x, y: G.state.player.y, evt: G.EVENTS[0], used: false };
  G.state.sites.push(site);
  run(0.3);
  assert(G.state.phase === 'event', 'T9 走近事件地点触发弹窗', G.state.phase);
  G.chooseEventOption(G.EVENTS[0].options[2]);   // 离开
  assert(G.state.phase === 'play', 'T9 事件选择后回到战斗', G.state.phase);
  assert(site.used === true, 'T9 事件地点一次性（触发后消失）');
  G.CFG.events.trapChance = trapChanceBak;

  // T-Trap 陷阱：概率触发 → 弹陷阱弹窗 → 承受后生效（敌人倍率与持续时间）
  reset();
  G.CFG.events.trapChance = 1;
  G.state.sites.push({ x: G.state.player.x, y: G.state.player.y, evt: G.EVENTS[0], used: false });
  run(0.3);
  assert(G.state.phase === 'event', 'T-Trap 事件选择后弹出陷阱', G.state.phase);
  G.resolveTrap(G.TRAPS[0]);                      // 血肉盛宴：敌人生命 ×2
  assert(G.state.phase === 'play', 'T-Trap 承受陷阱后回到战斗', G.state.phase);
  assert(G.state.trapFoeHpMul === G.CFG.traps.foeHpMul, 'T-Trap 陷阱敌人生命倍率生效', G.state.trapFoeHpMul);
  assert(G.state.trapUntil > G.state.time, 'T-Trap 陷阱有持续时间', Math.round(G.state.trapUntil - G.state.time));
  // 陷阱期间刷新的敌人生命翻倍
  const trapE = G.makeEnemy(1, 0);
  G.state.trapUntil = 0;                          // 关闭陷阱后生成的敌人不受影响
  const normE2 = G.makeEnemy(1, 0);
  assert(trapE.hp > normE2.hp * 1.5, 'T-Trap 陷阱期间敌人生命翻倍', { trap: trapE.hp, norm: normE2.hp });
  assert(Math.abs(normE2.hp - G.curveHp(1)) < 2, 'T-Trap 陷阱结束后敌人恢复正常', { normE2: normE2.hp, base: G.curveHp(1) });
  // 伏击陷阱：立即召唤敌人
  reset();
  const ambushN0 = G.state.foes.filter(f => !f.dead).length;
  G.TRAPS[2].apply();
  assert(G.state.foes.filter(f => !f.dead).length >= ambushN0 + G.CFG.traps.ambushCount, 'T-Trap 伏击陷阱立即召唤敌人', G.state.foes.length);
  G.CFG.events.trapChance = trapChanceBak;

  // T9a 经验需求十级一档：档内恒定，跨档跳增
  const n1 = G.xpNeed(1), n2 = G.xpNeed(2), n10 = G.xpNeed(10), n11 = G.xpNeed(11), n20 = G.xpNeed(20), n21 = G.xpNeed(21);
  assert(n1 === n2 && n2 === n10, 'T9a 1-10 级同挡（每级恒定）', { n1, n2, n10 });
  assert(n11 === G.xpNeed(20) && n11 > n10, 'T9a 11-20 级新挡且高于上一档', { n10, n11, n20 });
  assert(n21 > n11, 'T9a 21 级起再进下一挡', { n11, n21 });
  assert(n1 === 40, 'T9a 首挡每级 40 经验', n1);

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
  assert(elite1.elite === true && elite1.hp > e1hp * 1.5, 'T10 精英强度显著高于普通怪', { elite: elite1.hp, normal: e1hp });
  assert(elite1.xp >= 25, 'T10 精英提供大量经验', elite1.xp);

  // T25 精英/BOSS 经验差距：BOSS 经验应显著高于精英（≥2.5 倍）
  const eliteXp = elite1.xp;
  const bossXpU = G.makeElite(5);
  assert(bossXpU.xp > eliteXp * 2.5, 'T25 BOSS 经验显著高于精英（≥2.5 倍）', { boss: bossXpU.xp, elite: eliteXp });
  const elite5 = G.makeElite(4);
  assert(elite5.xp < bossXpU.xp * 0.6, 'T25 同期 BOSS 经验远高于精英', { elite5: elite5.xp, boss: bossXpU.xp });

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

  // T21c 环绕飞刃：第二张卡后单枚伤害降低
  reset();
  const p21c = G.state.player;
  p21c.orbits = 2; p21c.orbitDmgMul = 0.6; p21c.atk = 10;
  const mul1 = p21c.orbitDmgMul;
  const orbitCard = G.MODE_POOL.find(c => c.key === 'orbit');
  orbitCard.apply(p21c);
  assert(p21c.orbits === 4, 'T21c 飞刃 +2');
  assert(p21c.orbitDmgMul < mul1, 'T21c 飞刃伤害系数递减', { mul1, mul2: p21c.orbitDmgMul });

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
  const mageF = G.makeEnemy(1, 8);    // mage
  assert(meleeF.type === 'melee' && rangedF.type === 'ranged' && mageF.type === 'mage',
    'T22a 类型分布正确', { m: meleeF.type, r: rangedF.type, g: mageF.type });
  assert(meleeF.atk > rangedF.atk, 'T22a 近战攻击高于远程', { melee: meleeF.atk, ranged: rangedF.atk });
  const meleeF6 = G.makeEnemy(6, 0), rangedF6 = G.makeEnemy(6, 6);
  assert(meleeF6.def > rangedF6.def, 'T22a 近战防御高于远程', { melee: meleeF6.def, ranged: rangedF6.def });
  assert(mageF.speed === 0, 'T22a 法师完全不能移动', mageF.speed);
  assert(G.CFG.ranged.speed > G.CFG.melee.speed, 'T22a 远程移速快于近战');

  // T22b 法师 AoE：预警后爆发，只对玩家生效（不伤敌人）
  reset();
  const mg = G.makeEnemy(1, 8);
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

  // T23 升级效率卡：每 2 级出现，经验获取可叠加放大
  reset();
  const pXp = G.state.player;
  pXp.level = 2;
  assert(G.makeLevelCards(pXp).some(c => c.key === 'xpgain'), 'T23a 偶数级卡池含升级效率选项');
  pXp.level = 3;
  assert(!G.makeLevelCards(pXp).some(c => c.key === 'xpgain'), 'T23a 奇数级不出升级效率');
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
  // T15a2 掩体数量下调
  assert(G.state.obstacles.length <= 4 && G.CFG.obstacles.cap === 8,
    'T15a2 掩体数量下调（初始 ≤4 / 上限 8）', { n: G.state.obstacles.length, cap: G.CFG.obstacles.cap });

  // T15b 熔岩裂隙：火球预警 → 爆发伤害
  reset();
  G.switchMap(2);
  assert(G.hazardKind() === 'fire', 'T15b 熔岩裂隙陷阱种类为 fire');
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
  G.state.zones = [{ kind: 'vortex', x: 400, y: 400, r: 200 }];
  const vf = G.makeEnemy(1, 0);
  vf.type = 'melee';
  vf.speed = 0;          // 静止敌人：排除追击 AI 干扰，只验证引力
  vf.x = 480; vf.y = 400;
  G.state.foes = [vf];
  const dv0 = G.dist(vf.x, vf.y, 400, 400);
  run(0.5);
  const dv1 = G.dist(vf.x, vf.y, 400, 400);
  assert(dv1 < dv0 - 20, 'T15d 裂隙把敌人拉向中心', { d0: dv0.toFixed(1), d1: dv1.toFixed(1) });
  // 玩家同样被拉拽
  const pvx = G.state.player;
  G.state.foes = [];
  pvx.x = 480; pvx.y = 400;
  const dp0 = G.dist(pvx.x, pvx.y, 400, 400);
  run(0.5);
  const dp1 = G.dist(pvx.x, pvx.y, 400, 400);
  assert(dp1 < dp0 - 20, 'T15d 裂隙把玩家拉向中心', { d0: dp0.toFixed(1), d1: dp1.toFixed(1) });

  // T15e 荒芜骨林：骨刺周期生成
  reset();
  G.switchMap(1);
  assert(G.hazardKind() === 'spikes', 'T15e 荒芜骨林陷阱种类为 spikes');
  G.state.hazT = G.CFG.hazards.spikes.every - 0.01;
  run(0.2);
  assert(G.state.hazards.length > 0, 'T15e 骨刺预警圈按周期出现', G.state.hazards.length);

  // T16 属性削弱 + 升级节奏
  const M16 = G.ATTR_META;
  assert(M16.hp.vals[4] === 108 && M16.atk.vals[4] === 25 && M16.def.vals[4] === 10,
    'T16a 属性卡数值已削弱', { hp: M16.hp.vals[4], atk: M16.atk.vals[4], def: M16.def.vals[4] });
  assert(G.CFG.levelup.modeEvery === 3, 'T16a 攻击方式升级改为每 3 级');
  reset();
  G.state.player.level = 3;
  const m5 = G.makeLevelCards(G.state.player).map(c => c.kind);
  G.state.player.level = 4;
  const a4 = G.makeLevelCards(G.state.player);
  assert(m5.length && m5.every(k => k === 'mode'), 'T16b 第 3 级出攻击方式卡', m5);
  assert(a4.length && a4.every(c => c.kind === 'attr' || c.key === 'xpgain'), 'T16b 第 4 级仍为属性卡（经验卡除外）', a4.map(c => c.key || c.kind));
  G.state.player.level = 1;

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
    assert(G.state.chests.length > chestsBefore && mc.mimic === false && mc.rarBonus === 1,
      'T18b 击杀宝箱怪掉落真宝箱（稀有度+1）', G.state.chests.length);
  }
  // 普通宝箱不受影响
  reset();
  G.state.chests = [];
  G.state.chests.push({ x: G.state.player.x + 10, y: G.state.player.y, opened: false, rarBonus: 0, t: 0, mimic: false });
  run(0.3);
  assert(G.state.phase === 'loot', 'T18c 普通宝箱仍正常弹出战利品');

  // T19 实时装备侧边栏
  reset();
  G.ui.syncTopbar();
  const side = sandbox.document._els.eqSide;
  assert(side && side.innerHTML.indexOf('装备 · 属性') >= 0, 'T19a 侧边栏已渲染装备与属性');
  assert(side.innerHTML.indexOf('空置') >= 0, 'T19b 空槽位显示「空置」');

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

  // T20c 装备稀有度按分钟封顶
  reset();
  G.state.wave = 1;
  const rars1 = [];
  for (let i = 0; i < 40; i++) rars1.push(G.rollChestItem(1).rarity);   // 含精英加成同样封顶
  G.state.wave = 12;
  const rars12 = [];
  for (let i = 0; i < 40; i++) rars12.push(G.rollChestItem(1).rarity);
  G.state.wave = 1;
  assert(rars1.every(r => r === 0), 'T20c 第 1 分钟只能出普通装备', rars1.join(''));
  assert(Math.max(...rars12) === 4, 'T20c 第 12 分钟才可能出传说', Math.max(...rars12));

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
  assert(fanned[1].bullets >= G.CFG.boss.ringCount - 2, 'T24b BOSS 第 2 技能：全向环射', fanned[1]);
  assert(fanned[2].dashing, 'T24b BOSS 第 3 技能：进入冲撞预警', fanned[2]);
  assert(fanned[3].foes >= G.CFG.boss.summonCount, 'T24b BOSS 第 4 技能：召唤援军', fanned[3]);

  // T24c 固定陷阱：同一地图布局确定（zones 与锚点可复现）
  reset();
  G.state.mapIdx = 4;                    // 沼泽（zones）
  G.setupHazards();
  const swampZones1 = JSON.stringify(G.state.zones.map(z => [Math.round(z.x), Math.round(z.y), Math.round(z.r)]));
  G.setupHazards();
  const swampZones2 = JSON.stringify(G.state.zones.map(z => [Math.round(z.x), Math.round(z.y), Math.round(z.r)]));
  assert(swampZones1 === swampZones2 && G.state.zones.length > 0, 'T24c 泥潭位置每次进入完全一致');
  G.state.mapIdx = 2;                    // 熔岩（锚点）
  G.setupHazards();
  const anchors1 = JSON.stringify(G.state.hazAnchors.map(a => [Math.round(a.x), Math.round(a.y)]));
  G.setupHazards();
  const anchors2 = JSON.stringify(G.state.hazAnchors.map(a => [Math.round(a.x), Math.round(a.y)]));
  assert(anchors1 === anchors2 && G.state.hazAnchors.length === G.CFG.hazards.fire.anchors, 'T24c 火球落点锚点固定');
  // 爆发按锚点顺序轮换
  const firstBurst = [];
  G.spawnBurst('fire', 1); G.spawnBurst('fire', 1);
  firstBurst.push([G.state.hazards[0].x, G.state.hazards[0].y]);
  firstBurst.push([G.state.hazards[1].x, G.state.hazards[1].y]);
  const m1 = G.state.hazAnchors[0], m2 = G.state.hazAnchors[1];
  assert(firstBurst[0][0] === m1.x && firstBurst[1][0] === m2.x, 'T24c 爆发落点严格按锚点顺序');

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
      if (overlay.classList.contains('show')) {
        if (st.activeSite && st.activeSite.evt) {
          const opts = st.activeSite.evt.options;
          G.chooseEventOption(opts[opts.length - 1]);
        } else {
          G.resolveTrap(G.TRAPS[0]);   // 陷阱弹窗：直接承受
        }
      }
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
    const meleeThreat = alive.some(f => (f.type === 'melee' || f.type === 'mimic') && G.dist(p.x, p.y, f.x, f.y) < 230);
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
        dx += (p.x > G.CFG.world.w / 2 ? 1 : -1) * 50;   // 贴边时沿切向绕开
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
