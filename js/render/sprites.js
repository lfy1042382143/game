/* ============================================================
   渲染层 · sprites.js（角色图片素材）
   - 异步预加载 assets/characters/*.png
   - 未加载完成时 getSprite 返回 null，drawUnit 回退到原来的圆形+emoji
   - 测试环境（无 Image 或 __TEST__）不加载，保持原有渲染路径
   ============================================================ */
(function (G) {
  'use strict';

  const NAMES = ['player', 'melee', 'brute', 'flyer', 'ranged',
    'mage', 'elite', 'boss', 'mimic', 'companion', 'crystal', 'skeleton'];
  const TILES = ['forest', 'swamp', 'bone', 'ice', 'lava'];
  const OBSTACLES = ['root', 'stone', 'bone', 'ice', 'lava'];
  const ZONES = ['ice', 'poison'];
  const cache = Object.create(null);
  let version = '';

  // 测试沙箱里 document 是 stub，没有 Image 构造器，直接跳过加载
  const canLoad = typeof Image === 'function' &&
    !(G.__TEST__ || (typeof window !== 'undefined' && window.__TEST__));

  function load() {
    if (!canLoad) return;
    // 引用 index.html 里的破缓存指纹（若有），保证改图后浏览器刷新
    const s = document.querySelector && document.querySelector('script[src*="sprites.js"]');
    const m = s && String(s.src).match(/[?&]v=([^&]+)/);
    version = m ? m[1] : '';
    const loadOne = (key, path) => {
      const img = new Image();
      img.onload = () => { cache[key] = img; };
      img.onerror = () => { cache[key] = null; };
      img.src = path + (version ? '?v=' + version : '');
    };
    NAMES.forEach(name => loadOne(name, 'assets/characters/' + name + '.png'));
    TILES.forEach(name => loadOne('tile/' + name, 'assets/tiles/' + name + '.png'));
    OBSTACLES.forEach(name => loadOne('ob/' + name, 'assets/obstacles/' + name + '.png'));
    ZONES.forEach(name => loadOne('zone/' + name, 'assets/zones/' + name + '.png'));
  }

  /** 取图片；未加载完成返回 null。精英统一使用 elite 骑士图。 */
  function getSprite(u, isPlayer) {
    if (isPlayer) return cache.player || null;
    if (u.elite && u.type !== 'boss') return cache.elite || null;
    return cache[u.type] || null;
  }

  /**
   * 素材原图朝向：1 = 朝右，-1 = 朝左，0 = 正面（无左右差别）。
   * 实测只有弓手(ranged)原图朝右，其余按朝左/正面处理即为正确。
   */
  const BASE_FACE = {
    player: -1, melee: -1, brute: -1, flyer: 0, ranged: 1,
    mage: -1, elite: -1, boss: 0, mimic: 0, companion: 0, crystal: 0,
    skeleton: -1
  };

  function baseFace(u, isPlayer) {
    if (isPlayer) return BASE_FACE.player;
    const key = (u.elite && u.type !== 'boss') ? 'elite' : u.type;
    return BASE_FACE[key] !== undefined ? BASE_FACE[key] : -1;
  }

  /** 通用取图：tile/xxx、ob/xxx、zone/xxx 以及角色名 */
  function get(key) { return cache[key] || null; }

  Object.assign(G, {
    sprites: {
      load, get, getSprite, baseFace, BASE_FACE, NAMES, TILES, OBSTACLES, ZONES,
      ready: () => NAMES.filter(n => !!cache[n]).length
    }
  });
})(window.ABYSS = window.ABYSS || {});
