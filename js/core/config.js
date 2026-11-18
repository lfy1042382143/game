/* ============================================================
   配置层 · config.js
   数值、稀有度、槽位、装备定义、怪物词库 —— 调平衡只改这里
   ============================================================ */
(function (G) {
  'use strict';

  /* =========================================================
     数值配置（全部整数）
     ========================================================= */
  const CFG = {
    player: { hp: 120, atk: 14, def: 4 },

    // 属性升级：白 / 绿 / 蓝 / 紫 / 金
    attr: {
      hp:  { label: '生命', icon: '❤', vals: [19, 36, 59, 90, 138], note: '提升生命上限，并立即恢复等量生命' },
      atk: { label: '攻击', icon: '⚔', vals: [6, 9, 13, 20, 29],    note: '每次攻击造成更高伤害' },
      def: { label: '防御', icon: '🛡', vals: [2, 3, 4, 6, 9],      note: '减免受到的伤害，并提升防御护盾' }
    },

    // 怪物成长曲线
    mon: {
      hp0: 24, hpK: 14, hpQ: 0.15,
      atk0: 8, atkK: 1.7, atkQ: 0.05,
      def0: 1, defK: 0.55,
      bossHp: 1.45, bossAtk: 1.05,
      eqBase: 1,         // 第 1 波起就带 1 件装备（同时是玩家的首件战利品）
      eqEvery: 4,        // 之后每 N 波多带一件
      eqMax: 4,
      eqLvEvery: 6,      // 每 N 波怪物装备等级 +1（掉落物的等级同步，不会白给）
      rarK: 0.2,         // 装备稀有度基线 = floor(波数 × rarK)
      rarUpEvery: 3,     // 每 N 件装备中有 1 件稀有度 +1 档（固定节拍，非概率）
      bleedMul: 0.8      // 怪物流血强度系数
    },

    // 战利品：怪物身上有几件就掉几件，逐件由玩家决定去留（见 systems/loot.js）

    // 多敌人小队：一波可能有多个敌人
    // 平衡原则：N 个敌人的总强度 ≈ 1 个单怪的强度
    // （总血量/总输出按数量均摊，单只更脆、更弱，但总威胁相近）
    squad: {
      base: 1,          // 起始敌人数量
      every: 4,         // 之后每 N 波 +1 个敌人
      max: 4,           // 最多同时 4 个敌人
      hpShare: 0.92,    // 总血量系数（多敌人略低，补偿逐目标击杀的回合损耗）
      atkShare: 1.0,    // 总攻击系数（敌人轮流行动已避免输出碾压，故保持 1.0）
      eliteMul: 1.35    // 精英怪额外生命倍率（普通波首个敌人）
    },

    // 场景事件：每隔 N 波触发一次确定性事件（见 systems/events.js）
    events: {
      every: 3,         // 每 N 波触发一次事件（第 1 波除外）
      firstAt: 3        // 首个事件出现的波次
    },

    // 敌人词缀：给敌人赋予行为差异，打破「无脑攻击」的单调
    // 分配规则确定性（按波次+位置固定轮换，不掷骰），玩家可见可预判
    affixes: {
      firstAt: 3,       // 从第 3 波起开始出现词缀
      every: 2          // 之后每 N 波敌人普遍带词缀（3、5、7...）
    },

    heal: { min: 12, pct: 0.24, base: 18, perWave: 2.6 },
    defend: { base: 8, defMul: 2.4, capPct: 0.5, decay: 0.7 },
    rage: { start: 14, per: 0.12 },
    forge: { maxLevel: 5 }
  };

  const RARITY = [
    { key: 'white',  name: '普通', c: '#c9d1e0', w: w => Math.max(10, 44 - 1.5 * w) },
    { key: 'green',  name: '精良', c: '#4ade80', w: () => 30 },
    { key: 'blue',   name: '稀有', c: '#48b8f8', w: w => 13 + 0.4 * w },
    { key: 'purple', name: '史诗', c: '#a78bfa', w: w => 6 + 0.4 * w },
    { key: 'gold',   name: '传说', c: '#fbbf24', w: w => Math.min(10, 1 + 0.2 * w) }
  ];

  const SLOTS = [
    { key: 'weapon',  name: '武器', icon: '⚔',  statK: 'atk' },
    { key: 'armor',   name: '护甲', icon: '🛡',  statK: 'def' },
    { key: 'helm',    name: '头盔', icon: '⛑',  statK: 'hp' },
    { key: 'trinket', name: '饰品', icon: '💠',  statK: null }
  ];

  /* ---------- 装备定义 ----------
     stat：各稀有度的基础属性加成；step：每级追加
     mk(r, L0)：按稀有度索引与等级偏移算出具体效果数值
  ------------------------------------- */
  const ITEM_DEFS = {
    weapon: [
      {
        k: 'bleed', name: '血刃', icon: '🗡️', stat: [2, 3, 5, 8, 12], step: 2,
        mk: (r, L0) => ({
          dmg: Math.round([2, 3, 5, 7, 10][r] + 2 * L0),
          turns: [3, 3, 4, 4, 5][r] + Math.floor(L0 / 2)
        }),
        desc: v => '命中后附加流血：每回合 <em>' + v.dmg + '</em> 点，持续 <em>' + v.turns + '</em> 回合',
        tag: v => '流血 ' + v.dmg + ' × ' + v.turns
      },
      {
        k: 'crit', name: '裂风刃', icon: '🌪️', stat: [2, 3, 5, 7, 10], step: 2,
        // 暴击改为固定节拍：每第 N 次攻击必定触发，不再掷骰
        mk: (r, L0) => ({
          every: Math.max(2, [5, 4, 4, 3, 3][r] - Math.floor(L0 / 2)),
          mult: Number(([1.6, 1.7, 1.8, 1.9, 2.0][r] + 0.05 * L0).toFixed(2))
        }),
        desc: v => '每第 <em>' + v.every + '</em> 次攻击必定造成 <em>' + v.mult + '</em> 倍伤害',
        tag: v => '每 ' + v.every + ' 击 ×' + v.mult
      },
      {
        k: 'leech', name: '噬血剑', icon: '🩸', stat: [2, 3, 5, 8, 12], step: 2,
        mk: (r, L0) => ({ pct: [8, 12, 17, 23, 30][r] + 3 * L0 }),
        desc: v => '造成伤害的 <em>' + v.pct + '%</em> 转化为自身治疗',
        tag: v => '吸血 ' + v.pct + '%'
      }
    ],
    armor: [
      {
        k: 'thorn', name: '荆棘甲', icon: '🌵', stat: [1, 2, 3, 4, 6], step: 1,
        mk: (r, L0) => ({ dmg: Math.round([2, 3, 4, 6, 8][r] + 1.5 * L0) }),
        desc: v => '每次被攻击时反弹 <em>' + v.dmg + '</em> 点伤害',
        tag: v => '反伤 ' + v.dmg
      },
      {
        k: 'guard', name: '壁垒甲', icon: '🛡️', stat: [1, 2, 3, 4, 6], step: 1,
        mk: (r, L0) => ({ shield: Math.round([6, 10, 15, 21, 28][r] + 4 * L0) }),
        desc: v => '防御时额外获得 <em>' + v.shield + '</em> 点护盾',
        tag: v => '护盾 +' + v.shield
      },
      {
        k: 'bulwark', name: '龙鳞甲', icon: '🐉', stat: [1, 2, 3, 4, 6], step: 1,
        mk: (r, L0) => ({ pct: Math.min(60, [6, 9, 13, 18, 24][r] + 3 * L0) }),
        desc: v => '受到的伤害降低 <em>' + v.pct + '%</em>',
        tag: v => '减伤 ' + v.pct + '%'
      }
    ],
    helm: [
      {
        k: 'vamp', name: '回响头盔', icon: '🩹', stat: [10, 16, 24, 36, 52], step: 8,
        mk: (r, L0) => ({ pct: [15, 20, 26, 32, 40][r] + 3 * L0 }),
        desc: v => '受到伤害后回复该次伤害的 <em>' + v.pct + '%</em>',
        tag: v => '回复 ' + v.pct + '%'
      },
      {
        k: 'dotres', name: '抗性头冠', icon: '🧿', stat: [10, 16, 24, 36, 52], step: 8,
        mk: (r, L0) => ({ pct: [20, 28, 36, 45, 55][r] + 4 * L0 }),
        desc: v => '受到的流血伤害降低 <em>' + v.pct + '%</em>',
        tag: v => '抗流血 ' + v.pct + '%'
      },
      {
        k: 'shieldstart', name: '守望头盔', icon: '🪖', stat: [10, 16, 24, 36, 52], step: 8,
        mk: (r, L0) => ({ shield: Math.round([8, 12, 18, 26, 35][r] + 5 * L0) }),
        desc: v => '每波开始时自动获得 <em>' + v.shield + '</em> 点护盾',
        tag: v => '开局盾 ' + v.shield
      }
    ],
    trinket: [
      {
        k: 'pierce', name: '破魔坠', icon: '🔮', stat: null,
        mk: (r, L0) => ({ pct: [10, 15, 20, 28, 36][r] + 4 * L0 }),
        desc: v => '攻击时无视目标 <em>' + v.pct + '%</em> 的防御',
        tag: v => '破甲 ' + v.pct + '%'
      },
      {
        k: 'might', name: '巨力符', icon: '💪', statK: 'atk', stat: [3, 5, 8, 12, 18], step: 3,
        mk: () => ({}),
        desc: (v, it) => '攻击力提高 <em>+' + it.statV + '</em>',
        tag: (v, it) => '攻击 +' + it.statV
      },
      {
        k: 'ward', name: '磐石符', icon: '🪨', statK: 'def', stat: [2, 3, 5, 8, 11], step: 2,
        mk: () => ({}),
        desc: (v, it) => '防御力提高 <em>+' + it.statV + '</em>',
        tag: (v, it) => '防御 +' + it.statV
      }
    ]
  };

  const MONSTER_POOL = [
    { names: ['哥布林', '地精', '小恶魔'], emoji: '👺' },
    { names: ['骷髅兵', '骸骨卫兵'], emoji: '💀' },
    { names: ['巨蛛', '蛛魔'], emoji: '🕷️' },
    { names: ['狼人', '魔狼'], emoji: '🐺' },
    { names: ['怨灵', '幽魂'], emoji: '👻' },
    { names: ['石像鬼', '魔像'], emoji: '🗿' },
    { names: ['毒蝎', '沙虫'], emoji: '🦂' },
    { names: ['蜥蜴人', '蛇裔'], emoji: '🦎' },
    { names: ['腐尸', '食尸鬼'], emoji: '🧟' },
    { names: ['血蝠', '夜翼'], emoji: '🦇' }
  ];
  const BOSS_POOL = [
    { name: '骸骨君王', emoji: '🐲' },
    { name: '深渊领主', emoji: '👹' },
    { name: '血月女巫', emoji: '🧙' },
    { name: '熔岩巨兽', emoji: '🌋' },
    { name: '虚空吞噬者', emoji: '🕸️' },
    { name: '腐朽泰坦', emoji: '🧌' }
  ];
  const PREFIX = ['狂暴的', '腐朽的', '幽暗的', '嗜血的', '远古的', '被诅咒的', '游荡的'];

  /* ---------- 敌人词缀：行为差异（确定性分配，玩家可预判） ----------
     每个词缀都是「强化 + 弱点」的双刃剑，玩家针对弱点打就有优势 */
  const AFFIXES = [
    {
      key: 'armored', name: '重甲', icon: '🛡️',
      desc: '防御 ×1.8，但生命 −20%（破甲装备克制）',
      apply(u) { u.baseDef = Math.round(u.baseDef * 1.8); u.baseHp = Math.round(u.baseHp * 0.8); }
    },
    {
      key: 'swift', name: '迅捷', icon: '⚡',
      desc: '每回合都行动，但生命 −25%（优先集火）',
      apply(u) { u.baseHp = Math.round(u.baseHp * 0.75); }
    },
    {
      key: 'frenzy', name: '狂怒', icon: '🔥',
      desc: '血量越低攻击越高（最高 +80%），但防御 −40%（速杀）',
      apply(u) { u.baseDef = Math.round(u.baseDef * 0.6); }
    },
    {
      key: 'regen', name: '再生', icon: '🌿',
      desc: '每 3 回合回复 8% 生命，但攻击 −30%（持续输出克制）',
      apply(u) { u.baseAtk = Math.round(u.baseAtk * 0.7); }
    },
    {
      key: 'spikes', name: '尖刺', icon: '🦔',
      desc: '被攻击反弹 3 点伤害，但防御 −40%（护盾/破甲克制）',
      apply(u) { u.baseDef = Math.round(u.baseDef * 0.6); }
    }
  ];

  Object.assign(G, { CFG, RARITY, SLOTS, ITEM_DEFS, MONSTER_POOL, BOSS_POOL, PREFIX, AFFIXES });
})(window.ABYSS = window.ABYSS || {});
