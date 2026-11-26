/* ============================================================
   渲染层 · sprites.js（角色图片素材）
   - 异步预加载 assets/characters/*.png
   - 未加载完成时 getSprite 返回 null，drawUnit 回退到原来的圆形+emoji
   - 测试环境（无 Image 或 __TEST__）不加载，保持原有渲染路径
   ============================================================ */
(function (G) {
  'use strict';

  const NAMES = ['player', 'melee', 'brute', 'flyer', 'ranged',
    'mage', 'elite', 'boss', 'mimic', 'companion', 'crystal'];
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
    NAMES.forEach(name => {
      const img = new Image();
      img.onload = () => { cache[name] = img; };
      img.onerror = () => { cache[name] = null; };
      img.src = 'assets/characters/' + name + '.png' + (version ? '?v=' + version : '');
    });
  }

  /** 取图片；未加载完成返回 null。精英统一使用 elite 骑士图。 */
  function getSprite(u, isPlayer) {
    if (isPlayer) return cache.player || null;
    if (u.elite && u.type !== 'boss') return cache.elite || null;
    return cache[u.type] || null;
  }

  Object.assign(G, { sprites: { load, getSprite, NAMES, ready: () => NAMES.filter(n => !!cache[n]).length } });
})(window.ABYSS = window.ABYSS || {});
