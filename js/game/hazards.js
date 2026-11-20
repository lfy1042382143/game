/* ============================================================
   游戏层 · hazards.js
   地图特色陷阱（初始地图「深渊洞窟」无陷阱）：
   - 荒芜骨林 spikes：骨刺突起，白色预警圈后扎出，伤害范围内的玩家与敌人
   - 熔岩裂隙 fire  ：火球不定时坠落，橙色预警圈 + 下落影子，落地爆炸
   - 虚空回廊 vortex：引力裂隙持续把玩家与敌人拉向中心
   - 腐雾沼泽 swamp ：减速泥潭，玩家与敌人在其中移动变慢
   灾害伤害为固定值（不受防御影响），尊重玩家无敌帧
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp } = G;

  /** 当前地图的陷阱种类（无则返回 null） */
  function hazardKind() {
    const map = G.MAPS[state.mapIdx % G.MAPS.length];
    return map.hazard || null;
  }

  /** 地块哈希：同一世界坐标恒定 → 陷阱位置在世界中固定，随玩家移动换入换出 */
  function cellHash(cx, cy, seed) {
    let h = (Math.imul(cx, 374761393) + Math.imul(cy, 668265263) + Math.imul(seed | 0, 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* =========================================================
     进入地图 / 开局：重置地块缓存（陷阱由玩家附近按需生成）
     ========================================================= */
  function setupHazards() {
    state.hazards = [];     // 临时灾害实例（火球 / 骨刺：预警 → 爆发）
    state.zones = [];       // 持久区域（泥潭 / 裂隙）
    state.hazAnchors = [];  // 固定灾害锚点（骨刺 / 火球落点）
    state.hazCells = {};    // 已生成的地块（key = "cx,cy"，位置在世界坐标中固定）
    state.hazAnchorIdx = 0;
    state.hazT = 0;
  }

  /** 按玩家所在位置生成附近地块（无边界地图：远近地块换入换出，位置恒定） */
  function ensureTerrainAroundPlayer() {
    const p = state.player;
    const kind = hazardKind();
    if (!p || !kind) return;
    const H = CFG.hazards[kind], T = CFG.terrain;
    if (!H) return;
    if (!state.hazCells) state.hazCells = {};

    const cell = T.cell;
    const ccx = Math.floor(p.x / cell), ccy = Math.floor(p.y / cell);
    const rad = Math.ceil(T.activeRadius / cell);
    const mapSeed = state.mapIdx + 1;

    for (let gx = ccx - rad; gx <= ccx + rad; gx++) {
      for (let gy = ccy - rad; gy <= ccy + rad; gy++) {
        const key = gx + ',' + gy;
        if (state.hazCells[key]) continue;
        state.hazCells[key] = true;

        const chance = cellHash(gx, gy, mapSeed);
        const jx = cellHash(gx, gy, mapSeed + 101);
        const jy = cellHash(gx, gy, mapSeed + 202);
        const jr = cellHash(gx, gy, mapSeed + 303);
        const x = gx * cell + 0.15 * cell + jx * 0.7 * cell;
        const y = gy * cell + 0.15 * cell + jy * 0.7 * cell;

        if (kind === 'swamp' || kind === 'vortex') {
          if (chance < 0.62) {
            state.zones.push({ kind, x, y, r: H.r * (0.8 + jr * 0.4) });
          }
        } else if (kind === 'spikes' || kind === 'fire') {
          if (chance < 0.75) state.hazAnchors.push({ x, y });
          if (chance < 0.28) {
            const x2 = gx * cell + 0.2 * cell + jr * 0.6 * cell;
            const y2 = gy * cell + 0.8 * cell - jx * 0.6 * cell;
            state.hazAnchors.push({ x: x2, y: y2 });
          }
        }
      }
    }

    // 远离玩家的区域回收（保持内存与数量稳定）
    const cull2 = T.cullRadius * T.cullRadius;
    const keep = (a) => (a.x - p.x) * (a.x - p.x) + (a.y - p.y) * (a.y - p.y) < cull2;
    state.zones = state.zones.filter(keep);
    state.hazAnchors = state.hazAnchors.filter(keep);
  }

  /* =========================================================
     减速查询：单位是否在减速泥潭中（供玩家与敌人移动调用）
     ========================================================= */
  function zoneSlowMul(x, y) {
    for (const z of state.zones) {
      if (z.kind === 'swamp' && G.dist(x, y, z.x, z.y) < z.r) {
        return CFG.hazards.swamp.slowMul;
      }
    }
    return 1;
  }

  /* =========================================================
     周期灾害：只在玩家附近的固定锚点轮换生成（远处锚点不触发）
     ========================================================= */
  function spawnBurst(kind, minute) {
    const H = CFG.hazards[kind];
    const p = state.player;
    if (!state.hazAnchors.length || !p) return;
    const near = state.hazAnchors.filter(a => G.dist(a.x, a.y, p.x, p.y) < CFG.terrain.activeRadius);
    if (!near.length) return;
    const a = near[state.hazAnchorIdx % near.length];
    state.hazAnchorIdx++;
    state.hazards.push({
      kind, x: a.x, y: a.y, r: H.r,
      t: 0, warn: H.warn, hit: false, boomT: 0,
      dmg: Math.round(H.dmg0 + (minute - 1) * H.dmgK)
    });
  }

  /* =========================================================
     主更新（由 flow.update 每帧调用）
     ========================================================= */
  function updateHazards(dt) {
    const p = state.player;
    if (!p || p.dead) return;
    ensureTerrainAroundPlayer();
    const kind = hazardKind();
    const H = CFG.hazards;
    const minute = state.wave;

    /* ---- 持久区域：引力裂隙拉拽玩家与敌人 ---- */
    for (const z of state.zones) {
      if (z.kind !== 'vortex') continue;
      const pull = H.vortex.pull;
      const dx = z.x - p.x, dy = z.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < z.r && d > 6) {
        p.x += (dx / d) * pull * dt;
        p.y += (dy / d) * pull * dt;
      }
      for (const f of state.foes) {
        if (f.dead) continue;
        const fx = z.x - f.x, fy = z.y - f.y;
        const fd = Math.sqrt(fx * fx + fy * fy);
        if (fd < z.r && fd > 6) {
          f.x += (fx / fd) * pull * dt;
          f.y += (fy / fd) * pull * dt;
        }
      }
    }

    /* ---- 周期灾害生成（骨刺 / 火球）：随分钟逐渐加密 ---- */
    if (kind === 'spikes' || kind === 'fire') {
      state.hazT += dt;
      const conf = H[kind];
      if (state.hazT >= conf.every) {
        state.hazT = 0;
        const n = Math.min(3, 1 + Math.floor((minute - 1) / 3));
        for (let i = 0; i < n; i++) spawnBurst(kind, minute);
      }
    }

    /* ---- 预警 → 爆发结算：命中范围内所有单位 ---- */
    for (let i = state.hazards.length - 1; i >= 0; i--) {
      const h = state.hazards[i];
      h.t += dt;
      if (!h.hit && h.t >= h.warn) {
        h.hit = true;
        h.boomT = 0.35;
        if (G.dist(p.x, p.y, h.x, h.y) < h.r + p.r) {
          G.dealDamage(null, p, h.dmg, { flat: true, noThorn: true });
        }
        for (const f of state.foes) {
          if (f.dead) continue;
          if (G.dist(f.x, f.y, h.x, h.y) < h.r + f.r) {
            G.dealDamage(null, f, h.dmg, { flat: true, noThorn: true });
          }
        }
      }
      if (h.hit) {
        h.boomT -= dt;
        if (h.boomT <= 0) state.hazards.splice(i, 1);
      }
    }
  }

  Object.assign(G, { cellHash, hazardKind, setupHazards, ensureTerrainAroundPlayer, zoneSlowMul, updateHazards, spawnBurst });
})(window.ABYSS = window.ABYSS || {});
