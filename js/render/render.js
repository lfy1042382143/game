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

    // 随机地形斑块：按世界坐标哈希确定性生成，随相机移动自然换入换出（无边界地图）
    const TC = 320;
    const tcx0 = Math.floor(cam.x / TC) - 1, tcx1 = Math.floor((cam.x + V.w) / TC) + 1;
    const tcy0 = Math.floor(cam.y / TC) - 1, tcy1 = Math.floor((cam.y + V.h) / TC) + 1;
    for (let gx = tcx0; gx <= tcx1; gx++) {
      for (let gy = tcy0; gy <= tcy1; gy++) {
        if (!G.cellHash) break;
        const h = G.cellHash(gx, gy, 777);
        if (h < 0.45) continue;
        const x = gx * TC + G.cellHash(gx, gy, 778) * TC;
        const y = gy * TC + G.cellHash(gx, gy, 779) * TC;
        const r = 40 + G.cellHash(gx, gy, 780) * 100;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.5 + G.cellHash(gx, gy, 781) * 0.5), 0, 0, Math.PI * 2);
        ctx.fillStyle = map.obInner;
        ctx.fill();
      }
    }

    // 动态障碍物：连绵不规则岩脉（按地图主题变形）
    const theme = ['rock', 'bone', 'lava', 'crystal', 'mud'][state.mapIdx % 5];
    state.obstacles.forEach(o => {
      if (!o.pts) return;   // 兼容旧矩形（正常不会出现）
      ctx.beginPath();
      ctx.moveTo(o.pts[0].x, o.pts[0].y);
      for (let i = 1; i < o.pts.length; i++) ctx.lineTo(o.pts[i].x, o.pts[i].y);
      ctx.closePath();
      ctx.fillStyle = map.ob;
      ctx.fill();
      ctx.strokeStyle = map.obEdge;
      ctx.lineWidth = theme === 'bone' ? 3 : 2;
      ctx.stroke();

      // 内部纹理：按主题变化
      ctx.save();
      ctx.clip();
      if (theme === 'lava') {
        // 熔岩：发光裂缝
        ctx.strokeStyle = 'rgba(251,146,60,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(o.x - o.r * 0.6, o.y - o.r * 0.2);
        ctx.lineTo(o.x, o.y + o.r * 0.2);
        ctx.lineTo(o.x + o.r * 0.5, o.y - o.r * 0.3);
        ctx.stroke();
      } else if (theme === 'bone') {
        // 骨林：平行骨纹
        ctx.strokeStyle = map.obInner;
        ctx.lineWidth = 3;
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.moveTo(o.x - o.r, o.y + k * o.r * 0.35);
          ctx.lineTo(o.x + o.r, o.y + k * o.r * 0.35 + 4);
          ctx.stroke();
        }
      } else if (theme === 'crystal') {
        // 虚空：晶面高光
        ctx.fillStyle = 'rgba(167,180,255,0.10)';
        ctx.beginPath();
        ctx.moveTo(o.x, o.y - o.r);
        ctx.lineTo(o.x + o.r * 0.5, o.y);
        ctx.lineTo(o.x, o.y + o.r * 0.7);
        ctx.closePath();
        ctx.fill();
      } else if (theme === 'mud') {
        // 沼泽：泥泡
        ctx.fillStyle = 'rgba(134,230,170,0.12)';
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(o.x + (k - 1) * o.r * 0.4, o.y + Math.sin(k) * o.r * 0.3, o.r * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // 深渊岩石：内圈阴影
        ctx.fillStyle = map.obInner;
        ctx.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
      }
      ctx.restore();

      // 伪装陷阱触发瞬间：红色尖刺沿多边形边缘长出
      if (o.trap && o.trap.trigT > 0) {
        const k = clamp(o.trap.trigT / CFG.obstacles.trigT, 0, 1);
        ctx.globalAlpha = k;
        ctx.fillStyle = '#f87171';
        ctx.strokeStyle = 'rgba(252,165,165,0.9)';
        ctx.lineWidth = 1;
        for (let i = 0; i < o.pts.length; i++) {
          const a = o.pts[i], b = o.pts[(i + 1) % o.pts.length];
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const nx = mx - o.x, ny = my - o.y;
          const nl = Math.hypot(nx, ny) || 1;
          const hgt = (12 + (i % 2) * 8) * k;
          const ex = mx + (nx / nl) * hgt, ey = my + (ny / nl) * hgt;
          ctx.beginPath();
          ctx.moveTo(mx - 5, my); ctx.lineTo(ex, ey); ctx.lineTo(mx + 5, my);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    });
  }

  /* =========================================================
     地图陷阱：持久区域（泥潭/裂隙）+ 临时灾害（预警/爆发）
     ========================================================= */
  const PI2 = Math.PI * 2;

  function drawZones() {
    for (const z of state.zones) {
      if (z.kind === 'swamp') {
        // 减速泥潭：绿色半透明 + 虚线边 + 冒泡
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, PI2);
        ctx.fillStyle = 'rgba(74,222,128,0.10)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(74,222,128,0.42)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
        for (let i = 0; i < 3; i++) {
          const ph = (state.time * 0.6 + i * 1.3) % 1;
          const ba = i * 2.1 + z.x;
          ctx.globalAlpha = 0.5 * (1 - ph);
          ctx.beginPath();
          ctx.arc(z.x + Math.cos(ba) * z.r * 0.5, z.y + Math.sin(ba) * z.r * 0.5, 3 + ph * 3, 0, PI2);
          ctx.strokeStyle = 'rgba(134,239,172,0.8)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (z.kind === 'vortex') {
        // 引力裂隙：紫色旋转虚线环 + 暗心
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, PI2);
        ctx.fillStyle = 'rgba(88,28,135,0.18)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(167,139,250,0.55)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([14, 9]);
        ctx.lineDashOffset = -state.time * 30;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        // 内圈漩涡
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r * 0.45, state.time * 2.2, state.time * 2.2 + PI2 * 0.6);
        ctx.strokeStyle = 'rgba(196,181,253,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(z.x, z.y, 5 + Math.sin(state.time * 4) * 2, 0, PI2);
        ctx.fillStyle = 'rgba(196,181,253,0.8)';
        ctx.fill();
      }
    }
  }

  function drawHazards() {
    for (const h of state.hazards) {
      const isFire = h.kind === 'fire';
      const cMain = isFire ? '#fb923c' : '#e7e5e4';
      const cFill = isFire ? 'rgba(249,115,22,0.10)' : 'rgba(226,232,240,0.08)';
      if (!h.hit) {
        const prog = clamp(h.t / h.warn, 0, 1);
        // 预警圈：底色 + 虚线边
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, PI2);
        ctx.fillStyle = cFill;
        ctx.fill();
        ctx.strokeStyle = cMain;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        // 施法进度环
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r * 0.55, -Math.PI / 2, -Math.PI / 2 + prog * PI2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = cMain;
        ctx.stroke();
        // 火球：从空中坠落（影子随进度逼近落点）
        if (isFire) {
          const sr = 4 + 11 * (1 - prog);
          ctx.beginPath();
          ctx.arc(h.x, h.y - 140 * (1 - prog), sr, 0, PI2);
          ctx.fillStyle = '#f97316';
          ctx.shadowColor = '#fb923c';
          ctx.shadowBlur = 10;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;
      } else {
        // 爆发闪光
        const k = clamp(h.boomT / 0.35, 0, 1);
        ctx.globalAlpha = k;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r * (1.15 - 0.3 * k), 0, PI2);
        ctx.fillStyle = isFire ? 'rgba(251,146,60,0.55)' : 'rgba(231,229,228,0.5)';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  /* =========================================================
     法师 AoE 预警圈与爆发（世界坐标）
     ========================================================= */
  function drawMageAoes() {
    for (const a of state.mageAoes) {
      const prog = clamp(a.t / a.warn, 0, 1);
      // 预警圈：紫色底 + 进度环
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r, 0, PI2);
      ctx.fillStyle = 'rgba(139,92,246,0.10)';
      ctx.fill();
      ctx.strokeStyle = '#a78bfa';
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r * 0.55, -Math.PI / 2, -Math.PI / 2 + prog * PI2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#a78bfa';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /* =========================================================
     预警指向线：宝箱怪跳扑（黄）与 BOSS 冲撞（红）
     ========================================================= */
  function drawMimicTelegraphs() {
    for (const e of state.foes) {
      if (e.dead) continue;
      let n, tLeft, dur, color, len;
      if (e.tele) {
        n = e.tele.n; tLeft = e.tele.t; dur = CFG.mimic.tele;
        color = '#fbbf24'; len = 230;
      } else if (e.bossDash && e.bossDash.tele > 0) {
        n = e.bossDash.n; tLeft = e.bossDash.tele; dur = CFG.boss.dashTele;
        color = '#f87171'; len = 430;
      } else {
        continue;
      }
      const prog = clamp(1 - tLeft / dur, 0, 1);
      ctx.globalAlpha = 0.35 + 0.45 * prog;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + n.x * len, e.y + n.y * len);
      ctx.stroke();
      ctx.setLineDash([]);
      // 蓄力圈收缩
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 8 - 6 * prog, 0, PI2);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
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
    const bodyC = {
      boss: '#dc2626', mage: '#8b5cf6', mimic: '#d97706', ranged: '#b45309', melee: '#92400e'
    }[u.type] || '#b45309';
    ctx.fillStyle = u.flashT > 0 ? '#ffffff' : (isPlayer ? '#3b82f6' : bodyC);
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

    // 法师闪现前摇：紫色虚线圈
    if (u.blinkWarnT > 0) {
      ctx.beginPath();
      ctx.arc(x, y, u.r + 9, 0, Math.PI * 2);
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(192,132,252,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
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
        // 分裂弹/浮游炮弹自带颜色，与玩家箭矢区分
        ctx.fillStyle = b.crit ? '#fbbf24' : (b.color || '#7dd3fc');
        ctx.shadowColor = b.crit ? '#f59e0b' : (b.color || '#38bdf8');
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
     技能特效：浮游炮 / 震荡波 / 次级震荡波 / 连锁闪电
     ========================================================= */
  function drawSkills() {
    const p = state.player;

    // 浮游炮本体：停在玩家周围固定方位（不旋转），部署期间可见
    if (p && p.skills && p.skills.drone && p.sk && p.sk.drone.active > 0 && !p.dead) {
      const d = p.sk.drone;
      for (let i = 0; i < d.count; i++) {
        const dp = G.dronePos(p, i, d.count);
        // 存活时间即将耗尽时闪烁提醒
        const fading = d.active < 1.2 && (Math.floor(state.time * 6) % 2 === 0);
        ctx.save();
        ctx.translate(dp.x, dp.y);
        ctx.globalAlpha = fading ? 0.45 : 1;
        ctx.fillStyle = '#c4b5fd';
        ctx.shadowColor = '#a78bfa';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#4c1d95';
        ctx.fillRect(-2, -2, 4, 4);
        ctx.restore();
      }
    }

    // 感应地雷（未引爆时躺在地上，闪烁提醒）
    (state.mines || []).forEach(m => {
      const pulse = 0.75 + Math.sin(state.time * 5 + m.x) * 0.25;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = m.armed > 0 ? 'rgba(148,163,184,0.6)' : '#f59e0b';
      ctx.globalAlpha = pulse;
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      // 中心火花
      ctx.fillStyle = '#fff7ed';
      ctx.beginPath();
      ctx.arc(m.x, m.y - 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // 触发范围虚线圈
      ctx.strokeStyle = 'rgba(251,191,36,0.30)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // 技能特效
    (state.skillFx || []).forEach(fx => {
      if (fx.delay > 0) return;
      const k = clamp(fx.t / fx.dur, 0, 1);
      if (fx.kind === 'shock' || fx.kind === 'shockEcho') {
        const r = fx.r * (0.3 + k * 0.7);
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = fx.kind === 'shockEcho'
          ? 'rgba(147,197,253,' + (1 - k) + ')'
          : 'rgba(125,211,252,' + (1 - k) + ')';
        ctx.lineWidth = 4 * (1 - k) + 1;
        if (fx.kind === 'shockEcho') ctx.setLineDash([8, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (fx.kind === 'chain') {
        // 锯齿电弧：外层紫色辉光 + 内层白色核心，醒目
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(fx.pts[0].x, fx.pts[0].y);
        for (let i = 1; i < fx.pts.length; i++) ctx.lineTo(fx.pts[i].x, fx.pts[i].y);
        ctx.shadowColor = '#a78bfa';
        ctx.shadowBlur = 18;
        ctx.strokeStyle = 'rgba(167,139,250,' + (1 - k) + ')';
        ctx.lineWidth = 6 * (1 - k) + 2;
        ctx.stroke();
        ctx.shadowBlur = 8;
        ctx.strokeStyle = 'rgba(255,255,255,' + (1 - k) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      } else if (fx.kind === 'zap') {
        // 闪电命中点闪光
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.r * (0.4 + k * 0.8), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(196,181,253,' + (1 - k) * 0.75 + ')';
        ctx.shadowColor = '#a78bfa';
        ctx.shadowBlur = 14;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.r * 0.4 * (1 - k), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,' + (1 - k) + ')';
        ctx.fill();
      }
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
     宝箱与事件地点（世界坐标）
     ========================================================= */
  function drawChests() {
    state.chests.forEach(c => {
      const bob = Math.sin(state.time * 3 + c.t) * 3;
      ctx.globalAlpha = 0.9;
      ctx.font = '26px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 12;
      ctx.fillText('📦', c.x, c.y + bob);
      ctx.shadowBlur = 0;
      // 拾取范围提示
      ctx.beginPath();
      ctx.arc(c.x, c.y, CFG.chests.pickupR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(251,191,36,0.25)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  function drawSites() {
    state.sites.forEach(s => {
      if (s.used) return;
      const pulse = 1 + Math.sin(state.time * 2.2) * 0.12;
      // 光柱底座
      ctx.beginPath();
      ctx.arc(s.x, s.y, CFG.events.triggerR * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(167,139,250,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, CFG.events.triggerR * pulse, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(167,139,250,0.08)';
      ctx.fill();
      ctx.font = '26px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#a78bfa';
      ctx.shadowBlur = 14;
      ctx.fillText(s.evt.icon, s.x, s.y);
      ctx.shadowBlur = 0;
    });
  }

  /* =========================================================
     小地图（视口右下角）：无边界地图 → 显示玩家周围的局部雷达
     ========================================================= */
  function drawMinimap() {
    const V = CFG.viewport, p = state.player;
    const size = 130;
    const mx = V.w - size - 14, my = V.h - size - 14;
    const cx = mx + size / 2, cy = my + size / 2;
    const R = (CFG.terrain && CFG.terrain.activeRadius) || 1800;
    const sx = size / (2 * R);
    const px = p ? p.x : 0, py = p ? p.y : 0;
    const X = x => cx + (x - px) * sx;
    const Y = y => cy + (y - py) * sx;
    const inView = (x, y) => Math.abs(x - px) < R && Math.abs(y - py) < R;

    ctx.fillStyle = 'rgba(10,10,18,0.6)';
    ctx.fillRect(mx, my, size, size);
    ctx.strokeStyle = 'rgba(126,138,180,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, size, size);
    ctx.strokeStyle = 'rgba(126,138,180,0.14)';
    ctx.beginPath();
    ctx.moveTo(cx, my); ctx.lineTo(cx, my + size);
    ctx.moveTo(mx, cy); ctx.lineTo(mx + size, cy);
    ctx.stroke();

    ctx.fillStyle = 'rgba(126,138,180,0.35)';
    state.obstacles.forEach(o => {
      if (inView(o.x, o.y)) ctx.fillRect(X(o.x - o.r), Y(o.y - o.r), Math.max(2, o.r * 2 * sx), Math.max(2, o.r * 2 * sx));
    });

    state.sites.forEach(s => {
      if (s.used || !inView(s.x, s.y)) return;
      ctx.fillStyle = '#a78bfa';
      ctx.fillRect(X(s.x) - 2, Y(s.y) - 2, 4, 4);
    });

    state.chests.forEach(c => {
      if (!inView(c.x, c.y)) return;
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(X(c.x) - 2, Y(c.y) - 2, 4, 4);
    });

    state.foes.forEach(f => {
      if (f.dead || !inView(f.x, f.y)) return;
      ctx.fillStyle = f.type === 'boss' ? '#fca5a5' : '#fb7185';
      ctx.fillRect(X(f.x) - 2, Y(f.y) - 2, 4, 4);
    });

    if (p) {
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
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
    drawZones();
    drawHazards();
    drawMageAoes();
    drawSites();
    drawChests();
    drawOrbitBlades();
    drawSkills();
    drawBullets();
    drawMimicTelegraphs();
    state.foes.forEach(f => drawUnit(f, false));
    if (state.player) drawUnit(state.player, true);
    drawFloaters();
    ctx.restore();

    // 屏幕空间层
    drawMinimap();
    drawBanner();
    drawCrosshair();
    // 左：输出统计；右：属性/攻击方式（内部有变化签名节流，仅变化时写 DOM）
    if (G.ui && G.ui.syncEqPanel) G.ui.syncEqPanel();
    if (G.ui && G.ui.syncDmgPanel) G.ui.syncDmgPanel();
  }

  /** 鼠标准星（画布逻辑坐标，屏幕空间） */
  function drawCrosshair() {
    const m = G.engine && G.engine.mouse;
    if (!m || !m.active || !state.player || state.phase !== 'play') return;
    ctx.strokeStyle = 'rgba(147,197,253,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(m.cx, m.cy, 9, 0, PI2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m.cx - 14, m.cy); ctx.lineTo(m.cx - 4, m.cy);
    ctx.moveTo(m.cx + 4, m.cy); ctx.lineTo(m.cx + 14, m.cy);
    ctx.moveTo(m.cx, m.cy - 14); ctx.lineTo(m.cx, m.cy - 4);
    ctx.moveTo(m.cx, m.cy + 4); ctx.lineTo(m.cx, m.cy + 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(m.cx, m.cy, 1.5, 0, PI2);
    ctx.fillStyle = '#93c5fd';
    ctx.fill();
  }

  Object.assign(G, { render: { init, frame }, camera: cam });
})(window.ABYSS = window.ABYSS || {});
