/* ============================================================
   基础层 · audio.js
   WebAudio 实时合成音效，无外部音频资源
   ============================================================ */
(function (G) {
  'use strict';

  /* =========================================================
     音效（WebAudio 合成，无外部资源）
     ========================================================= */
  let audioCtx = null;
  let muted = false;

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { audioCtx = new AC(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone(opt) {
    if (muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const { freq = 220, type = 'sine', dur = 0.12, vol = 0.14, slide = null, delay = 0 } = opt;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /* 命中音效节流：多个敌人同帧命中时只响一次，避免声音叠加刺耳 */
  const HIT_SFX_GAP = 0.07;        // 最小间隔（秒）
  let lastHitSfxT = -Infinity;
  let hitSfxPlays = 0;             // 实际播放次数（供调试/测试）

  function sfxHit(crit) {
    const now = Date.now() / 1000;
    if (now - lastHitSfxT < HIT_SFX_GAP) return;   // 时间窗口内跳过，防止叠加
    lastHitSfxT = now;
    hitSfxPlays++;
    tone({ freq: crit ? 380 : 460, type: 'triangle', dur: 0.12, vol: 0.13, slide: 140 });
    tone({ freq: 110, type: 'sawtooth', dur: 0.16, vol: 0.08, slide: 55, delay: 0.01 });
  }

  function getHitSfxPlays() { return hitSfxPlays; }
  function resetHitSfx() { lastHitSfxT = -Infinity; hitSfxPlays = 0; }
  function sfxHurt() {
    tone({ freq: 150, type: 'sawtooth', dur: 0.2, vol: 0.09, slide: 60 });
    tone({ freq: 70, type: 'sine', dur: 0.24, vol: 0.12, slide: 40 });
  }
  function sfxGuard() {
    tone({ freq: 300, type: 'sine', dur: 0.22, vol: 0.1, slide: 520 });
    tone({ freq: 600, type: 'sine', dur: 0.3, vol: 0.06, delay: 0.05 });
  }
  function sfxWin() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone({ freq: f, type: 'sine', dur: 0.3, vol: 0.11, delay: i * 0.075 });
    });
  }
  function sfxUpgrade() {
    tone({ freq: 880, type: 'sine', dur: 0.22, vol: 0.1 });
    tone({ freq: 1318.5, type: 'sine', dur: 0.34, vol: 0.08, delay: 0.07 });
  }
  function sfxLose() {
    [392, 329.63, 261.63, 196].forEach((f, i) => {
      tone({ freq: f, type: 'triangle', dur: 0.42, vol: 0.11, delay: i * 0.14 });
    });
  }
  function sfxBoss() {
    tone({ freq: 90, type: 'sawtooth', dur: 0.55, vol: 0.13, slide: 55 });
    tone({ freq: 180, type: 'square', dur: 0.4, vol: 0.06, delay: 0.05 });
  }
  function sfxTick() {
    tone({ freq: 260, type: 'square', dur: 0.07, vol: 0.05, slide: 180 });
  }

  /** 切换静音状态，返回切换后的结果 */
  function toggleMute() {
    muted = !muted;
    return muted;
  }

  function isMuted() { return muted; }

  // iOS/移动端：切后台或锁屏后 AudioContext 会挂起，回到前台时自动恢复
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && audioCtx && audioCtx.state === 'suspended') {
        try { audioCtx.resume(); } catch (e) { /* 忽略 */ }
      }
    });
  }

  Object.assign(G, { tone, sfxHit, sfxHurt, sfxGuard, sfxWin, sfxUpgrade, sfxLose, sfxBoss, sfxTick, toggleMute, isMuted, getHitSfxPlays, resetHitSfx });
})(window.ABYSS = window.ABYSS || {});
