/* ============================================================
   入口层 · main.js
   事件绑定与启动。必须是最后一个加载的脚本，
   此时 G 上所有能力都已就位。
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG, state, el, tone, toggleMute, isMuted,
          buildTrack, startWave, doRound, resetGame } = G;

  /* ---------- 战斗操作 ---------- */
  el.attackBtn.addEventListener('click', () => doRound('attack'));
  el.defendBtn.addEventListener('click', () => doRound('defend'));

  /* ---------- 重开 ---------- */
  el.againBtn.addEventListener('click', resetGame);
  el.restartBtn.addEventListener('click', () => {
    if (state.phase === 'busy') return;
    resetGame();
  });

  /* ---------- 音效开关 ---------- */
  el.soundBtn.textContent = isMuted() ? '🔇' : '🔊';
  el.soundBtn.addEventListener('click', () => {
    const muted = toggleMute();
    el.soundBtn.textContent = muted ? '🔇' : '🔊';
    if (!muted) tone({ freq: 660, type: 'sine', dur: 0.1, vol: 0.08 });
  });

  /* ---------- 键盘 ---------- */
  document.addEventListener('keydown', e => {
    if (e.repeat) return;
    // 详情面板打开时，除 Esc（面板自己处理）外一律不响应
    if (state.paused) return;

    if (e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      doRound('attack');
    } else if (e.key === 'd' || e.key === 'D' || e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      doRound('defend');
    } else if (e.key === 'r' || e.key === 'R') {
      if (state.phase !== 'busy') resetGame();
    }
  });

  /* ---------- 启动 ---------- */
  if (state.best > 0) el.recordNum.textContent = state.best;
  buildTrack();
  state.player = G.makeUnit(CFG.player);
  startWave();

})(window.ABYSS = window.ABYSS || {});
