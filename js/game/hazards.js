/* ============================================================
   游戏层 · hazards.js（地图特色机制）
   - 森林：无机制
   - 沼泽 poison：不规则毒池，进入中毒（每秒扣血 + 轻微减速）
   - 白骨森林 skeleton：骨堆召唤 + 频繁刷骷髅（无经验、血少、量大）
   - 冰川 ice：不规则冰面区域内惯性滑行（速度由 player 读取，区域仅区域内生效）
   - 火山 lava：天降岩浆（预警 → 爆发）
   灾害伤害为固定值（不受防御影响），尊重玩家无敌帧。
   无边界地图：地块哈希 → 位置在世界中固定，随玩家移动换入换出。
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG, clamp } = G;

  /** 当前地图的机制种类（无则返回 null） */
  function hazardKind() {
    const map = G.MAPS[state.mapIdx % G.MAPS.length];
    return map && map.hazard ? map.hazard : null;
  }

  /** 地块哈希：同一世界坐标恒定 */
  function cellHash(cx, cy, seed) {
    let h = (Math.imul(cx, 374761393) + Math.imul(cy, 668265263) + Math.imul(seed | 0, 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function setupHazards() {
    state.hazards = [];     // 临时灾害（岩浆：预警 → 爆发）
    state.zones = [];       // 持久区域（毒池）
    state.hazAnchors = [];  // 灾害锚点（供事件/任务选址；由地图机制与障碍同步）
    state.hazCells = {};    // 已生成地块
    state.hazT = 0;
    state.skelT = 0;
    state.hazAnchorIdx = 0;
  }

  /** 按玩家所在位置生成附近地块（无边界地图：换入换出，位置恒定） */
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

        if (kind === 'poison' || kind === 'ice') {
          if (chance < (H.cellChance || 0.5)) {
            const r = H.r0 + jr * (H.r1 - H.r0);
            // 不规则：用 6~9 个扰动半径的顶点构成多边形，边缘带毛刺
            const n = 6 + Math.floor(jr * 4);
            const pts = [];
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2 + jx * 0.5;
              const rr = r * (0.78 + cellHash(gx * 31 + i, gy * 17, mapSeed + 404) * 0.42);
              pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
            }
            state.zones.push({ kind, x, y, r, pts, seed: jr });
          }
        }
        // skeleton / lava 的机制不需要地块区域：骷髅靠计时生成，岩浆落点直接取玩家附近随机位置。
        // ice 的不规则冰面区域已按地块哈希生成，惯性仅在这些区域内生效。
      }
    }

    // 远离玩家回收
    const cull2 = T.cullRadius * T.cullRadius;
    const keep = (z) => (z.x - p.x) * (z.x - p.x) + (z.y - p.y) * (z.y - p.y) < cull2;
    state.zones = state.zones.filter(keep);

    // 同步灾害锚点：毒池/冰面中心 + 特色障碍物（骨堆/冰柱/熔岩块），供事件与任务选址
    state.hazAnchors = state.zones.filter(z => z.kind === 'poison' || z.kind === 'ice').map(z => ({ x: z.x, y: z.y }))
      .concat((state.obstacles || []).filter(o => o.obType && o.obType !== 'root' && o.obType !== 'stone')
        .map(o => ({ x: o.x, y: o.y })));
  }

  /** 点是否在多边形内（射线法） */
  function inPoly(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** 查询某点所在的指定类型区域（毒池/冰面） */
  function zoneAt(x, y, kind) {
    for (const z of state.zones) {
      if (z.kind !== kind) continue;
      if (inPoly(x, y, z.pts)) return z;
    }
    return null;
  }

  /** 查询某点所在的毒池（供移动减速与中毒结算共用） */
  function poisonZoneAt(x, y) {
    return zoneAt(x, y, 'poison');
  }

  /** 查询某点是否在冰面区域内（供玩家移动惯性判定） */
  function onIce(x, y) {
    return !!zoneAt(x, y, 'ice');
  }

  /** 毒池减速：在毒池内轻微减速（玩家与敌人都生效） */
  function zoneSlowMul(x, y) {
    const z = poisonZoneAt(x, y);
    return z ? (CFG.hazards.poison.slowMul || 1) : 1;
  }

  /** 生成一只骷髅（无经验、血少、量大） */
  function spawnSkeleton(x, y, range) {
    const H = CFG.hazards.skeleton;
    const p = state.player;
    if (!p || !H) return null;
    // 场上骷髅上限
    const alive = state.foes.filter(f => !f.dead && f.type === 'skeleton').length;
    if (alive >= H.cap) return null;
    const a = Math.random() * Math.PI * 2;
    const d = 60 + Math.random() * (range || 130);
    const minute = state.wave;
    const boost = 1 + CFG.mon.mapBoost * state.mapIdx;
    const u = G.makeEnemy(minute, 0, 'skeleton', a);
    u.x = x + Math.cos(a) * d;
    u.y = y + Math.sin(a) * d;
    // 骷髅-specific 数值：血少、攻低、略快、无经验
    u.maxHp = Math.max(6, Math.round(u.maxHp * H.hpMul * boost));
    u.hp = u.maxHp;
    u.atk = Math.max(1, Math.round(u.atk * H.atkMul));
    u.speed = (u.speed || CFG.melee.speed) * (H.speedMul || 1);
    u.xp = H.xp || 0;
    u.name = '骷髅';
    u.emoji = '💀';
    state.foes.push(u);
    return u;
  }

  /** 天降岩浆：在玩家附近随机落点，预警 → 爆发 */
  function spawnLava(minute) {
    const H = CFG.hazards.lava;
    const p = state.player;
    if (!p) return;
    const a = Math.random() * Math.PI * 2;
    const d = 80 + Math.random() * 260;
    state.hazards.push({
      kind: 'lava',
      x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d,
      r: H.r, t: 0, warn: H.warn, hit: false, boomT: 0,
      dmg: Math.round(H.dmg0 + (minute - 1) * H.dmgK)
    });
  }

  /* =========================================================
     主更新（flow.update 每帧调用）
     ========================================================= */
  function updateHazards(dt) {
    const p = state.player;
    if (!p || p.dead) return;
    ensureTerrainAroundPlayer();
    const kind = hazardKind();
    const H = CFG.hazards;
    const minute = state.wave;

    /* ---- 毒池：玩家与敌人中毒扣血（按 tick 结算） ---- */
    if (kind === 'poison') {
      state.hazT += dt;
      if (state.hazT >= H.poison.tick) {
        const dmg = Math.round(H.poison.dps + (minute - 1) * H.poison.dpsK);
        state.hazT = 0;
        if (poisonZoneAt(p.x, p.y)) {
          G.dealDamage(null, p, dmg, { flat: true, noThorn: true });
          G.floatText(p, '中毒 -' + dmg, '#a3e635');
        }
        for (const f of state.foes) {
          if (f.dead) continue;
          if (poisonZoneAt(f.x, f.y)) {
            G.dealDamage(null, f, dmg, { flat: true, noThorn: true });
            if (f.dead) f.hazardKilled = true;
          }
        }
      }
    }

    /* ---- 白骨森林：频繁刷骷髅 ---- */
    if (kind === 'skeleton') {
      state.skelT += dt;
      if (state.skelT >= H.skeleton.every) {
        state.skelT = 0;
        const n = Math.min(4, H.skeleton.batch + Math.floor((minute - 1) / H.skeleton.batchK));
        for (let i = 0; i < n; i++) spawnSkeleton(p.x, p.y, 340);
      }
    }

    /* ---- 火山：天降岩浆 ---- */
    if (kind === 'lava') {
      state.hazT += dt;
      if (state.hazT >= H.lava.every) {
        state.hazT = 0;
        spawnLava(minute);
      }
    }

    /* ---- 预警 → 爆发结算（岩浆） ---- */
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
            if (f.dead) f.hazardKilled = true;
          }
        }
      }
      if (h.hit) {
        h.boomT -= dt;
        if (h.boomT <= 0) state.hazards.splice(i, 1);
      }
    }
  }

  Object.assign(G, {
    cellHash, hazardKind, setupHazards, ensureTerrainAroundPlayer,
    zoneSlowMul, poisonZoneAt, zoneAt, onIce, inPoly, spawnSkeleton, spawnLava, updateHazards
  });
})(window.ABYSS = window.ABYSS || {});
