/* ============================================================
   入口 · main.js
   初始化 DOM 引用、绑定按钮、启动引擎
   ============================================================ */
(function (G) {
  'use strict';

  function boot() {
    G.ui.initDom();
    G.render.init();

    // 移动端：启用虚拟摇杆；触屏设备开启性能降级与专属提示
    const touchOn = G.touch && G.touch.init ? G.touch.init() : false;
    if (G.CFG && G.CFG.perf) G.CFG.perf.lowFx = !!touchOn;
    if (touchOn && G.el.hintBar) {
      G.el.hintBar.textContent = '左半屏拖动移动（小幅拖动缓速走位） · 自动锁定最近敌人 · 走近宝箱/事件地点自动触发';
    }

    // 构筑总览面板（小屏侧栏隐藏时的替代入口）
    if (G.el.buildBtn) {
      G.el.buildBtn.addEventListener('click', () => {
        if (G.ui.showBuildPanel) G.ui.showBuildPanel();
        if (G.tone) G.tone({ freq: 500, type: 'sine', dur: 0.1, vol: 0.08 });
      });
    }
    if (G.el.buildClose) G.el.buildClose.addEventListener('click', () => G.ui.hideBuildPanel());
    if (G.el.buildOverlay) {
      G.el.buildOverlay.addEventListener('click', e => {
        if (e.target === G.el.buildOverlay) G.ui.hideBuildPanel();   // 点空白处关闭
      });
    }

    // 重开统一回到选武器界面
    const backToSelect = () => {
      if (G.el.overOverlay) G.el.overOverlay.classList.remove('show');
      G.ui.showStartSelect();
    };
    G.el.restartBtn.addEventListener('click', backToSelect);
    G.el.againBtn.addEventListener('click', backToSelect);
    G.el.soundBtn.addEventListener('click', () => {
      const muted = G.toggleMute();
      G.el.soundBtn.textContent = muted ? '🔇' : '🔊';
    });

    // 作弊码：U 键循环赋予八条终极武器（逐个试玩）；R 键快速重开
    const ultOrder = ['arrow', 'chain', 'shock', 'orbit', 'drone', 'mine', 'fireball', 'boomerang'];
    let ultIdx = -1;
    G.onKeyDown = k => {
      if (k === 'r' && (G.state.phase === 'over' || G.state.phase === 'play')) {
        ultIdx = -1;
        backToSelect();
      }
      if (k === 'u' && G.state.player) {
        ultIdx = (ultIdx + 1) % ultOrder.length;
        const line = ultOrder[ultIdx];
        G.grantUltimate(G.state.player, line);
        const meta = G.LINES[line], u = G.ULT[line];
        G.state.banner = { text: '★ 作弊码 · 终极武器', sub: meta.icon + ' ' + u.name + ' 已赋予', t: 2.6 };
        if (G.ui && G.ui.syncEqPanel) G.ui.syncEqPanel();
        if (G.tone) G.tone({ freq: 880, type: 'sine', dur: 0.15, vol: 0.1 });
      }
    };

    // 首次交互后解锁音频（浏览器自动播放策略）
    const unlock = () => { G.tone({ freq: 1, dur: 0.01, vol: 0.001 }); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    // 测试环境跳过开局选择界面（测试直接用 reset()→startRun() 控制开局）
    if (G.__TEST__ || (typeof window !== 'undefined' && window.__TEST__)) G.startRun();
    else G.ui.showStartSelect();
    G.engine.start(G.update, G.render.frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.ABYSS = window.ABYSS || {});
