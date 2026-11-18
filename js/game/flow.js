/* ============================================================
   游戏层 · flow.js
   实时流程状态机：
   play（实时战斗）→ 全灭 → busy（结算）→ upgrade（选卡+战利品）
   → event（场景事件）→ 下一波；玩家死亡 → over
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
    state.pendingElite = false;
    state.pendingRage = false;
    state.floaters = [];
    state.bullets = [];
    state.obstacles = G.makeObstacles();
    state.player = G.makePlayer();
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
    state.banner = {
      text: '第 ' + state.wave + ' 波',
      sub: boss ? '⚠ BOSS 来袭 · ' + state.foes[0].name : state.foes.map(f => f.name).join('、'),
      t: 1.6
    };
    if (boss) G.sfxBoss();

    G.ui.syncTopbar();
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

    // 胜利判定：敌人全灭
    if (state.foes.length && state.foes.every(f => f.dead)) {
      onVictory();
    }
  }

  /* =========================================================
     胜利 → 战利品 + 属性卡（弹窗期间游戏暂停）
     ========================================================= */
  function onVictory() {
    state.phase = 'busy';
    G.sfxWin();
    G.rollLoot();
    G.showUpgrade();
  }

  /** 选卡后进入下一波（cards.chooseUpgrade 调用） */
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

  Object.assign(G, { startRun, startWave, update, advanceWave, gameOver, onVictory });
})(window.ABYSS = window.ABYSS || {});
