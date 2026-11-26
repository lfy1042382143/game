/* ============================================================
   游戏层 · loot.js（宝箱版 · 装备与战利品已移除）
   - 宝箱 = 一次免费升级三选一（与升级共用卡池/弹窗）
   - 精英怪击杀后原地掉落宝箱；有概率是宝箱怪（伪装突袭）
   - 装备实例、战利品弹窗、稀有度roll 全部删除
   ============================================================ */
(function (G) {
  'use strict';

  const { state, CFG } = G;

  /** 兼容旧调用：战利品已移除，恒为 0 */
  function lootPending() { return 0; }

  /* =========================================================
     宝箱
     ========================================================= */
  /** 开局引导宝箱：相对玩家环带随机位置（避开障碍） */
  function spawnChest() {
    const W = CFG.world, C = CFG.chests, p = state.player;
    for (let tries = 0; tries < 14; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = C.minDist + Math.random() * (C.maxDist - C.minDist);
      const x = Math.max(50, Math.min(W.w - 50, (p ? p.x : W.w / 2) + Math.cos(a) * d));
      const y = Math.max(50, Math.min(W.h - 50, (p ? p.y : W.h / 2) + Math.sin(a) * d));
      if (state.obstacles.some(o => G.circlePoly(x, y, 40, o))) continue;
      if (state.sites.some(s => G.dist(x, y, s.x, s.y) < 160)) continue;
      if (state.chests.some(c => G.dist(x, y, c.x, c.y) < 200)) continue;
      state.chests.push({ x, y, opened: false, t: Math.random() * 6, mimic: false });
      return true;
    }
    return false;
  }

  /** 精英怪击杀 → 原地掉落宝箱；有概率是宝箱怪 */
  function dropEliteLoot(unit) {
    const W = CFG.world;
    const x = Math.max(50, Math.min(W.w - 50, unit.x + (Math.random() * 24 - 12)));
    const y = Math.max(50, Math.min(W.h - 50, unit.y + (Math.random() * 24 - 12)));
    state.chests.push({
      x, y, opened: false, t: 0,
      mimic: Math.random() < (CFG.chests.mimicChance || 0)
    });
    state.banner = { text: '📦 宝箱掉落', sub: '精英被击败 · 前去拾取宝箱（开启获得强化）', t: 1.4 };
  }

  /** 玩家走近宝箱 → 开启 */
  function checkChests() {
    const p = state.player;
    if (!p || state.phase !== 'play') return;
    const C = CFG.chests;
    for (const c of state.chests) {
      if (c.opened) continue;
      if (G.dist(p.x, p.y, c.x, c.y) < C.pickupR) { openChest(c); return; }
    }
  }

  /** 开启宝箱：宝箱怪现形突袭，否则获得一次免费升级选项 */
  function openChest(chest) {
    chest.opened = true;
    state.chests = state.chests.filter(c => c !== chest);
    if (chest.mimic) { spawnMimic(chest); return; }
    G.sfxWin();
    grantChestUpgrade();
  }

  /** 宝箱奖励：+1 次免费升级选择（由 flow.update 统一弹出） */
  function grantChestUpgrade() {
    state.pendingChestUps = (state.pendingChestUps || 0) + 1;
  }

  /* =========================================================
     宝箱怪：伪装成宝箱的怪物（走近开箱瞬间现形）
     ========================================================= */
  function spawnMimic(chest) {
    const m = G.makeEnemy(state.wave, state.kills);
    m.x = chest.x; m.y = chest.y;
    m.type = 'mimic';
    m.speed = CFG.mimic.crawl;
    m.name = '宝箱怪';
    m.emoji = '🎁';
    m.baseHp = Math.round(m.baseHp * CFG.mimic.hpMul);
    m.baseAtk = Math.round(m.baseAtk * CFG.mimic.atkMul);
    m.xp = Math.round(m.xp * 2);
    m.mimic = true;
    m.lungeT = 1.1;
    m.tele = null;
    m.dash = null;
    G.refresh(m);
    state.foes.push(m);
    state.banner = { text: '🎁 是宝箱怪！', sub: '击杀它夺回真正的宝箱', t: 2 };
    G.sfxBoss();
  }

  /** 宝箱怪被击杀 → 原地掉落真宝箱 */
  function dropMimicLoot(unit) {
    const W = CFG.world;
    const x = Math.max(50, Math.min(W.w - 50, unit.x));
    const y = Math.max(50, Math.min(W.h - 50, unit.y));
    state.chests.push({ x, y, opened: false, t: 0, mimic: false });
    state.banner = { text: '📦 宝箱夺回', sub: '宝箱怪被击败 · 这次是真的', t: 1.6 };
  }

  // 战利品弹窗已移除：空壳兼容旧调用，不再产生任何装备
  function renderLoot() {}
  function takeLoot() {}
  function skipLoot() {}
  function skipAll() {}
  function clearLoot() {}
  function showLoot() {}
  function continueLoot() {}

  Object.assign(G, {
    lootPending, spawnChest, dropEliteLoot, checkChests, openChest,
    spawnMimic, dropMimicLoot, grantChestUpgrade,
    renderLoot, takeLoot, skipLoot, skipAll, clearLoot, showLoot, continueLoot
  });
})(window.ABYSS = window.ABYSS || {});
