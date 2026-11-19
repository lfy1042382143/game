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

  /** 确定性伪随机（同一 seed 产生同一序列）——陷阱布局按地图固定 */
  function seededRand(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  /* =========================================================
     进入地图 / 开局：布置持久区域（泥潭 / 裂隙）与固定灾害锚点
     同一张地图的陷阱位置每次进入都完全一致（seeded by mapIdx）
     ========================================================= */
  function setupHazards() {
    state.hazards = [];     // 临时灾害实例（火球 / 骨刺：预警 → 爆发）
    state.zones = [];       // 持久区域（泥潭 / 裂隙）
    state.hazAnchors = [];  // 固定灾害锚点（骨刺 / 火球落点，按地图固定）
    state.hazAnchorIdx = 0;
    state.hazT = 0;
    const kind = hazardKind();
    if (!kind) return;
    const H = CFG.hazards[kind];
    const W = CFG.world;
    if (!H) return;

    const rnd = seededRand(9173 + state.mapIdx * 7919);

    /* ---- 持久区域（泥潭 / 裂隙）：固定位置 ---- */
    if (H.count) {
      for (let i = 0; i < H.count; i++) {
        const r = H.r * (0.8 + rnd() * 0.4);
        let x = 0, y = 0, tries = 0;
        // 避开地图正中心（玩家出生点）
        do {
          x = 100 + rnd() * (W.w - 200);
          y = 100 + rnd() * (W.h - 200);
        } while (G.dist(x, y, W.w / 2, W.h / 2) < r + 180 && tries++ < 40);
        state.zones.push({ kind, x, y, r });
      }
    }

    /* ---- 周期灾害锚点（骨刺 / 火球）：固定落点，爆发按锚点轮换 ---- */
    if (kind === 'spikes' || kind === 'fire') {
      const n = H.anchors || 10;
      for (let i = 0; i < n; i++) {
        let x = 0, y = 0, tries = 0;
        do {
          x = 90 + rnd() * (W.w - 180);
          y = 90 + rnd() * (W.h - 180);
        } while (G.dist(x, y, W.w / 2, W.h / 2) < 200 && tries++ < 40);
        state.hazAnchors.push({ x, y });
      }
    }
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
     周期灾害：在固定锚点生成预警圈（按顺序轮换，位置确定）
     ========================================================= */
  function spawnBurst(kind, minute) {
    const H = CFG.hazards[kind];
    if (!state.hazAnchors.length) return;
    const a = state.hazAnchors[state.hazAnchorIdx % state.hazAnchors.length];
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

  Object.assign(G, { hazardKind, setupHazards, zoneSlowMul, updateHazards, spawnBurst });
})(window.ABYSS = window.ABYSS || {});
