/* ============================================================
   游戏层 · flow.js（时间驱动版）
   - 敌人按时间间隔源源不断刷新（存活上限随分钟增长）
   - 每分钟整点出现一只精英怪（每 5 分钟为 BOSS），击杀原地掉宝箱
   - 强度按分钟阶段缩放；等级里程碑 → 解锁新地图
   - 动态障碍物随玩家移动周期性生成/移除
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG } = G;

  /* =========================================================
     开局
     ========================================================= */
  function startRun(startLine) {
    state.wave = 1;
    state.phase = 'play';
    state.paused = false;
    state.time = 0;
    state.kills = 0;
    state.loots = [];
    state.lootSlots = [];
    state.pendingLevelUps = 0;
    state.pendingChestUps = 0;    // 宝箱强化（免费升级选项）待处理数
    state.eventFoeAtkMul = 1;
    state.eventFoeUntil = 0;
    state.eventPick = false;
    state.floaters = [];
    state.bullets = [];
    state.chests = [];
    state.sites = [];
    state.siteT = 0;
    state.lastEventKey = null;
    state.activeSite = null;
    state.spawnT = 0;
    state.eliteT = 0;
    state.mageAoes = [];
    state.skillFx = [];
    state.mines = [];
    state.fireballs = [];
    state.boomerangs = [];
    state.dmgStats = { arrow: 0, chain: 0, shock: 0, orbit: 0, drone: 0, mine: 0, fireball: 0, boomerang: 0 };  // 输出统计
    state.task = null;            // 活动任务
    state.taskT = 100;            // 首个任务出现倒计时（秒）
    state.companion = null;       // 护送任务奖励：同伴
    state.spawnRateMul = 1;       // 刷怪速度乘算（怪潮任务）
    state.enemyRageT = 0;         // 敌人增伤剩余时间（水晶任务失败惩罚）
    state.mapIdx = 0;
    state.obsT = 0;
    state.player = G.makePlayer(startLine);
    state.obstacles = [];
    state.foes = [];
    G.spawnObstaclesRandom(Math.round(4 * (G.obDensity ? G.obDensity() : 1)));     // 初始障碍布局（火山更密）
    G.setupHazards();              // 初始地图无陷阱（布置空陷阱）
    G.spawnChest();                // 开局引导宝箱
    G.spawnSite();                 // 开局一个事件地点
    state.player.shield = G.startShield(state.player);

    state.banner = {
      text: '生存',
      sub: '敌人会源源不断涌来 · 每分钟出现一只精英 · ' + G.MAPS[state.mapIdx].name,
      t: 2.4
    };

    G.ui.syncTopbar();
  }

  /* =========================================================
     地图切换：等级里程碑解锁
     ========================================================= */
  function switchMap(idx) {
    state.mapIdx = idx;
    const map = G.MAPS[idx];
    // 重新随机障碍布局（按地图密度，火山更密）
    state.obstacles = [];
    G.spawnObstaclesRandom(Math.round(5 * (G.obDensity ? G.obDensity() : 1)));
    // 布置该地图的特色陷阱
    G.setupHazards();
    const hz = map.hazard && G.HAZ_INFO[map.hazard];
    state.banner = {
      text: '🗺 ' + map.name,
      sub: hz ? hz.icon + ' 地图陷阱：' + hz.name + ' · ' + hz.desc : '安全的初始地带 · 敌人更强',
      t: 2.8
    };
    G.sfxUpgrade();
  }

  /* =========================================================
     动态障碍物：随玩家移动周期生成/移除
     ========================================================= */
  function updateObstacles(dt) {
    const C = CFG.obstacles;
    const p = state.player;
    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      // 冰柱击碎后移除
      if (o.obType === 'ice' && o.hp <= 0) { state.obstacles.splice(i, 1); continue; }
      if (!p) continue;
      const d = G.dist(p.x, p.y, o.x, o.y);
      // 熔岩块：靠近累计时间后持续灼烧玩家（累积到整数才结算，避免每帧 round 成 1）
      if (o.obType === 'lava') {
        if (d < o.r + p.r + 18) {
          o.touchT = (o.touchT || 0) + dt;
          if (o.touchT >= C.lavaWarn) {
            o.burnAcc = (o.burnAcc || 0) + C.lavaDps * dt;
            if (o.burnAcc >= 1) {
              const n = Math.floor(o.burnAcc);
              o.burnAcc -= n;
              G.dealDamage(null, p, n, { flat: true, noThorn: true });
            }
          }
        } else {
          o.touchT = Math.max(0, (o.touchT || 0) - dt * 0.5);
          o.burnAcc = 0;
        }
      }
      // 骨堆：定期在附近召唤骷髅
      if (o.obType === 'bone') {
        o.spawnT = (o.spawnT || 0) + dt;
        if (o.spawnT >= C.boneSpawnCd && d < CFG.terrain.activeRadius) {
          o.spawnT = 0;
          if (G.spawnSkeleton) G.spawnSkeleton(o.x, o.y, C.boneSpawnRange);
        }
      }
    }
    state.obsT += dt;
    const obEvery = C.spawnEvery / (G.obDensity ? G.obDensity() : 1);
    if (state.obsT >= obEvery) {
      state.obsT = 0;
      G.spawnObstacleNearPlayer();
      G.cullObstacles();
    }
  }

  /** 无边界地图：远离玩家的普通敌人回收（不给经验/掉落），防止旧怪堆积占名额 */
  function cullDistantFoes() {
    const p = state.player;
    if (!p) return;
    const D = CFG.terrain.cullFoeDist;
    const d2 = D * D;
    for (const f of state.foes) {
      if (f.dead || f.elite || f.type === 'boss') continue;
      if ((f.x - p.x) * (f.x - p.x) + (f.y - p.y) * (f.y - p.y) > d2) {
        f.dead = true;   // 静默移除（不计击杀、不掉宝箱）
      }
    }
  }

  /* =========================================================
     敌人生成：普通敌人按间隔刷 + 分钟整点精英
     ========================================================= */
  function updateSpawns(dt) {
    const minute = state.wave;
    const enemyIdx = state.kills;   // 词缀轮换用

    // 普通敌人：对标 VS 成群波次——按当前阶段的批量一次刷一小群，从四周方向涌来。
    // 刷新不再看玩家杀没杀掉：只受绝对上限 hardCap 限制，杀不动就不断堆积。
    // 法师是站桩炮台，不计入存活上限，但有独立 mageCap 防止无限堆积
    const alive = state.foes.filter(f => !f.dead && f.type !== 'mage').length;
    const aliveMages = state.foes.filter(f => !f.dead && f.type === 'mage').length;
    // 超过软上限（没能及时清怪）时仍持续刷怪，但间隔放慢 ~1.8 倍 → 缓慢堆积形成压力
    const soft = G.aliveCap(minute);
    const spawnGap = G.spawnInterval(minute) * (alive >= soft ? 1.8 : 1);
    state.spawnT += dt;
    if (state.spawnT >= spawnGap) {
      state.spawnT = 0;
      const cap = G.hardCap ? G.hardCap() : soft;
      const room = cap - alive;
      if (room > 0) {
        const [bMin, bMax] = G.spawnBatch(minute);
        let wanted = bMin + Math.floor(Math.random() * (bMax - bMin + 1));
        // 已超软上限：每次只补 1 只
        if (alive >= soft) wanted = 1;
        const batch = Math.min(wanted, room);
        const baseAngle = Math.random() * Math.PI * 2;   // 本波的基准方向
        for (let i = 0; i < batch; i++) {
          const idx = enemyIdx + i;
          const roll = idx % 10;
          const wouldBeMage = roll >= 9;   // 法师仅 idx9 档（轰炸者已删除）
          const forceType = wouldBeMage && aliveMages >= CFG.spawn.mageCap ? 'melee' : undefined;
          // 群内每只错开方向，整体分布在玩家四周约 240° 弧段
          const angle = baseAngle + (i / Math.max(1, batch)) * Math.PI * 1.6;
          state.foes.push(G.makeEnemy(minute, idx, forceType, angle));
        }
      }
    }

    // 精英怪：每分钟整点一只
    state.eliteT += dt;
    if (state.eliteT >= CFG.elite.every) {
      state.eliteT -= CFG.elite.every;
      const boss = G.isBossMinute(minute);
      const e = G.makeElite(minute);
      state.foes.push(e);
      state.banner = {
        text: boss ? '⚠ 首领来袭' : '⚠ 精英来袭',
        sub: e.name + ' · 击杀掉落强化宝箱',
        t: 2
      };
      G.sfxBoss();
    }
  }

  /** 分钟推进（state.time 跨过 60s 边界） */
  function tickMinute() {
    const m = Math.floor(state.time / 60) + 1;
    if (m > state.wave) {
      state.wave = m;
      if (m > state.best) {
        state.best = m;
        G.saveBest();
      }
      state.banner = {
        text: '第 ' + m + ' 分钟',
        sub: G.isBossMinute(m) ? '⚠ 首领即将出现' : '敌人越来越强了',
        t: 1.6
      };
      G.ui.syncTopbar();
    }
  }

  /* =========================================================
     实时主更新（由引擎以固定步长调用）
     ========================================================= */
  function update(dt) {
    // 唯一权威暂停守卫：非 play 阶段（升级/战利品/事件/结算）不推进任何游戏逻辑。
    // 引擎外层虽有同样判断，但测试 harness / 事件回调会直接调 update()，必须在此兜底。
    if (state.phase !== 'play') return;
    state.time += dt;
    tickMinute();

    G.updatePlayer(dt);
    if (state.player.dead) { gameOver(); return; }

    G.updateEnemies(dt);
    G.updateSkills(dt);
    if (G.updateTasks) G.updateTasks(dt);
    cullDistantFoes();
    G.updateBullets(dt);
    G.tickBleeds(state.player, dt);
    updateObstacles(dt);
    G.updateHazards(dt);
    updateSpawns(dt);
    G.updateSites(dt);

    // 清理尸体（精英尸体由掉落逻辑在死亡时处理）
    if (state.foes.some(f => f.dead)) {
      state.foes = state.foes.filter(f => !f.dead);
    }

    // 宝箱拾取与事件地点触发（都在 play 阶段内判定）
    G.checkChests();
    if (state.phase === 'play') G.checkSites();

    // 飘字
    for (let i = state.floaters.length - 1; i >= 0; i--) {
      const f = state.floaters[i];
      f.t -= dt;
      f.y -= 34 * dt;
      if (f.t <= 0) state.floaters.splice(i, 1);
    }

    // 受击闪白衰减
    const decay = u => { if (u.flashT > 0) u.flashT -= dt; };
    decay(state.player);
    state.foes.forEach(decay);

    // 横幅计时
    if (state.banner) {
      state.banner.t -= dt;
      if (state.banner.t <= 0) state.banner = null;
    }

    // 升级弹窗：战斗中攒够经验立即处理（宝箱免费强化同样入队后统一弹出）
    if (state.pendingLevelUps > 0 || (state.pendingChestUps || 0) > 0) {
      G.showLevelUp();
    }
  }

  /* =========================================================
     失败
     ========================================================= */
  function gameOver() {
    if (state.phase === 'over') return;
    state.phase = 'over';
    G.sfxLose();
    G.ui.showGameOver();
  }

  Object.assign(G, { startRun, switchMap, update, gameOver, updateObstacles, updateSpawns, cullDistantFoes, tickMinute });
})(window.ABYSS = window.ABYSS || {});
