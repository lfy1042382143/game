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
  function startRun() {
    state.wave = 1;
    state.phase = 'play';
    state.paused = false;
    state.time = 0;
    state.kills = 0;
    state.loots = [];
    state.lootSlots = [];
    state.pendingLevelUps = 0;
    state.pendingRage = false;
    state.trapFoeHpMul = 1;
    state.trapFoeAtkMul = 1;
    state.trapUntil = 0;
    state.floaters = [];
    state.bullets = [];
    state.chests = [];
    state.sites = [];
    state.siteT = 0;
    state.siteSeq = 0;
    state.activeSite = null;
    state.spawnT = 0;
    state.eliteT = 0;
    state.mapIdx = 0;
    state.obsT = 0;
    state.player = G.makePlayer();
    state.obstacles = [];
    state.foes = [];
    G.spawnObstaclesRandom(6);     // 初始障碍布局
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
    // 重新随机障碍布局
    state.obstacles = [];
    G.spawnObstaclesRandom(6);
    state.banner = {
      text: '🗺 ' + map.name,
      sub: '新地图解锁 · 敌人更强',
      t: 2.4
    };
    G.sfxUpgrade();
  }

  /* =========================================================
     动态障碍物：随玩家移动周期生成/移除
     ========================================================= */
  function updateObstacles(dt) {
    state.obsT += dt;
    if (state.obsT >= CFG.obstacles.spawnEvery) {
      state.obsT = 0;
      G.spawnObstacleNearPlayer();
      G.cullObstacles();
    }
  }

  /* =========================================================
     敌人生成：普通敌人按间隔刷 + 分钟整点精英
     ========================================================= */
  function updateSpawns(dt) {
    const minute = state.wave;
    const enemyIdx = state.kills;   // 词缀轮换用

    // 普通敌人：存活数低于上限时按间隔刷新（缺口大时一次补 2 只，快速填场）
    const alive = state.foes.filter(f => !f.dead).length;
    state.spawnT += dt;
    if (state.spawnT >= G.spawnInterval(minute)) {
      state.spawnT = 0;
      const deficit = G.aliveCap(minute) - alive;
      if (deficit > 0) {
        const batch = deficit >= 3 ? 2 : 1;
        for (let i = 0; i < batch && i < deficit; i++) {
          state.foes.push(G.makeEnemy(minute, enemyIdx + i));
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
        sub: e.name + ' · 击杀掉落装备宝箱',
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
    state.time += dt;
    tickMinute();

    G.updatePlayer(dt);
    if (state.player.dead) { gameOver(); return; }

    G.updateEnemies(dt);
    G.updateBullets(dt);
    G.tickBleeds(state.player, dt);
    updateObstacles(dt);
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

    // 升级弹窗：战斗中攒够经验立即处理
    if (state.pendingLevelUps > 0) {
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

  Object.assign(G, { startRun, switchMap, update, gameOver, updateObstacles, updateSpawns, tickMinute });
})(window.ABYSS = window.ABYSS || {});
