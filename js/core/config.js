/* ============================================================
   配置层 · config.js（实时版）
   数值、稀有度、槽位、装备定义、怪物词库 —— 调平衡只改这里
   ============================================================ */
(function (G) {
  'use strict';

  /* =========================================================
     数值配置（实时战斗：全部按「秒」计）
     ========================================================= */
  const CFG = {
    arena: { w: 960, h: 600 },

    // 玩家：WASD 移动，自动向最近的敌人射击
    player: {
      hp: 120, atk: 14, def: 4,
      r: 14,               // 碰撞半径
      speed: 190,          // 移动速度 px/s
      atkCd: 0.7,          // 射击间隔（秒）
      range: 300,          // 射程
      bulletSpeed: 430,
      iframes: 0.7         // 受击后的无敌时间（秒），躲避窗口
    },

    // 怪物成长曲线（沿用旧平衡曲线）
    mon: {
      hp0: 24, hpK: 14, hpQ: 0.15,
      atk0: 8, atkK: 1.7, atkQ: 0.05,
      def0: 1, defK: 0.55,
      bossHp: 1.45, bossAtk: 1.05,
      eqBase: 1, eqEvery: 4, eqMax: 4, eqLvEvery: 6,
      rarK: 0.2, rarUpEvery: 3,
      bossEvery: 5        // 每 N 波一个 BOSS
    },

    // 多敌人小队：总强度 ≈ 单怪的强度
    squad: {
      base: 1, every: 4, max: 4,
      hpShare: 0.92, atkShare: 1.0,
      eliteMul: 1.35
    },

    // 近战敌人：追击玩家，接触后近身攻击
    melee: { r: 15, speed: 152, atkCd: 1.15, reach: 3 },

    // 远程敌人：与玩家保持距离带，朝玩家发射弹幕
    ranged: {
      r: 13, speed: 105,
      shootCd: 2.2, bulletSpeed: 315,
      keepMin: 190, keepMax: 280
    },

    // BOSS：缓慢追击 + 扇形弹幕
    boss: { r: 24, speed: 92, shootCd: 2.6, bulletSpeed: 300, spread: 3 },

    // 场景事件节奏
    events: { firstAt: 3, every: 3 },

    // 敌人词缀出现节奏
    affixes: { firstAt: 3, every: 2 },

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
     流血语义：turns = 持续秒数（每秒跳一次伤害）
  ------------------------------------- */
  const ITEM_DEFS = {
    weapon: [
      {
        k: 'bleed', name: '血刃', icon: '🗡️', stat: [2, 3, 5, 8, 12], step: 2,
        mk: (r, L0) => ({
          dmg: Math.round([2, 3, 5, 7, 10][r] + 2 * L0),
          turns: [3, 3, 4, 4, 5][r] + Math.floor(L0 / 2)
        }),
        desc: v => '命中后附加流血：每秒 <em>' + v.dmg + '</em> 点，持续 <em>' + v.turns + '</em> 秒',
        tag: v => '流血 ' + v.dmg + ' × ' + v.turns + 's'
      },
      {
        k: 'crit', name: '裂风刃', icon: '🌪️', stat: [2, 3, 5, 7, 10], step: 2,
        // 暴击为固定节拍：每第 N 发必定触发，不再掷骰
        mk: (r, L0) => ({
          every: Math.max(2, [5, 4, 4, 3, 3][r] - Math.floor(L0 / 2)),
          mult: Number(([1.6, 1.7, 1.8, 1.9, 2.0][r] + 0.05 * L0).toFixed(2))
        }),
        desc: v => '每第 <em>' + v.every + '</em> 发箭矢必定造成 <em>' + v.mult + '</em> 倍伤害',
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
        desc: v => '每次被命中时反弹 <em>' + v.dmg + '</em> 点伤害',
        tag: v => '反伤 ' + v.dmg
      },
      {
        k: 'guard', name: '壁垒甲', icon: '🛡️', stat: [1, 2, 3, 4, 6], step: 1,
        mk: (r, L0) => ({ shield: Math.round([6, 10, 15, 21, 28][r] + 4 * L0) }),
        desc: v => '每波开始时获得 <em>' + v.shield + '</em> 点护盾',
        tag: v => '开局盾 +' + v.shield
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
        k: 'swiftstep', name: '疾步之靴', icon: '👟', stat: [10, 16, 24, 36, 52], step: 8,
        mk: (r, L0) => ({ pct: [6, 9, 12, 16, 20][r] + 2 * L0 }),
        desc: v => '移动速度提高 <em>' + v.pct + '%</em>',
        tag: v => '移速 +' + v.pct + '%'
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

  /* ---------- 敌人词缀（实时行为版，双刃剑，确定性分配） ---------- */
  const AFFIXES = [
    {
      key: 'armored', name: '重甲', icon: '🛡️',
      desc: '防御 ×1.8，但生命 −20%',
      apply(u) { u.baseDef = Math.round(u.baseDef * 1.8); u.baseHp = Math.round(u.baseHp * 0.8); }
    },
    {
      key: 'swift', name: '迅捷', icon: '⚡',
      desc: '移速 +45%，但生命 −25%',
      apply(u) { u.baseHp = Math.round(u.baseHp * 0.75); }
    },
    {
      key: 'frenzy', name: '狂怒', icon: '🔥',
      desc: '血量越低攻击越高（最高 +80%），但防御 −40%',
      apply(u) { u.baseDef = Math.round(u.baseDef * 0.6); }
    },
    {
      key: 'regen', name: '再生', icon: '🌿',
      desc: '每 3 秒回复 8% 生命，但攻击 −30%',
      apply(u) { u.baseAtk = Math.round(u.baseAtk * 0.7); }
    },
    {
      key: 'spikes', name: '尖刺', icon: '🦔',
      desc: '被命中反弹 3 点伤害，但防御 −40%',
      apply(u) { u.baseDef = Math.round(u.baseDef * 0.6); }
    }
  ];

  Object.assign(G, { CFG, RARITY, SLOTS, ITEM_DEFS, MONSTER_POOL, BOSS_POOL, PREFIX, AFFIXES });
})(window.ABYSS = window.ABYSS || {});
