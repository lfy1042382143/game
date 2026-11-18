/* ============================================================
   渲染层 · render.js
   Canvas 2D 绘制：大世界（相机跟随）、动态障碍、实体、弹幕、飘字、横幅
   每帧执行，不修改游戏状态（只读）
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp } = G;

  let ctx = null;
  const cam = { x: 0, y: 0 };

  function init() {
    const c = G.el.canvas;
    c.width = CFG.viewport.w;
    c.height = CFG.viewport.h;
    ctx = c.getContext('2d');
  }

  /* =========================================================
     相机：以玩家为中心，钳制在世界边界内
     ========================================================= */
  function updateCamera() {
    const W = CFG.world, V = CFG.viewport;
    const p = state.player;
    if (!p) { cam.x = 0; cam.y = 0; return; }
    cam.x = clamp(p.x - V.w / 2, 0, Math.max(0, W.w - V.w));
    cam.y = clamp(p.y - V.h / 2, 0, Math.max(0, W.h - V.h));
  }

  /* =========================================================
     场景（世界坐标，已在相机变换内绘制）
     ========================================================= */
  function drawArena() {
    const V = CFG.viewport, W = CFG.world;
    const map = G.MAPS[state.mapIdx % G.MAPS.length];

    // 地面（铺满视口，世界坐标）
    ctx.fillStyle = map.floor;
    ctx.fillRect(cam.x, cam.y, V.w, V.h);

    // 网格（对齐世界坐标）
    ctx.strokeStyle = map.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gx0 = Math.floor(cam.x / 48) * 48;
    const gy0 = Math.floor(cam.y / 48) * 48;
    for (let x = gx0; x <= cam.x + V.w + 48; x += 48) { ctx.moveTo(x, cam.y); ctx.lineTo(x, cam.y + V.h); }
    for (let y = gy0; y <= cam.y + V.h + 48; y += 48) { ctx.moveTo(cam.x, y); ctx.lineTo(cam.x + V.w, y); }
    ctx.stroke();

    // 世界边界墙（世界坐标）
    ctx.strokeStyle = map.wall;
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, W.w, W.h);

    // 视口外遮挡提示（世界边缘之外画暗色）
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    if (cam.x + V.w > W.w) ctx.fillRect(W.w, cam.y, cam.x + V.w - W.w, V.h);
    if (cam.y + V.h > W.h) ctx.fillRect(cam.x, W.h, V.w, cam.y + V.h - W.h);

    // 动态障碍物（世界坐标）
    state.obstacles.forEach(o => {
      ctx.fillStyle = map.ob;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = map.obEdge;
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = map.obInner;
      ctx.fillRect(o.x + 6, o.y + 6, o.w - 12, o.h - 12);
    });
  }

  /* =========================================================
     实体（世界坐标）
     ========================================================= */
  function drawUnit(u, isPlayer) {
    if (u.dead) return;
    const x = u.x, y = u.y;

    // 视口外剔除（世界坐标）
    const V = CFG.viewport;
    if (x < cam.x - 60 || x > cam.x + V.w + 60 || y < cam.y - 60 || y > cam.y + V.h + 60) return;

    let alpha = 1;
    if (isPlayer && u.iframes > 0) alpha = 0.45 + 0.4 * Math.sin(state.time * 40);
    ctx.globalAlpha = alpha;

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + u.r * 0.9, u.r * 0.8, u.r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 身体
    ctx.beginPath();
    ctx.arc(x, y, u.r, 0, Math.PI * 2);
    ctx.fillStyle = u.flashT > 0 ? '#ffffff' : (isPlayer ? '#3b82f6' : (u.type === 'boss' ? '#dc2626' : '#b45309'));
    ctx.fill();
    ctx.lineWidth = isPlayer ? 2.5 : 2;
    ctx.strokeStyle = isPlayer ? '#93c5fd' : (u.type === 'boss' ? '#fca5a5' : (u.elite ? '#fbbf24' : '#d9a05b'));
    ctx.stroke();

    // 图标
    ctx.font = Math.round(u.r * 1.25) + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(u.emoji || '?', x, y + 1);

    // 护盾环
    if (u.shield > 0) {
      ctx.beginPath();
      ctx.arc(x, y, u.r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(125,211,252,0.85)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // 血条
    const bw = u.r * 2.2, bh = 4;
    const bx = x - bw / 2, by = y - u.r - 14;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    const pct = clamp(u.hp / Math.max(1, u.maxHp), 0, 1);
    ctx.fillStyle = isPlayer ? '#4ade80' : '#f87171';
    ctx.fillRect(bx, by, bw * pct, bh);

    // 词缀 / 精英标记
    if (u.affix) {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(u.affix.icon + u.affix.name, x, by - 10);
    } else if (u.elite) {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('★ 精英', x, by - 10);
    }
    if (u.type === 'boss') {
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#fca5a5';
      ctx.fillText(u.name, x, by - 22);
    }

    ctx.globalAlpha = 1;
  }

  /* =========================================================
     弹幕与飞刃
     ========================================================= */
  function drawBullets() {
    state.bullets.forEach(b => {
      const x = b.x, y = b.y;
      ctx.beginPath();
      ctx.arc(x, y, b.r, 0, Math.PI * 2);
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

  function drawOrbitBlades() {
    const p = state.player;
    if (!p || !p.orbits || p.dead) return;
    const blades = G.orbitPositions(p);
    blades.forEach(b => {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(state.time * 8);
      ctx.fillStyle = '#67e8f9';
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 6;
      ctx.fillRect(-5, -2, 10, 4);
      ctx.shadowBlur = 0;
      ctx.restore();
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
    const V = CFG.viewport;
    const t = clamp(b.t / 2.2, 0, 1);
    ctx.globalAlpha = Math.min(1, t * 2);
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillStyle = '#e5e9f5';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 6;
    ctx.strokeText(b.text, V.w / 2, V.h / 2 - 14);
    ctx.fillText(b.text, V.w / 2, V.h / 2 - 14);
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#9aa4c4';
    ctx.fillText(b.sub, V.w / 2, V.h / 2 + 22);
    ctx.globalAlpha = 1;
  }

  /* =========================================================
     小地图（视口右下角）：世界轮廓 + 玩家/敌人位置
     ========================================================= */
  function drawMinimap() {
    const V = CFG.viewport, W = CFG.world;
    const mw = 130, mh = Math.round(130 * W.h / W.w);
    const mx = V.w - mw - 14, my = V.h - mh - 14;
    const sx = mw / W.w, sy = mh / W.h;

    ctx.fillStyle = 'rgba(10,10,18,0.6)';
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = 'rgba(126,138,180,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, mw, mh);

    // 障碍物
    ctx.fillStyle = 'rgba(126,138,180,0.35)';
    state.obstacles.forEach(o => {
      ctx.fillRect(mx + o.x * sx, my + o.y * sy, Math.max(2, o.w * sx), Math.max(2, o.h * sy));
    });

    // 敌人
    state.foes.forEach(f => {
      if (f.dead) return;
      ctx.fillStyle = f.type === 'boss' ? '#fca5a5' : '#fb7185';
      ctx.fillRect(mx + f.x * sx - 2, my + f.y * sy - 2, 4, 4);
    });

    // 玩家
    if (state.player) {
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(mx + state.player.x * sx - 2.5, my + state.player.y * sy - 2.5, 5, 5);
    }
  }

  /* =========================================================
     帧渲染
     ========================================================= */
  function frame() {
    if (!ctx) return;
    updateCamera();
    const V = CFG.viewport;
    ctx.clearRect(0, 0, V.w, V.h);

    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    drawArena();
    drawOrbitBlades();
    drawBullets();
    state.foes.forEach(f => drawUnit(f, false));
    if (state.player) drawUnit(state.player, true);
    drawFloaters();
    ctx.restore();

    // 屏幕空间层
    drawMinimap();
    drawBanner();
  }

  Object.assign(G, { render: { init, frame }, camera: cam });
})(window.ABYSS = window.ABYSS || {});
