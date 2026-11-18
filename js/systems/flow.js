/* ============================================================
   系统层 · flow.js
   波次推进、回合时序、胜负判定、重开
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG, state, el, fmt, sleep, renderWave, renderMonster, render, renderEquip, renderButtons, setTip, floatNum, impact, showBanner, allyHost, foeHost, strike, doDefend, tickBleed, healUnit, makeUnit, makeMonster, makeSquad, showUpgrade, sfxHit, sfxHurt, sfxGuard, sfxWin, sfxLose, sfxBoss, sfxTick, startShield } = G;

  /* =========================================================
     流程
     ========================================================= */
  function startWave(justSlot) {
    state.foes = makeSquad(state.wave);
    state.monster = state.foes[0];
    state.target = 0;
    state.round = 0;
    state.phase = 'battle';

    const p = state.player;

    // 玩家与所有敌人共用同一套开局结算
    [p].concat(state.foes).forEach(u => {
      u.bleed = null;
      u.defended = false;
      u.strikes = 0;
      u.guardUsed = 0;
      u.lastAct = '';
      u.shield = startShield(u);
    });

    renderWave();
    renderMonster();
    render();
    if (justSlot) renderEquip(el.allyEq, p, justSlot);
    setTip('选择目标 · 你的回合');

    if (p.shield > 0) floatNum(allyHost(), '+' + p.shield + ' 护盾', 'shield');
    state.foes.forEach(m => {
      if (m.shield > 0) floatNum(foeHost(m), '+' + m.shield + ' 护盾', 'shield');
    });

    if (state.monster.boss) {
      showBanner('BOSS 来袭');
      sfxBoss();
    } else if (state.foes.length > 1) {
      showBanner('敌群来袭 × ' + state.foes.length);
    }
  }

  /** 存活敌人列表 */
  function aliveFoes() {
    return state.foes.filter(m => m.hp > 0);
  }

  /** 回合结束护盾衰减：不会低于开局护盾（守望头盔的护盾整波有效） */
  function decayShield(u) {
    const base = startShield(u);
    if (u.defended || u.shield <= base) return;
    u.shield = Math.max(base, Math.floor(u.shield * CFG.defend.decay));
  }

  /** 怪物 AI（无随机）：血量跌破血线就举盾；带壁垒甲的敌人多一次举盾机会 */
  function monsterChooseAction(m) {
    if (m.lastAct === 'defend') return 'attack';
    const triggers = m.agg.guard > 0 ? [0.62, 0.38, 0.15] : [0.5, 0.25];
    if (m.guardUsed >= triggers.length) return 'attack';
    if (m.hp / m.maxHp <= triggers[m.guardUsed]) {
      m.guardUsed += 1;
      return 'defend';
    }
    return 'attack';
  }

  async function doRound(action) {
    if (state.phase !== 'battle' || state.paused) return;
    state.phase = 'busy';
    renderButtons();

    const p = state.player;
    state.round += 1;

    /* ---- 玩家行动：攻击当前选中的目标 ---- */
    const m = state.foes[state.target];
    if (!m || m.hp <= 0) {
      // 目标已死，自动切到第一个存活敌人
      const next = aliveFoes()[0];
      state.target = next ? next.idx : 0;
      state.phase = 'battle';
      renderButtons();
      return;
    }

    if (action === 'attack') {
      el.ally.classList.add('lunge');
      setTip('攻击 ' + m.name);
      sfxHit(false);
      await sleep(180);
      el.ally.classList.remove('lunge');

      const res = strike(p, m);
      if (res.crit) sfxHit(true);
      const host = foeHost(m);
      host.classList.add('hit', 'flash-dmg');
      floatNum(host, (res.absorbed ? '格挡 ' : '') + '-' + res.dmg, res.absorbed ? 'block' : (res.crit ? 'crit' : 'dmg'));
      impact(false);
      render();
      await sleep(280);
      host.classList.remove('hit', 'flash-dmg');
    } else {
      const gain = doDefend(p);
      el.ally.classList.add('guard');
      setTip('防御');
      sfxGuard();
      floatNum(allyHost(), gain > 0 ? '+' + gain + ' 护盾' : '护盾已满', 'shield');
      render();
      await sleep(340);
      el.ally.classList.remove('guard');
    }

    if (aliveFoes().length === 0) { await onVictory(); return; }
    if (p.hp <= 0) { gameOver(); return; }

    /* ---- 敌方行动：多敌人时轮流攻击（每回合部分敌人行动），避免 1vN 输出碾压 ---- */
    setTip('敌方回合');
    await sleep(140);

    const alive = aliveFoes();
    const actCount = Math.max(1, Math.ceil(alive.length / 2));
    // 确定本回合行动的下标集合（轮转：按上一回合记录的指针顺延）
    state.actPtr = (state.actPtr || 0) % alive.length;
    const acting = [];
    for (let k = 0; k < actCount; k++) {
      acting.push(alive[(state.actPtr + k) % alive.length]);
    }
    state.actPtr = (state.actPtr + actCount) % alive.length;

    // 迅捷词缀：每回合都行动（不参与轮流），额外加入行动列表
    alive.forEach(foe => {
      if (foe.affix && foe.affix.key === 'swift' && !acting.includes(foe)) {
        acting.push(foe);
      }
    });

    for (const foe of acting) {
      if (foe.hp <= 0) continue;
      if (p.hp <= 0) break;

      const mAct = monsterChooseAction(foe);
      foe.lastAct = mAct;
      const host = foeHost(foe);

      if (mAct === 'defend') {
        const gain = doDefend(foe);
        host.classList.add('guard');
        floatNum(host, gain > 0 ? '+' + gain + ' 护盾' : '护盾已满', 'shield');
        render();
        await sleep(320);
        host.classList.remove('guard');
      } else {
        host.classList.add('lunge');
        await sleep(170);
        host.classList.remove('lunge');

        const res = strike(foe, p);
        el.ally.classList.add('hit', 'flash-dmg');
        floatNum(allyHost(), (res.absorbed ? '格挡 ' : '') + '-' + res.dmg, res.absorbed ? 'block' : 'hurt');
        impact(true);
        sfxHurt();
        render();
        await sleep(300);
        el.ally.classList.remove('hit', 'flash-dmg');
      }

      if (p.hp <= 0) break;
    }

    if (aliveFoes().length === 0) { await onVictory(); return; }   // 反伤击杀
    if (p.hp <= 0) { gameOver(); return; }

    /* ---- 回合结束：流血 / 护盾衰减 ---- */
    await sleep(120);

    for (const foe of state.foes) {
      if (foe.hp <= 0) continue;
      const bm = tickBleed(foe);
      if (bm > 0) {
        floatNum(foeHost(foe), '-' + bm + ' 流血', 'dot');
        sfxTick();
        render();
        await sleep(240);
      }
    }
    if (aliveFoes().length === 0) { await onVictory(); return; }

    const bp = tickBleed(p);
    if (bp > 0) {
      floatNum(allyHost(), '-' + bp + ' 流血', 'dot');
      sfxTick();
      render();
      await sleep(220);
    }
    if (p.hp <= 0) { gameOver(); return; }

    if (!p.defended && p.shield > 0) decayShield(p);
    state.foes.forEach(foe => {
      if (!foe.defended && foe.shield > 0) decayShield(foe);
      foe.defended = false;
    });
    p.defended = false;

    // 再生词缀：每 3 回合回复 8% 生命
    state.foes.forEach(foe => {
      if (foe.hp <= 0 || !foe.affix || foe.affix.key !== 'regen') return;
      foe.regenTick = (foe.regenTick || 0) + 1;
      if (foe.regenTick >= 3) {
        foe.regenTick = 0;
        const heal = Math.max(1, Math.round(foe.maxHp * 0.08));
        const gained = healUnit(foe, heal);
        if (gained > 0) {
          floatNum(foeHost(foe), '+' + gained + ' 再生', 'heal');
          render();
        }
      }
    });

    render();
    state.phase = 'battle';
    setTip(state.round >= CFG.rage.start ? '第 ' + state.round + ' 回合 · 敌方狂暴' : '选择目标 · 你的回合', state.round >= CFG.rage.start);
    renderButtons();
  }

  async function onVictory() {
    state.phase = 'busy';
    renderButtons();

    state.foes.forEach(f => el.foeCard(f) && el.foeCard(f).classList.add('dying'));
    sfxWin();
    setTip('胜利');
    render();

    const p = state.player;
    const healAmt = Math.round(Math.max(
      CFG.heal.min,
      Math.min(p.maxHp * CFG.heal.pct, CFG.heal.base + CFG.heal.perWave * (state.wave - 1))
    ));

    await sleep(620);
    state.foes.forEach(f => el.foeCard(f) && el.foeCard(f).classList.remove('dying'));

    const gained = healUnit(p, healAmt);
    if (gained > 0) floatNum(allyHost(), '+' + gained, 'heal');
    render();

    await sleep(500);
    // 掉落 = 所有敌人身上的装备合并（波次奖励，与波次绑定，永远先结算）
    state.loots = [];
    state.foes.forEach(foe => {
      state.loots = state.loots.concat(G.rollLoot(foe));
    });
    state.lootSlots = [];

    // 进入升级界面：先处理掉落 + 选属性卡，事件在升级完成后才触发
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
      el.overKills.textContent = '击败 ' + Math.max(0, state.wave - 1) + ' 波敌人';
      el.overBest.innerHTML = '最佳纪录：第 <b>' + state.best + '</b> 波';
      el.overOverlay.classList.add('show');
    }, 420);
  }

  function resetGame() {
    if (G.inspector && G.inspector.isOpen()) G.inspector.close();
    state.paused = false;
    el.upOverlay.classList.remove('show');
    el.overOverlay.classList.remove('show');
    el.eventOverlay.classList.remove('show');
    el.ally.classList.remove('hit', 'flash-dmg', 'lunge', 'guard');

    G.clearLoot();

    state.wave = 1;
    state.round = 0;
    state.player = makeUnit(CFG.player);
    state.monster = null;
    state.foes = [];
    state.target = 0;
    state.actPtr = 0;
    state.phase = 'battle';
    state.pendingElite = false;
    state.pendingRage = false;
    state.eventLoot = null;

    el.recordNum.textContent = state.best;
    el.allyAvatar.textContent = '⚔️';
    startWave();
  }

  /** 从事件阶段推进到下一波（事件选择完成后调用） */
  function advanceWave() {
    G.clearLoot();
    state.wave += 1;
    startWave();
  }

  Object.assign(G, { startWave, doRound, onVictory, gameOver, resetGame, advanceWave, monsterChooseAction, aliveFoes });
})(window.ABYSS = window.ABYSS || {});
