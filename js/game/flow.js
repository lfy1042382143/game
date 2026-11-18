/* ============================================================
   游戏层 · flow.js
   实时流程状态机（经验升级版）：
   - 战斗中击杀获得经验，满级自动升级 → 弹三选一（暂停），连升依次处理
   - 全灭 → 结算战利品弹窗 → 事件 → 下一波
   - 等级里程碑 → 解锁新地图（换主题 + 重新随机障碍布局）
   - 动态障碍物随玩家移动周期性生成/移除
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG } = G;

  /* =========================================================
     开局 / 开波
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
    state.pendingElite = false;
    state.pendingRage = false;
    state.floaters = [];
    state.bullets = [];
    state.mapIdx = 0;
    state.obsT = 0;
    state.player = G.makePlayer();
    state.obstacles = [];
    G.spawnObstaclesRandom(6);     // 初始障碍布局
    startWave();
  }

  function startWave() {
    state.foes = G.composeWave(state.wave);
    state.bullets = [];
    state.phase = 'play';

    // 每波开始：玩家获得壁垒甲开局护盾
    state.player.shield = G.startShield(state.player);

    // 事件副作用已生效，清除标记
    state.pendingElite = false;
    state.pendingRage = false;

    const boss = G.isBossWave(state.wave);
    const mapName = G.MAPS[state.mapIdx].name;
    state.banner = {
      text: '第 ' + state.wave + ' 波',
      sub: (boss ? '⚠ BOSS 来袭 · ' + state.foes[0].name : state.foes.map(f => f.name).join('、')) +
        ' · ' + mapName,
      t: 1.6
    };
    if (boss) G.sfxBoss();

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
      t: 2.2
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
     实时主更新（由引擎以固定步长调用）
     ========================================================= */
  function update(dt) {
    state.time += dt;

    G.updatePlayer(dt);
    if (state.player.dead) { gameOver(); return; }

    G.updateEnemies(dt);
    G.updateBullets(dt);
    G.tickBleeds(state.player, dt);
    updateObstacles(dt);

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

    // 开波横幅计时
    if (state.banner) {
      state.banner.t -= dt;
      if (state.banner.t <= 0) state.banner = null;
    }

    // 胜利判定：敌人全灭（优先于升级弹窗，保证战利品数据就绪）
    if (state.foes.length && state.foes.every(f => f.dead)) {
      onVictory();
      return;
    }

    // 升级弹窗：战斗中攒够经验立即处理
    if (state.pendingLevelUps > 0) {
      G.showLevelUp();
    }
  }

  /* =========================================================
     胜利 → 升级选项（若有）→ 战利品
     ========================================================= */
  function onVictory() {
    state.phase = 'busy';
    G.sfxWin();
    G.rollLoot();

    if (state.pendingLevelUps > 0) {
      G.showLevelUp();          // 升级处理完后由 chooseLevelCard 转 showLoot
    } else {
      G.showLoot();
    }
  }

  /** 战利品处理完 → 下一波（loot.continueLoot 调用） */
  function advanceWave() {
    state.wave += 1;
    if (state.wave > state.best) {
      state.best = state.wave;
      G.saveBest();
    }
    if (G.triggerEvent && G.triggerEvent()) return;   // 事件选择后由 chooseEventOption 推进
    startWave();
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

  Object.assign(G, { startRun, startWave, switchMap, update, advanceWave, gameOver, onVictory, updateObstacles });
})(window.ABYSS = window.ABYSS || {});
