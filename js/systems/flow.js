/* ============================================================
   系统层 · flow.js
   波次推进、回合时序、胜负判定、重开
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG, state, el, fmt, sleep, renderWave, renderMonster, render, renderEquip, renderButtons, setTip, floatNum, impact, showBanner, allyHost, foeHost, strike, doDefend, tickBleed, healUnit, makeUnit, makeMonster, showUpgrade, sfxHit, sfxHurt, sfxGuard, sfxWin, sfxLose, sfxBoss, sfxTick } = G;

  /* =========================================================
     流程
     ========================================================= */
  function startWave(justSlot) {
    state.monster = makeMonster(state.wave);
    state.round = 0;
    state.phase = 'battle';

    const p = state.player;
    p.shield = Math.min(Math.floor(p.maxHp * CFG.defend.capPct), p.agg.shieldstart || 0);
    p.bleed = null;
    p.defended = false;

    renderWave();
    renderMonster();
    render();
    if (justSlot) renderEquip(el.allyEq, p, justSlot);
    setTip('你的回合');

    if (state.monster.boss) {
      showBanner('BOSS 来袭');
      sfxBoss();
    }
  }

  function monsterChooseAction() {
    const m = state.monster;
    const low = m.hp / m.maxHp < 0.35;
    if (low && Math.random() < 0.4) return 'defend';
    return 'attack';
  }

  async function doRound(action) {
    if (state.phase !== 'battle' || state.paused) return;
    state.phase = 'busy';
    renderButtons();

    const p = state.player;
    const m = state.monster;
    state.round += 1;

    /* ---- 玩家行动 ---- */
    if (action === 'attack') {
      el.ally.classList.add('lunge');
      setTip('攻击');
      sfxHit(false);
      await sleep(180);
      el.ally.classList.remove('lunge');

      const res = strike(p, m);
      if (res.crit) sfxHit(true);
      el.foe.classList.add('hit', 'flash-dmg');
      floatNum(foeHost(), (res.absorbed ? '格挡 ' : '') + '-' + res.dmg, res.absorbed ? 'block' : (res.crit ? 'crit' : 'dmg'));
      impact(false);
      render();
      await sleep(280);
      el.foe.classList.remove('hit', 'flash-dmg');
    } else {
      const gain = doDefend(p);
      el.ally.classList.add('guard');
      setTip('防御');
      sfxGuard();
      floatNum(allyHost(), '+' + gain + ' 护盾', 'shield');
      render();
      await sleep(340);
      el.ally.classList.remove('guard');
    }

    if (m.hp <= 0) { await onVictory(); return; }

    /* ---- 怪物行动 ---- */
    setTip('敌方回合');
    await sleep(140);

    const mAct = monsterChooseAction();
    if (mAct === 'defend') {
      const gain = doDefend(m);
      el.foe.classList.add('guard');
      floatNum(foeHost(), '+' + gain + ' 护盾', 'shield');
      render();
      await sleep(320);
      el.foe.classList.remove('guard');
    } else {
      el.foe.classList.add('lunge');
      await sleep(170);
      el.foe.classList.remove('lunge');

      const res = strike(m, p);
      el.ally.classList.add('hit', 'flash-dmg');
      floatNum(allyHost(), (res.absorbed ? '格挡 ' : '') + '-' + res.dmg, res.absorbed ? 'block' : 'hurt');
      impact(true);
      sfxHurt();
      render();
      await sleep(300);
      el.ally.classList.remove('hit', 'flash-dmg');
    }

    if (p.hp <= 0) { gameOver(); return; }

    /* ---- 回合结束：流血 / 护盾衰减 ---- */
    await sleep(120);

    const bm = tickBleed(m);
    if (bm > 0) {
      floatNum(foeHost(), '-' + bm + ' 流血', 'dot');
      sfxTick();
      render();
      await sleep(240);
    }
    if (m.hp <= 0) { await onVictory(); return; }

    const bp = tickBleed(p);
    if (bp > 0) {
      floatNum(allyHost(), '-' + bp + ' 流血', 'dot');
      sfxTick();
      render();
      await sleep(220);
    }
    if (p.hp <= 0) { gameOver(); return; }

    if (!p.defended && p.shield > 0) p.shield = Math.floor(p.shield * CFG.defend.decay);
    if (!m.defended && m.shield > 0) m.shield = Math.floor(m.shield * CFG.defend.decay);
    p.defended = false;
    m.defended = false;

    render();
    state.phase = 'battle';
    setTip(state.round >= CFG.rage.start ? '第 ' + state.round + ' 回合 · 敌方狂暴' : '你的回合', state.round >= CFG.rage.start);
    renderButtons();
  }

  async function onVictory() {
    state.phase = 'busy';
    renderButtons();

    el.foe.classList.add('dying');
    sfxWin();
    setTip('胜利');
    render();

    const p = state.player;
    const healAmt = Math.round(Math.max(
      CFG.heal.min,
      Math.min(p.maxHp * CFG.heal.pct, CFG.heal.base + CFG.heal.perWave * (state.wave - 1))
    ));

    await sleep(620);
    el.foe.classList.remove('dying');

    const gained = healUnit(p, healAmt);
    if (gained > 0) floatNum(allyHost(), '+' + gained, 'heal');
    render();

    await sleep(500);
    state.loots = G.rollLoot(state.monster);
    state.lootSlots = [];
    showUpgrade();
  }

  function gameOver() {
    state.phase = 'over';
    renderButtons();
    setTip('你倒下了', true);
    sfxLose();

    if (state.wave > state.best) {
      state.best = state.wave;
      try { localStorage.setItem('abyss_best', String(state.best)); } catch (e) {}
    }
    el.recordNum.textContent = state.best;

    const p = state.player;
    setTimeout(() => {
      el.overWave.textContent = state.wave;
      el.overKiller.textContent = '被「' + (state.monster ? state.monster.name : '深渊') + '」击败';
      el.overHp.textContent = fmt(p.maxHp);
      el.overAtk.textContent = fmt(p.atk);
      el.overDef.textContent = fmt(p.def);
      el.overEq.textContent = p.items.length + ' / 4';
      el.overKills.textContent = '击败 ' + Math.max(0, state.wave - 1) + ' 个敌人';
      el.overBest.innerHTML = '最佳纪录：第 <b>' + state.best + '</b> 波';
      el.overOverlay.classList.add('show');
    }, 420);
  }

  function resetGame() {
    el.upOverlay.classList.remove('show');
    el.overOverlay.classList.remove('show');
    el.ally.classList.remove('hit', 'flash-dmg', 'lunge', 'guard');
    el.foe.classList.remove('hit', 'flash-dmg', 'lunge', 'dying', 'guard');

    G.clearLoot();

    state.wave = 1;
    state.round = 0;
    state.player = makeUnit(CFG.player);
    state.monster = null;
    state.phase = 'battle';

    el.recordNum.textContent = state.best;
    el.allyAvatar.textContent = '⚔️';
    startWave();
  }

  Object.assign(G, { startWave, doRound, onVictory, gameOver, resetGame, monsterChooseAction });
})(window.ABYSS = window.ABYSS || {});
