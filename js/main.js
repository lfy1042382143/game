/* ============================================================
   入口 · main.js
   初始化 DOM 引用、绑定按钮、启动引擎
   ============================================================ */
(function (G) {
  'use strict';

  function boot() {
    G.ui.initDom();
    G.render.init();

    // 按钮
    G.el.restartBtn.addEventListener('click', () => { G.startRun(); });
    G.el.againBtn.addEventListener('click', () => {
      G.el.overOverlay.classList.remove('show');
      G.startRun();
    });
    G.el.soundBtn.addEventListener('click', () => {
      const muted = G.toggleMute();
      G.el.soundBtn.textContent = muted ? '🔇' : '🔊';
    });

    // R 键快速重开
    G.onKeyDown = k => {
      if (k === 'r' && (G.state.phase === 'over' || G.state.phase === 'play')) {
        if (G.state.phase === 'over') G.el.overOverlay.classList.remove('show');
        G.startRun();
      }
    };

    // 首次交互后解锁音频（浏览器自动播放策略）
    const unlock = () => { G.tone({ freq: 1, dur: 0.01, vol: 0.001 }); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    G.startRun();
    G.engine.start(G.update, G.render.frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.ABYSS = window.ABYSS || {});
