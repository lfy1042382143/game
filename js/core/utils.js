/* ============================================================
   基础层 · utils.js
   DOM 选择器、延时、随机、数值格式化
   ============================================================ */
(function (G) {
  'use strict';

  /* =========================================================
     工具
     ========================================================= */
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function fmt(n) {
    const v = Math.round(n);
    if (!isFinite(v)) return '∞';
    return String(v);
  }

  Object.assign(G, { $, sleep, pick, clamp, fmt });
})(window.ABYSS = window.ABYSS || {});
