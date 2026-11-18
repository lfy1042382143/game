/* ============================================================
   渲染层 · render.js
   Canvas 2D 绘制：竞技场、实体、弹幕、飘字、横幅
   每帧执行，不修改游戏状态（只读）
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp } = G;

  let ctx = null;

  function init() {
    const c = G.el.canvas;
    c.width = CFG.arena.w;
    c.height = CFG.arena.h;
    ctx = c.getContext('2d');
  }

  /* =========================================================
     场景
     ========================================================= */
  function drawArena() {
    const A = CFG.arena;
    // 地面
    ctx.fillStyle = '#12121c';
    ctx.fillRect(0, 0, A.w, A.h);

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= A.w; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, A.h); }
    for (let y = 0; y <= A.h; y += 48) { ctx.moveTo(0, y); ctx.lineTo(A.w, y); }
    ctx.stroke();

    // 边界墙
    ctx.strokeStyle = 'rgba(126,138,180,0.55)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, A.w - 4, A.h - 4);

    // 柱子
    state.obstacles.forEach(o => {
      ctx.fillStyle = '#1d1e2e';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = 'rgba(126,138,180,0.4)';
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = 'rgba(126,138,180,0.12)';
      ctx.fillRect(o.x + 6, o.y + 6, o.w - 12, o.h - 12);
    });
  }

  /* =========================================================
     实体
     ========================================================= */
  function drawUnit(u, isPlayer) {
    if (u.dead) return;

    // 无敌帧闪烁
    let alpha = 1;
    if (isPlayer && u.iframes > 0) alpha = 0.45 + 0.4 * Math.sin(state.time * 40);
    ctx.globalAlpha = alpha;

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + u.r * 0.9, u.r * 0.8, u.r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 身体
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.r, 0, Math.PI * 2);
    ctx.fillStyle = u.flashT > 0 ? '#ffffff' : (isPlayer ? '#3b82f6' : (u.type === 'boss' ? '#dc2626' : '#b45309'));
    ctx.fill();
    ctx.lineWidth = isPlayer ? 2.5 : 2;
    ctx.strokeStyle = isPlayer ? '#93c5fd' : (u.type === 'boss' ? '#fca5a5' : (u.elite ? '#fbbf24' : '#d9a05b'));
    ctx.stroke();

    // 图标
    ctx.font = Math.round(u.r * 1.25) + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(u.emoji || '?', u.x, u.y + 1);

    // 护盾环
    if (u.shield > 0) {
      ctx.beginPath();
      ctx.arc(u.x, u.y, u.r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(125,211,252,0.85)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // 血条
    const bw = u.r * 2.2, bh = 4;
    const bx = u.x - bw / 2, by = u.y - u.r - 14;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    const pct = clamp(u.hp / Math.max(1, u.maxHp), 0, 1);
    ctx.fillStyle = isPlayer ? '#4ade80' : '#f87171';
    ctx.fillRect(bx, by, bw * pct, bh);

    // 词缀 / 精英标记
    if (u.affix) {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(u.affix.icon + u.affix.name, u.x, by - 10);
    } else if (u.elite) {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('★ 精英', u.x, by - 10);
    }
    if (u.type === 'boss') {
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#fca5a5';
      ctx.fillText(u.name, u.x, by - 22);
    }

    ctx.globalAlpha = 1;
  }

  /* =========================================================
     弹幕
     ========================================================= */
  function drawBullets() {
    state.bullets.forEach(b => {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      if (b.side === 'p') {
        ctx.fillStyle = b.crit ? '#fbbf24' : '#7dd3fc';
        ctx.shadowColor = '#38bdf8';
      } else {
        ctx.fillStyle = '#fb7185';
        ctx.shadowColor = '#f43f5e';
      }
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  /* =========================================================
     飘字与横幅
     ========================================================= */
  function drawFloaters() {
    ctx.textAlign = 'center';
    state.floaters.forEach(f => {
      ctx.globalAlpha = clamp(f.t / 0.9, 0, 1);
      ctx.font = (f.big ? 'bold 20px' : 'bold 14px') + ' sans-serif';
      ctx.fillStyle = f.c;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.globalAlpha = 1;
  }

  function drawBanner() {
    const b = state.banner;
    if (!b) return;
    const t = clamp(b.t / 1.6, 0, 1);
    ctx.globalAlpha = Math.min(1, t * 2);
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillStyle = '#e5e9f5';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 6;
    ctx.strokeText(b.text, CFG.arena.w / 2, CFG.arena.h / 2 - 14);
    ctx.fillText(b.text, CFG.arena.w / 2, CFG.arena.h / 2 - 14);
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#9aa4c4';
    ctx.fillText(b.sub, CFG.arena.w / 2, CFG.arena.h / 2 + 22);
    ctx.globalAlpha = 1;
  }

  /* =========================================================
     帧渲染
     ========================================================= */
  function frame() {
    if (!ctx) return;
    ctx.clearRect(0, 0, CFG.arena.w, CFG.arena.h);
    drawArena();
    drawBullets();
    state.foes.forEach(f => drawUnit(f, false));
    if (state.player) drawUnit(state.player, true);
    drawFloaters();
    drawBanner();
  }

  Object.assign(G, { render: { init, frame } });
})(window.ABYSS = window.ABYSS || {});
