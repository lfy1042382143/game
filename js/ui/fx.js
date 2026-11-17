/* ============================================================
   表现层 · fx.js
   伤害飘字、冲击特效、波次横幅
   ============================================================ */
(function (G) {
  'use strict';

  const { el } = G;

  /* =========================================================
     特效
     ========================================================= */
  const floatSlots = new WeakMap();

  function floatNum(host, text, cls) {
    // 同一目标同时出现的飘字错开，避免叠字
    const n = floatSlots.get(host) || 0;
    floatSlots.set(host, (n + 1) % 3);
    const d = document.createElement('div');
    d.className = 'float-num ' + (cls || '');
    d.textContent = text;
    d.style.marginLeft = [-34, 0, 34][n] + 'px';
    d.style.marginTop = [-6, 0, -24][n] + 'px';
    host.appendChild(d);
    const kill = () => d.remove();
    d.addEventListener('animationend', kill);
    setTimeout(kill, 1200);
  }

  function impact(isRed) {
    el.impact.classList.remove('fire', 'red');
    void el.impact.offsetWidth;
    el.impact.classList.add('fire');
    if (isRed) el.impact.classList.add('red');
  }

  function showBanner(text) {
    el.banner.textContent = text;
    el.banner.classList.remove('play');
    void el.banner.offsetWidth;
    el.banner.classList.add('play');
  }

  const allyHost = () => el.ally.querySelector('.avatar-wrap');
  const foeHost = () => el.foe.querySelector('.avatar-wrap');

  Object.assign(G, { floatNum, impact, showBanner, allyHost, foeHost });
})(window.ABYSS = window.ABYSS || {});
