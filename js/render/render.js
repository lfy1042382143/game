/* ============================================================
   渲染层 · render.js
   Canvas 2D 绘制：大世界（相机跟随）、动态障碍、实体、弹幕、飘字、横幅
   每帧执行，不修改游戏状态（只读）
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp } = G;

  let ctx = null;
  let dpr = 1;                    // 触屏设备 ≤2 的高清渲染倍率（桌面保持 1）
  const cam = { x: 0, y: 0 };

  /** shadowBlur 发光在低端手机上开销大：lowFx 时整体关闭 */
  function fxBlur(v) {
    if (!CFG.perf || !CFG.perf.lowFx) ctx.shadowBlur = v;
  }

  /**
   * 计算图片水平缩放符号：1 = 原样，-1 = 镜像。
   * baseFace 是素材原图朝向（1 朝右 / -1 朝左 / 0 正面）。
   * 目标在右 → 角色应朝右；目标在左 → 应朝左。
   * 原图已朝目标方向就不翻，反着才翻；正面素材不影响。
   */
  function spriteFace(x, targetX, baseFace) {
    baseFace = baseFace === undefined ? -1 : baseFace;
    if (targetX === undefined || baseFace === 0) return 1;
    const wantRight = targetX >= x;
    // 原图朝左(-1)：想朝右就镜像(-1)、想朝左保持(1)
    // 原图朝右(+1)：想朝右保持(1)、想朝左镜像(-1)
    return wantRight ? baseFace : -baseFace;
  }

  function init() {
    const c = G.el.canvas;
    const isTouch = G.touch && G.touch.isTouchDevice && G.touch.isTouchDevice();
    dpr = isTouch ? Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1) : 1;
    c.width = CFG.viewport.w * dpr;
    c.height = CFG.viewport.h * dpr;
    ctx = c.getContext('2d');
    if (dpr !== 1 && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  /**
   * 障碍物外观配置表（统一骨架的数据源）。
   * 以后给形象图：给某项加 image: Image 对象，drawObstacle 里优先 drawImage 即可，
   * 其余生成/碰撞/功能逻辑完全不用动。
   */
  const OB_STYLE = {
    root:  { fill: '#3a2c1c', edge: 'rgba(150,110,70,0.55)', inner: 'rgba(120,90,55,0.35)', pattern: 'grain', lw: 2.5 },
    stone: { fill: '#1d1e2e', edge: 'rgba(126,138,180,0.5)',  inner: 'rgba(126,138,180,0.16)', pattern: 'inner', lw: 2 },
    bone:  { fill: '#241d15', edge: 'rgba(214,196,160,0.5)',  inner: 'rgba(226,210,180,0.22)', pattern: 'bone',  lw: 3 },
    ice:   { fill: '#1a2a3a', edge: 'rgba(170,220,255,0.65)', inner: 'rgba(200,235,255,0.22)', pattern: 'facet', lw: 2 },
    lava:  { fill: '#2d1610', edge: 'rgba(255,120,60,0.6)',   inner: 'rgba(255,140,60,0.3)',  pattern: 'crack', lw: 2 }
  };

  /** 统一纹理绘制：只按 pattern 画，不掺杂任何功能逻辑 */
  function drawObstaclePattern(o, st) {
    const r = o.r;
    if (st.pattern === 'crack') {
      ctx.strokeStyle = st.inner;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(o.x - r * 0.6, o.y - r * 0.2);
      ctx.lineTo(o.x, o.y + r * 0.2);
      ctx.lineTo(o.x + r * 0.5, o.y - r * 0.3);
      ctx.stroke();
    } else if (st.pattern === 'bone') {
      ctx.strokeStyle = st.inner;
      ctx.lineWidth = 3;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(o.x - r, o.y + k * r * 0.35);
        ctx.lineTo(o.x + r, o.y + k * r * 0.35 + 4);
        ctx.stroke();
      }
    } else if (st.pattern === 'facet') {
      ctx.fillStyle = st.inner;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y - r);
      ctx.lineTo(o.x + r * 0.5, o.y);
      ctx.lineTo(o.x, o.y + r * 0.7);
      ctx.closePath();
      ctx.fill();
    } else if (st.pattern === 'grain') {
      ctx.strokeStyle = st.inner;
      ctx.lineWidth = 2;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(o.x - r * 0.8, o.y + k * r * 0.4);
        ctx.quadraticCurveTo(o.x, o.y + k * r * 0.4 + 6, o.x + r * 0.8, o.y + k * r * 0.3);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = st.inner;
      ctx.fillRect(o.x - r, o.y - r, r * 2, r * 2);
    }
  }

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

    // 动态障碍物：统一绘制骨架。外观全部由 OB_STYLE 表驱动，
    // 以后换成形象图时只需在表里给对应类型加 image 字段即可，绘制逻辑不用动。
    for (const o of state.obstacles) {
      if (!o.pts) continue;
      const st = OB_STYLE[o.obType] || OB_STYLE.stone;
      ctx.beginPath();
      ctx.moveTo(o.pts[0].x, o.pts[0].y);
      for (let i = 1; i < o.pts.length; i++) ctx.lineTo(o.pts[i].x, o.pts[i].y);
      ctx.closePath();
      ctx.fillStyle = st.fill;
      ctx.fill();
      ctx.strokeStyle = st.edge;
      ctx.lineWidth = st.lw || 2;
      ctx.stroke();

      // 统一内部纹理：按表里的 pattern 选择
      ctx.save();
      ctx.clip();
      drawObstaclePattern(o, st);
      ctx.restore();

      // 功能状态叠加（不改变骨架）：熔岩靠近发红、冰柱受损裂纹、骨堆召唤脉冲
      if (o.obType === 'lava' && (o.touchT || 0) >= (CFG.obstacles.lavaWarn || 1.4)) {
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r * 1.15, 0, PI2);
        ctx.strokeStyle = 'rgba(251,146,60,' + (0.35 + 0.25 * Math.sin(state.time * 6)) + ')';
        ctx.lineWidth = 2; ctx.stroke();
      }
      if (o.obType === 'ice' && o.hp < (CFG.obstacles.iceHp || 6)) {
        const k = 1 - clamp(o.hp / (CFG.obstacles.iceHp || 6), 0, 1);
        ctx.strokeStyle = 'rgba(226,246,255,' + (0.4 + k * 0.5) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(o.x - o.r * 0.6, o.y - o.r * 0.5);
        ctx.lineTo(o.x + o.r * 0.2 * k, o.y + o.r * 0.1);
        ctx.lineTo(o.x - o.r * 0.1, o.y + o.r * 0.6);
        ctx.stroke();
      }
      if (o.obType === 'bone' && (o.spawnT || 0) > (CFG.obstacles.boneSpawnCd || 6) * 0.75) {
        const k = (o.spawnT || 0) / (CFG.obstacles.boneSpawnCd || 6);
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r * (0.6 + k * 0.7), 0, PI2);
        ctx.strokeStyle = 'rgba(248,250,252,' + (0.25 * k) + ')';
        ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
  }

  /* =========================================================
     地图机制：毒池（持久区域）+ 岩浆（预警/爆发）
     ========================================================= */
  const PI2 = Math.PI * 2;

  function drawZones() {
    for (const z of state.zones) {
      if (!z.pts) continue;
      ctx.beginPath();
      ctx.moveTo(z.pts[0].x, z.pts[0].y);
      for (let i = 1; i < z.pts.length; i++) ctx.lineTo(z.pts[i].x, z.pts[i].y);
      ctx.closePath();

      if (z.kind === 'ice') {
        // 冰面：不规则多边形 + 淡蓝半透明填充 + 内部裂纹高光 + 边缘微光
        ctx.fillStyle = 'rgba(186,230,253,0.14)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(224,242,254,0.42)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.save();
        ctx.clip();
        // 冰裂纹：按种子固定几条折线，模拟真实冰面的裂纹
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1.2;
        for (let k = 0; k < 5; k++) {
          const a = k * 1.27 + z.seed * 6;
          const r0 = z.r * (0.15 + 0.12 * k);
          ctx.beginPath();
          ctx.moveTo(z.x, z.y);
          ctx.lineTo(z.x + Math.cos(a) * r0, z.y + Math.sin(a) * r0);
          ctx.lineTo(z.x + Math.cos(a + 0.35) * r0 * 1.7, z.y + Math.sin(a + 0.35) * r0 * 1.7);
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }

      // 毒池：不规则多边形 + 毒绿填充 + 边缘冒泡
      ctx.fillStyle = 'rgba(132,204,22,0.13)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(163,230,53,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = -state.time * 12;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      // 毒气泡泡：按池子种子固定分布，随时间上浮
      for (let i = 0; i < 4; i++) {
        const ph = (state.time * 0.45 + i * 0.27 + z.seed) % 1;
        const ba = i * 1.9 + z.seed * 6;
        const rr = z.r * (0.25 + 0.4 * ((i % 3) / 3));
        ctx.globalAlpha = 0.55 * (1 - ph);
        ctx.beginPath();
        ctx.arc(z.x + Math.cos(ba) * rr, z.y + Math.sin(ba) * rr - ph * 12, 3 + ph * 5, 0, PI2);
        ctx.fillStyle = '#a3e635';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawHazards() {
    for (const h of state.hazards) {
      if (h.kind !== 'lava') continue;
      if (!h.hit) {
        const prog = clamp(h.t / h.warn, 0, 1);
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, PI2);
        ctx.fillStyle = 'rgba(249,115,22,0.10)';
        ctx.fill();
        ctx.strokeStyle = '#fb923c';
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r * 0.55, -Math.PI / 2, -Math.PI / 2 + prog * PI2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#fb923c';
        ctx.stroke();
        // 岩浆球从空中坠落
        const sr = 5 + 13 * (1 - prog);
        ctx.beginPath();
        ctx.arc(h.x, h.y - 150 * (1 - prog), sr, 0, PI2);
        ctx.fillStyle = '#f97316';
        ctx.shadowColor = '#fb923c'; fxBlur(12);
        ctx.fill();
        fxBlur(0);
        ctx.globalAlpha = 1;
      } else {
        const k = clamp(h.boomT / 0.35, 0, 1);
        ctx.globalAlpha = k;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r * (1.15 - 0.3 * k), 0, PI2);
        ctx.fillStyle = 'rgba(251,146,60,0.55)';
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

    // 飞行单位：悬浮起伏（地面投影留在原地）
    const yy = u.fly ? y - 14 + Math.sin(state.time * 4 + (u.bob || 0)) * 4 : y;

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + u.r * 0.9 + (u.fly ? 10 : 0), u.r * (u.fly ? 0.55 : 0.8), u.r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 身体：优先用角色素材图片（未加载完时回退圆形+emoji）
    const sprite = G.sprites && G.sprites.getSprite ? G.sprites.getSprite(u, isPlayer) : null;
    if (sprite) {
      // 显示尺寸：高度按角色半径放大，BOSS 更大、飞行单位略小
      const scale = (u.type === 'boss' ? 3.1 : (u.fly ? 2.2 : 2.5));
      const h = u.r * scale;
      const w = h * (sprite.width / sprite.height);
      // 翻面：玩家按攻击方向，敌人按玩家方位；同时考虑每个素材的原图朝向
      const baseFace = G.sprites.baseFace ? G.sprites.baseFace(u, isPlayer) : -1;
      let face = 1;
      if (isPlayer) {
        const m = G.engine.mouse;
        if (m && m.active) face = spriteFace(x, m.cx + cam.x, baseFace);
        else {
          const t = G.nearestFoe ? G.nearestFoe(state.player) : null;
          face = t ? spriteFace(x, t.x, baseFace) : 1;
        }
      } else {
        const p = state.player;
        face = p ? spriteFace(x, p.x, baseFace) : 1;
      }
      ctx.save();
      ctx.translate(x, yy);
      ctx.scale(face, 1);
      ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
      ctx.restore();
      // 受击闪白：在图片位置叠一个白色圆点提示，避免改全局合成模式
      if (u.flashT > 0) {
        ctx.save();
        ctx.globalAlpha = alpha * 0.75;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(x, yy, u.r * 0.85, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      // 精英金色描边光环（保留原有辨识度）
      if (u.elite && u.type !== 'boss') {
        ctx.beginPath();
        ctx.arc(x, yy, u.r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(251,191,36,0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else {
      // 回退：原圆形+emoji
      ctx.beginPath();
      ctx.arc(x, yy, u.r, 0, Math.PI * 2);
      const bodyC = {
        boss: '#dc2626', mage: '#8b5cf6', mimic: '#d97706', ranged: '#b45309',
        melee: '#92400e', brute: '#78350f', flyer: '#0369a1',
        npc: '#16a34a', companion: '#f59e0b', crystal: '#7c3aed'
      }[u.type] || '#b45309';
      ctx.fillStyle = u.flashT > 0 ? '#ffffff' : (isPlayer ? '#3b82f6' : bodyC);
      ctx.fill();
      ctx.lineWidth = isPlayer ? 2.5 : 2;
      ctx.strokeStyle = isPlayer ? '#93c5fd' : (u.type === 'boss' ? '#fca5a5' : (u.elite ? '#fbbf24' : '#d9a05b'));
      ctx.stroke();
      ctx.font = Math.round(u.r * 1.25) + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(u.emoji || '?', x, yy + 1);
    }

    // 护盾环
    if (u.shield > 0) {
      ctx.beginPath();
      ctx.arc(x, yy, u.r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(125,211,252,0.85)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // 法师闪现前摇：紫色虚线圈
    if (u.blinkWarnT > 0) {
      ctx.beginPath();
      ctx.arc(x, yy, u.r + 9, 0, Math.PI * 2);
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(192,132,252,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 血条
    const bw = u.r * 2.2, bh = 4;
    const bx = x - bw / 2, by = yy - u.r - 14;
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
      const isUltArrow = b.side === 'p' && !!b.ultPierceNoDecay;   // 终极·贯穿诸天
      const isUltDrone = b.side === 'p' && !!b.ult;                 // 终极·浮游炮阵

      if (isUltArrow) {
        // 终极箭矢：金红长箭，沿飞行方向的拉长箭身 + 火焰拖尾
        const ang = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        // 火焰拖尾
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ef4444';
        ctx.shadowColor = '#f97316'; fxBlur(12);
        ctx.beginPath();
        ctx.moveTo(-6, 0); ctx.lineTo(-26, -2.5); ctx.lineTo(-26, 2.5);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        // 金色箭身（梭形）
        ctx.shadowColor = '#fbbf24'; fxBlur(14);
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.moveTo(11, 0); ctx.lineTo(-4, -3); ctx.lineTo(-8, 0); ctx.lineTo(-4, 3);
        ctx.closePath(); ctx.fill();
        // 箭尖白芒
        ctx.fillStyle = '#fffbeb'; fxBlur(6);
        ctx.beginPath(); ctx.arc(9, 0, 2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        return;
      }
      if (isUltDrone) {
        // 终极浮游炮弹：金色菱形穿透弹 + 尾迹
        const ang = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.translate(x, y); ctx.rotate(ang);
        ctx.globalAlpha = 0.4; ctx.fillStyle = '#fbbf24'; fxBlur(0);
        ctx.fillRect(-18, -1, 16, 2);
        ctx.globalAlpha = 1;
        ctx.shadowColor = '#fbbf24'; fxBlur(16);
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.moveTo(7, 0); ctx.lineTo(0, -4); ctx.lineTo(-6, 0); ctx.lineTo(0, 4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; fxBlur(6);
        ctx.beginPath(); ctx.arc(1, 0, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        return;
      }
      // 普通弹幕
      ctx.beginPath();
      ctx.arc(x, y, b.r, 0, Math.PI * 2);
      if (b.side === 'p') {
        ctx.fillStyle = b.crit ? '#fbbf24' : (b.color || '#7dd3fc');
        ctx.shadowColor = b.crit ? '#f59e0b' : (b.color || '#38bdf8');
      } else {
        ctx.fillStyle = '#fb7185';
        ctx.shadowColor = '#f43f5e';
      }
      fxBlur(8);
      ctx.fill();
      fxBlur(0);
    });
  }

  /** 火球（飞行中）：普通=橙色火球+拖尾；终极·陨火焚天=旋转火焰纹陨星+流星尾迹+环绕火种 */
  function drawFireballs() {
    (state.fireballs || []).forEach(f => {
      ctx.save();
      const ang = Math.atan2(f.vy, f.vx);
      ctx.translate(f.x, f.y);
      ctx.rotate(ang);
      if (f.ult) {
        const t = state.time || 0;
        const lowFx = !!(CFG.perf && CFG.perf.lowFx);
        // 流星尾迹：多层渐隐的火焰锥，沿飞行反方向拉长
        const tails = lowFx ? 2 : 4;
        for (let i = 1; i <= tails; i++) {
          const len = f.r * (1.4 + i * 1.1);
          const wid = f.r * (0.85 - i * 0.13);
          ctx.globalAlpha = 0.42 - i * 0.07;
          ctx.fillStyle = i < 2 ? '#fde68a' : (i < 3 ? '#fbbf24' : '#f97316');
          ctx.shadowColor = '#f59e0b'; fxBlur(lowFx ? 0 : 10);
          ctx.beginPath();
          ctx.moveTo(-f.r * 0.35, 0);
          ctx.lineTo(-len, -wid); ctx.lineTo(-len * 0.82, 0); ctx.lineTo(-len, wid);
          ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // 陨星本体：暗红岩核 + 金焰外壳
        ctx.shadowColor = '#f59e0b'; fxBlur(lowFx ? 0 : 22);
        ctx.fillStyle = '#7c2d12';
        ctx.beginPath(); ctx.arc(0, 0, f.r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowColor = '#fbbf24'; fxBlur(lowFx ? 0 : 14);
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath(); ctx.arc(0, 0, f.r * 0.88, 0, Math.PI * 2); ctx.fill();
        // 旋转火焰纹：三条随帧旋转的弧形焰痕（用固定 t 作种子，逐帧连续）
        ctx.save();
        ctx.rotate(-t * 5.5);
        ctx.strokeStyle = '#fef3c7'; ctx.lineWidth = 2;
        ctx.shadowColor = '#fde68a'; fxBlur(lowFx ? 0 : 8);
        for (let i = 0; i < 3; i++) {
          ctx.rotate(Math.PI * 2 / 3);
          ctx.beginPath(); ctx.arc(0, 0, f.r * 0.62, -1.0, 0.55); ctx.stroke();
        }
        ctx.restore();
        // 白热核心
        ctx.shadowColor = '#fff7ed'; fxBlur(lowFx ? 0 : 8);
        ctx.fillStyle = '#fffbeb';
        ctx.beginPath(); ctx.arc(1, 0, f.r * 0.34, 0, Math.PI * 2); ctx.fill();
        // 环绕小火种：绕本体公转的火星
        const seeds = lowFx ? 3 : 5;
        ctx.shadowColor = '#fb923c'; fxBlur(lowFx ? 0 : 8);
        ctx.fillStyle = '#fdba74';
        for (let i = 0; i < seeds; i++) {
          const a = t * 6 + i * Math.PI * 2 / seeds;
          const rr = f.r * 1.65;
          ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 2.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        return;
      }
      // 普通火球
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.moveTo(-6, 0); ctx.lineTo(-24, -4); ctx.lineTo(-24, 4);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowColor = '#f97316'; fxBlur(12);
      ctx.fillStyle = '#fdba74';
      ctx.beginPath(); ctx.arc(0, 0, f.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = '#fef3c7'; fxBlur(6);
      ctx.fillStyle = '#fff7ed';
      ctx.beginPath(); ctx.arc(1, 0, f.r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
  }

  /** 回旋镖：普通=V 形飞刃去回异色；终极·无尽回旋=三叶金刃+刃口高光+飞行残影+四段配色 */
  const BOOMERANG_ULT_COLORS = ['#fde68a', '#fbbf24', '#fb923c', '#fcd34d'];  // 4 段往返各自配色
  function drawBoomerangs() {
    (state.boomerangs || []).forEach(b => {
      ctx.save();
      ctx.translate(b.x, b.y);
      const back = b.phase === 1;
      if (b.ult) {
        const lowFx = !!(CFG.perf && CFG.perf.lowFx);
        const col = BOOMERANG_ULT_COLORS[(b.legIdx || 0) % BOOMERANG_ULT_COLORS.length];
        // 飞行残影：沿转向反方向拖出几片渐隐刀影
        const ghosts = lowFx ? 1 : 3;
        for (let g = 1; g <= ghosts; g++) {
          ctx.save();
          ctx.rotate(b.rot - g * (back ? 0.32 : -0.32));
          ctx.globalAlpha = 0.3 - g * 0.075;
          ctx.strokeStyle = col; ctx.lineWidth = 5 - g;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(-11, -11); ctx.lineTo(0, 3); ctx.lineTo(11, -11);
          ctx.stroke();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        ctx.rotate(b.rot);
        // 三叶金刃：三片旋翼，每片带刃口高光
        ctx.shadowColor = '#f59e0b'; fxBlur(lowFx ? 0 : 16);
        for (let i = 0; i < 3; i++) {
          ctx.save();
          ctx.rotate(i * Math.PI * 2 / 3);
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(0, 0); ctx.lineTo(-4.5, -14); ctx.lineTo(4.5, -14);
          ctx.closePath(); ctx.fill();
          // 刃口高光
          ctx.shadowColor = '#fffbeb'; fxBlur(lowFx ? 0 : 6);
          ctx.strokeStyle = '#fffbeb'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(-3.5, -12); ctx.lineTo(3.5, -12); ctx.stroke();
          ctx.restore();
        }
        // 中心轴心
        ctx.shadowColor = '#fef3c7'; fxBlur(lowFx ? 0 : 10);
        ctx.fillStyle = '#fff7ed';
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        return;
      }
      // 普通回旋镖：V 形飞刃，去程红/回程青
      ctx.rotate(b.rot);
      ctx.strokeStyle = back ? '#67e8f9' : '#fca5a5';
      ctx.shadowColor = back ? '#22d3ee' : '#f87171';
      fxBlur(9);
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-10, -10); ctx.lineTo(0, 2); ctx.lineTo(10, -10);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawOrbitBlades() {
    const p = state.player;
    if (!p || !p.orbits || p.dead) return;
    const blades = G.orbitPositions(p);
    const isUlt = !!(p.sk && p.sk.orbit && p.sk.orbit.ultPersistent);

    if (isUlt) {
      // ===== 终极·无尽刃环「剑阵」=====
      const R = p.orbitR || 64;
      const spd = p.orbitSpd || 2.4;
      const t = state.time;
      ctx.save();
      ctx.translate(p.x, p.y);

      // 三层能量轨道：半径/方向/速度与 orbitPositions 的三层刀阵严格对应
      const rings = [
        { rr: R,        sp:  1.0,  dash: [12, 16], col: 'rgba(251,191,36,0.34)' },  // 主环 正转
        { rr: R * 1.32, sp: -0.72, dash: [8, 12],  col: 'rgba(249,115,22,0.32)' },  // 外环 反转
        { rr: R * 0.5,  sp: -1.45, dash: [3, 8],   col: 'rgba(253,230,138,0.30)' }   // 内环 反转
      ];
      ctx.shadowColor = '#fbbf24'; fxBlur(16); ctx.lineWidth = 1.6;
      rings.forEach(rg => {
        ctx.save();
        ctx.rotate(t * spd * rg.sp);
        ctx.strokeStyle = rg.col;
        ctx.setLineDash(rg.dash);
        ctx.beginPath(); ctx.arc(0, 0, rg.rr, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      });
      ctx.setLineDash([]);

      // 中心悬浮剑核：旋转四芒星 + 光晕 + 内层菱形
      ctx.save();
      ctx.rotate(t * spd * 1.6);
      ctx.shadowColor = '#fde68a'; fxBlur(22);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      for (let s = 0; s < 4; s++) {
        const a = s * Math.PI / 2;
        const ax = Math.cos(a), ay = Math.sin(a);
        const px = -ay, py = ax;
        ctx.moveTo(ax * 15, ay * 15);
        ctx.lineTo(px * 3.5 + ax * 3, py * 3.5 + ay * 3);
        ctx.lineTo(ax * 3, ay * 3);
        ctx.lineTo(-px * 3.5 + ax * 3, -py * 3.5 + ay * 3);
      }
      ctx.closePath(); ctx.fill();
      ctx.rotate(-t * spd * 3.2);
      fxBlur(8); ctx.fillStyle = '#fffbeb';
      ctx.beginPath();
      ctx.moveTo(0, -6); ctx.lineTo(4.5, 0); ctx.lineTo(0, 6); ctx.lineTo(-4.5, 0);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.restore();

      // 刀刃：用实际命中位置，画华丽回旋镖 + 长残影 + 卫星光点
      // ring0 主环金色 / ring1 外环橙红 / ring2 内环亮白金；dir=-1 的环切线朝向相反
      blades.forEach((b, idx) => {
        if (G.bladeBlocked && G.bladeBlocked(b.x, b.y)) return;   // 撞墙消失（不绘制）
        const ang = Math.atan2(b.y - p.y, b.x - p.x) + (b.dir || 1) * Math.PI / 2;
        const ring = b.ring || 0;
        const bladeCol = ring === 1 ? '#fb923c' : ring === 2 ? '#fde68a' : '#fbbf24';
        const glowCol = ring === 1 ? '#f97316' : ring === 2 ? '#fde68a' : '#fbbf24';
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(ang);
        // 残影（沿切线反方向四段）
        fxBlur(0);
        for (let s = 4; s >= 1; s--) {
          ctx.globalAlpha = 0.09 * (5 - s);
          ctx.fillStyle = bladeCol;
          ctx.beginPath();
          ctx.moveTo(-18 - s * 10, -2);
          ctx.lineTo(-8 - s * 10, 0);
          ctx.lineTo(-18 - s * 10, 2);
          ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // 回旋镖刀刃（双翼弯刀）
        ctx.shadowColor = glowCol; fxBlur(20);
        ctx.fillStyle = bladeCol;
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.quadraticCurveTo(2, -10, -12, -6);
        ctx.quadraticCurveTo(-4, -1, -12, 6);
        ctx.quadraticCurveTo(2, 10, 14, 0);
        ctx.closePath(); ctx.fill();
        // 刃口中脊白光
        fxBlur(6); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-6, 0); ctx.stroke();
        ctx.restore();

        // 卫星光点（每枚刀刃配一颗沿椭圆微绕的光点）
        const wa = t * spd * 2 + idx * 1.3;
        ctx.save();
        ctx.shadowColor = glowCol; fxBlur(10);
        ctx.fillStyle = ring === 1 ? '#ffedd5' : '#fffbeb';
        ctx.beginPath();
        ctx.arc(b.x + Math.cos(wa) * 12, b.y + Math.sin(wa) * 12, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
      return;
    }

    // 普通飞刃：青色小矩形
    blades.forEach(b => {
      if (G.bladeBlocked && G.bladeBlocked(b.x, b.y)) return;   // 撞墙消失（不绘制）
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(state.time * 8);
      ctx.fillStyle = '#67e8f9';
      ctx.shadowColor = '#22d3ee';
      fxBlur(6);
      ctx.fillRect(-8, -3, 16, 6);
      fxBlur(0);
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
        fxBlur(10);
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        fxBlur(0);
        ctx.fillStyle = '#4c1d95';
        ctx.fillRect(-2, -2, 4, 4);
        ctx.restore();
      }
    }

    // 技能特效
    (state.skillFx || []).forEach(fx => {
      if (fx.delay > 0) return;
      const k = clamp(fx.t / fx.dur, 0, 1);
      if (fx.kind === 'iceShatter') {
        // 冰柱碎裂：冰蓝冲击环向外扩张 + 放射冰屑
        ctx.save();
        const a = 1 - k;
        const r = fx.r * (0.35 + k * 0.75);
        ctx.beginPath(); ctx.arc(fx.x, fx.y, r, 0, PI2);
        ctx.fillStyle = 'rgba(186,230,253,' + (0.22 * a) + ')'; ctx.fill();
        ctx.strokeStyle = 'rgba(224,242,254,' + a + ')';
        ctx.lineWidth = 4 * a + 1;
        ctx.shadowColor = '#bae6fd'; fxBlur(14);
        ctx.stroke();
        fxBlur(0);
        const shards = 10;
        for (let i = 0; i < shards; i++) {
          const ang = (i / shards) * PI2 + fx.r;
          const rr = r * (0.8 + 0.35 * ((i % 3) / 3));
          const sx = fx.x + Math.cos(ang) * rr, sy = fx.y + Math.sin(ang) * rr;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(ang) * (6 * a + 2), sy + Math.sin(ang) * (6 * a + 2));
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.85 * a) + ')';
          ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.restore();
      } else if (fx.kind === 'fireballBoom') {
        ctx.save();
        if (fx.ult) {
          // 终极·陨火焚天：前半段坍缩聚光，后半段炸开双层火环 + 放射火星
          const lowFx = !!(CFG.perf && CFG.perf.lowFx);
          const PHASE = 0.32;
          if (k < PHASE) {
            // —— 坍缩：外圈火环向内收，核心越来越亮 ——
            const ck = k / PHASE;
            const cr = fx.r * (0.62 - 0.55 * ck);
            ctx.globalAlpha = 1 - ck * 0.25;
            ctx.shadowColor = '#fbbf24'; fxBlur(lowFx ? 0 : 26);
            ctx.fillStyle = '#fef3c7';
            ctx.beginPath(); ctx.arc(fx.x, fx.y, Math.max(2, cr), 0, Math.PI * 2); ctx.fill();
            // 汇聚的火星线（角度确定，逐帧稳定）
            const n = lowFx ? 6 : 12;
            ctx.strokeStyle = 'rgba(253,224,71,0.8)'; ctx.lineWidth = 2;
            ctx.shadowColor = '#f59e0b'; fxBlur(lowFx ? 0 : 10);
            for (let i = 0; i < n; i++) {
              const a2 = i * Math.PI * 2 / n;
              const d0 = fx.r * (0.92 - ck * 0.55);
              ctx.beginPath();
              ctx.moveTo(fx.x + Math.cos(a2) * d0, fx.y + Math.sin(a2) * d0);
              ctx.lineTo(fx.x + Math.cos(a2) * cr, fx.y + Math.sin(a2) * cr);
              ctx.stroke();
            }
          } else {
            // —— 爆发：双层扩张火环 + 白芯环 + 放射火星 ——
            const bk = (k - PHASE) / (1 - PHASE);
            const a = 1 - bk;
            const R = fx.r * (0.2 + bk * 1.05);
            ctx.shadowColor = '#f97316'; fxBlur(lowFx ? 0 : 26);
            ctx.strokeStyle = 'rgba(249,115,22,' + a + ')';
            ctx.lineWidth = 14 * a + 3;
            ctx.beginPath(); ctx.arc(fx.x, fx.y, R, 0, Math.PI * 2); ctx.stroke();
            ctx.shadowColor = '#fbbf24'; fxBlur(lowFx ? 0 : 18);
            ctx.strokeStyle = 'rgba(253,224,71,' + (a * 0.92) + ')';
            ctx.lineWidth = 6 * a + 2;
            ctx.beginPath(); ctx.arc(fx.x, fx.y, R * 0.72, 0, Math.PI * 2); ctx.stroke();
            ctx.shadowColor = '#fef3c7'; fxBlur(lowFx ? 0 : 8);
            ctx.strokeStyle = 'rgba(255,251,235,' + (a * 0.85) + ')';
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.arc(fx.x, fx.y, R * 0.88, 0, Math.PI * 2); ctx.stroke();
            fxBlur(0);
            ctx.fillStyle = 'rgba(251,146,60,' + (0.18 * a) + ')';
            ctx.beginPath(); ctx.arc(fx.x, fx.y, R, 0, Math.PI * 2); ctx.fill();
            // 放射火星
            const n = lowFx ? 6 : 12;
            ctx.shadowColor = '#fbbf24'; fxBlur(lowFx ? 0 : 8);
            ctx.fillStyle = 'rgba(253,224,71,' + a + ')';
            for (let i = 0; i < n; i++) {
              const a2 = i * Math.PI * 2 / n + 0.2;
              const rd = R * (0.82 + (i % 3) * 0.13);
              ctx.beginPath();
              ctx.arc(fx.x + Math.cos(a2) * rd, fx.y + Math.sin(a2) * rd, 2.4 * a + 0.8, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else {
          // 普通火球爆炸
          const a = 1 - k;
          const r = fx.r * (0.35 + k * 0.75);
          ctx.beginPath(); ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(249,115,22,' + (0.28 * a) + ')'; ctx.fill();
          ctx.shadowColor = '#f97316'; fxBlur(16);
          ctx.strokeStyle = 'rgba(251,146,60,' + a + ')';
          ctx.lineWidth = 8 * a + 2; ctx.stroke();
        }
        ctx.restore();
      } else if (fx.kind === 'shock' || fx.kind === 'shockEcho') {
        const isEcho = fx.kind === 'shockEcho';
        // 主波用逐帧推进的真实波面半径；echo/旧特效沿用进度动画半径
        const waveR = fx.wave ? fx.wave.r : fx.r * (0.3 + k * 0.7);
        const a = 1 - k;
        if (fx.ult) {
          // 终极·湮灭冲击：金红双层扩散环 + 向内坍缩的二次环 + 灼热填充
          ctx.save();
          ctx.shadowColor = '#f59e0b'; fxBlur(30);
          // 外层金色冲击环
          ctx.beginPath(); ctx.arc(fx.x, fx.y, waveR, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(251,191,36,' + a + ')';
          ctx.lineWidth = 12 * a + 3; ctx.stroke();
          // 中层赤红环
          ctx.shadowColor = '#ef4444'; fxBlur(18);
          ctx.beginPath(); ctx.arc(fx.x, fx.y, waveR * 0.88, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(239,68,68,' + (a * 0.85) + ')';
          ctx.lineWidth = 5 * a + 2; ctx.stroke();
          // 白色高能芯环
          ctx.shadowColor = '#fde68a'; fxBlur(8);
          ctx.beginPath(); ctx.arc(fx.x, fx.y, waveR * 0.96, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,251,235,' + a + ')'; ctx.lineWidth = 2; ctx.stroke();
          // 向内坍缩的二次环（越到后期越往中心收）
          if (!isEcho) {
            const cr = fx.r * (0.7 - k * 0.5);
            ctx.beginPath(); ctx.arc(fx.x, fx.y, Math.max(4, cr), 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(253,224,71,' + (a * 0.6) + ')';
            ctx.lineWidth = 2 * a + 1; ctx.stroke();
          }
          // 灼热填充
          fxBlur(0);
          ctx.beginPath(); ctx.arc(fx.x, fx.y, waveR, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(249,115,22,' + (0.1 * a) + ')'; ctx.fill();
          ctx.restore();
        } else {
          // 普通震荡波：外发光粗环 + 内层白芯 + 半透明填充
          const r = waveR;
          ctx.save();
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
          ctx.shadowColor = isEcho ? '#60a5fa' : '#38bdf8';
          fxBlur(isEcho ? 12 : 22);
          if (isEcho) ctx.setLineDash([8, 6]);
          ctx.strokeStyle = isEcho ? 'rgba(147,197,253,' + a + ')' : 'rgba(125,211,252,' + a + ')';
          ctx.lineWidth = (isEcho ? 5 : 9) * a + 2;
          ctx.stroke();
          ctx.setLineDash([]);
          if (!isEcho) {
            fxBlur(8);
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, r * 0.82, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,' + (0.85 * a) + ')';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            fxBlur(0);
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(125,211,252,' + (0.09 * a) + ')';
            ctx.fill();
          }
          ctx.restore();
        }
      } else if (fx.kind === 'chain') {
        if (fx.ult) {
          // 终极·雷狱：雷云蓝外晕 + 青蓝主干 + 白芯，附带随机分叉与节点爆闪
          const a = 1 - k;
          ctx.save();
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          const strokePts = () => {
            ctx.beginPath();
            ctx.moveTo(fx.pts[0].x, fx.pts[0].y);
            for (let i = 1; i < fx.pts.length; i++) ctx.lineTo(fx.pts[i].x, fx.pts[i].y);
          };
          // 外层雷云辉光
          strokePts();
          ctx.shadowColor = '#6366f1'; fxBlur(34);
          ctx.strokeStyle = 'rgba(99,102,241,' + (a * 0.75) + ')';
          ctx.lineWidth = 16 * a + 5; ctx.stroke();
          // 中层青蓝主干
          strokePts();
          ctx.shadowColor = '#38bdf8'; fxBlur(18);
          ctx.strokeStyle = 'rgba(56,189,248,' + a + ')';
          ctx.lineWidth = 8 * a + 3; ctx.stroke();
          // 白色核心
          strokePts();
          fxBlur(6);
          ctx.strokeStyle = 'rgba(255,255,255,' + a + ')';
          ctx.lineWidth = 2.5; ctx.stroke();
          // 沿主干节点的随机分叉电弧（用 t 作种子，逐帧稳定）
          fxBlur(10);
          ctx.shadowColor = '#a5f3fc';
          ctx.strokeStyle = 'rgba(165,243,252,' + (a * 0.8) + ')';
          ctx.lineWidth = 1.5;
          for (let i = 1; i < fx.pts.length; i++) {
            const P = fx.pts[i], Q = fx.pts[i - 1];
            const ang = Math.atan2(P.y - Q.y, P.x - Q.x);
            for (let s = -1; s <= 1; s += 2) {
              const len = 14 + ((i * 7 + (s + 1) * 3) % 12);
              const ba = ang + s * (0.7 + ((i % 3) * 0.15));
              ctx.beginPath();
              ctx.moveTo(P.x, P.y);
              ctx.lineTo(P.x + Math.cos(ba) * len, P.y + Math.sin(ba) * len);
              ctx.lineTo(P.x + Math.cos(ba + s * 0.3) * len * 1.4, P.y + Math.sin(ba + s * 0.3) * len * 1.4);
              ctx.stroke();
            }
          }
          ctx.restore();
        } else {
          // 普通锯齿电弧：外层紫色辉光 + 内层白色核心
          ctx.save();
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(fx.pts[0].x, fx.pts[0].y);
          for (let i = 1; i < fx.pts.length; i++) ctx.lineTo(fx.pts[i].x, fx.pts[i].y);
          ctx.shadowColor = '#a78bfa';
          fxBlur(18);
          ctx.strokeStyle = 'rgba(167,139,250,' + (1 - k) + ')';
          ctx.lineWidth = 6 * (1 - k) + 2;
          ctx.stroke();
          fxBlur(8);
          ctx.strokeStyle = 'rgba(255,255,255,' + (1 - k) + ')';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      } else if (fx.kind === 'zap') {
        const a = 1 - k;
        if (fx.ult) {
          // 终极·雷狱命中：扩散电环 + 白芯 + 四向星芒
          ctx.save();
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, fx.r * (0.3 + k * 0.9), 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(99,102,241,' + (a * 0.8) + ')';
          ctx.shadowColor = '#6366f1'; fxBlur(22);
          ctx.lineWidth = 3 * a + 1; ctx.stroke();
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, fx.r * 0.55, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(125,211,252,' + (a * 0.45) + ')';
          ctx.shadowColor = '#38bdf8'; fxBlur(18); ctx.fill();
          // 四向星芒
          fxBlur(10); ctx.shadowColor = '#e0f2fe';
          ctx.strokeStyle = 'rgba(255,255,255,' + a + ')';
          ctx.lineWidth = 2;
          const R = fx.r * (0.6 + k * 0.6);
          for (let d = 0; d < 4; d++) {
            const ang = d * Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(fx.x + Math.cos(ang) * fx.r * 0.2, fx.y + Math.sin(ang) * fx.r * 0.2);
            ctx.lineTo(fx.x + Math.cos(ang) * R, fx.y + Math.sin(ang) * R);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, fx.r * 0.28 * a, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
          fxBlur(8); ctx.fill();
          ctx.restore();
        } else {
          // 普通命中点闪光
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, fx.r * (0.4 + k * 0.8), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(196,181,253,' + a * 0.75 + ')';
          ctx.shadowColor = '#a78bfa';
          fxBlur(14);
          ctx.fill();
          fxBlur(0);
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, fx.r * 0.4 * a, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
          ctx.fill();
        }
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
     任务实体：解救俘虏（囚徒+守卫）/ 同伴 / 流星
     ========================================================= */
  function drawTasks() {
    const t = state.task;
    if (t && t.kind === 'escort' && t.npc) {
      // 囚徒：脚下一圈锁链囚笼 + 头顶锁链标记
      drawUnit(t.npc, false);
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.55)';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(t.npc.x, t.npc.y, t.npc.r + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('⛓ 待解救', t.npc.x, t.npc.y - t.npc.r - 26);
      ctx.restore();
    }
    // 守卫头顶「守卫」标记，方便玩家识别清怪目标
    if (t && t.kind === 'escort' && t.guards) {
      t.guards.forEach(g => {
        if (g.dead) return;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f87171';
        ctx.fillText('🔒守卫', g.x, g.y - g.r - 20);
      });
    }
    if (state.companion) drawUnit(state.companion, false);
    if (t && t.kind === 'stars') {
      t.stars.forEach(s => {
        if (s.taken) return;
        const bob = Math.sin(state.time * 3 + s.t) * 4;
        ctx.globalAlpha = t.time < 4 && Math.floor(state.time * 5) % 2 === 0 ? 0.4 : 1;
        ctx.font = '24px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#fde047';
        fxBlur(14);
        ctx.fillText('✦', s.x, s.y + bob);
        fxBlur(0);
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 36, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(253,224,71,0.28)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }
  }

  /* =========================================================
     任务 HUD（屏幕顶部居中）
     ========================================================= */
  function drawTaskHud() {
    const t = state.task;
    if (!t) return;
    const names = { escort: '⛓ 解救俘虏', defense: '💀 怪潮防守', crystal: '🔮 摧毁水晶', stars: '✦ 流星采集' };
    let obj = '';
    if (t.kind === 'escort' && t.npc) obj = '守卫剩余 ×' + (t.guards ? t.guards.filter(g => !g.dead).length : 0);
    else if (t.kind === 'crystal') obj = '剩余水晶 ×' + t.crystals.filter(c => !c.dead).length;
    else if (t.kind === 'stars') obj = '已收集 ' + t.taken + '/2';
    else obj = '存活到时限';
    const V = CFG.viewport;
    const text = (names[t.kind] || '任务') + ' · ' + Math.ceil(Math.max(0, t.time)) + 's · ' + obj;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 4;
    ctx.strokeText(text, V.w / 2, 14);
    ctx.fillStyle = '#fde047';
    ctx.fillText(text, V.w / 2, 14);
    // 进度条
    const w = 190, x0 = V.w / 2 - w / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x0, 38, w, 5);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(x0, 38, w * Math.max(0, t.time / t.total), 5);
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
      fxBlur(12);
      ctx.fillText('📦', c.x, c.y + bob);
      fxBlur(0);
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
      const color = s.evt.color || '#a78bfa';   // 祭坛红/歧路金/商人紫/泉水绿
      // 光柱底座：按事件类型区分颜色，远远就能判断值不值得绕路
      ctx.beginPath();
      ctx.arc(s.x, s.y, CFG.events.triggerR * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.09;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = '26px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = color;
      fxBlur(14);
      ctx.fillText(s.evt.icon, s.x, s.y);
      fxBlur(0);
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
      ctx.fillStyle = s.evt.color || '#a78bfa';
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
    if (dpr !== 1 && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    drawTasks();
    drawSkills();
    drawFireballs();
    drawBoomerangs();
    drawBullets();
    drawMimicTelegraphs();
    state.foes.forEach(f => drawUnit(f, false));
    if (state.player) drawUnit(state.player, true);
    drawFloaters();
    ctx.restore();

    // 屏幕空间层
    drawMinimap();
    drawBanner();
    drawTaskHud();
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

  Object.assign(G, { render: { init, frame, spriteFace }, camera: cam });
})(window.ABYSS = window.ABYSS || {});
