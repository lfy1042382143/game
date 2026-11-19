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
    // 大世界 + 视口（相机跟随玩家）
    world: { w: 2000, h: 1400 },
    viewport: { w: 960, h: 600 },

    // 玩家：WASD 移动，自动向最近的敌人射击（初始属性克制，成长全靠升级选卡与装备）
    player: {
      hp: 100, atk: 10, def: 3,
      r: 13,
      speed: 140,          // 全局降速后的移速
      atkCd: 0.8,          // 基础射击间隔（升级卡「攻速提升」在此基础上乘算）
      range: 320,
      bulletSpeed: 250,    // 弹幕整体降速
      iframes: 0.8
    },

    // 经验与升级（需求逐层递增：二次曲线）
    xp: { base: 20, perLevel: 14, accel: 8 },           // 需求 = base + (lv-1)*perLevel + (lv-1)^2*accel
    levelup: {
      healPct: 0.12,          // 升级时回复 12% 生命（不再自动成长三维，属性全靠选卡）
      modeEvery: 5            // 每 N 级弹出一次「攻击方式」升级（攻速/散射/暴击等），其余等级为属性三选一
    },
    maps: { milestoneEvery: 3 },                        // 每 N 级解锁一张新地图（4 级即解锁第二张）

    // 源源不断刷怪（无波次）：场上始终维持 5~10 个敌人
    spawn: {
      interval0: 1.6,     // 第 1 分钟的刷怪间隔（秒）
      intervalMin: 0.7,   // 间隔下限
      intervalK: 0.05,    // 每分钟缩短量
      capBase: 5,         // 第 1 分钟的场上存活上限
      capMax: 10,         // 存活上限
      capK: 0.35          // 每分钟上限增量
    },

    // 精英怪：每分钟整点出现一只；每 bossEvery 分钟为 BOSS
    elite: {
      every: 60,          // 精英出现间隔（秒）
      hpMul: 2.4,         // 精英生命倍率
      atkMul: 1.4,        // 精英攻击倍率
      xpMul: 4,           // 精英经验倍率
      bossEvery: 5        // 每 N 分钟出现 BOSS（代替精英）
    },

    // 宝箱：精英击杀后原地掉落（装备唯一来源），开局送一个引导宝箱
    chests: {
      minDist: 260, maxDist: 640,   // 开局宝箱相对玩家的刷新环带
      pickupR: 34,       // 拾取半径
      itemsMin: 1, itemsMax: 2,     // 每个宝箱的装备件数
      rarBonus: 1,       // 精英宝箱稀有度加成
      mimicChance: 0.22  // 宝箱怪概率（伪装成宝箱，走近后现形）
    },

    // 场景事件：地图上的特定地点，走近触发（一次性）
    events: {
      cap: 2,            // 场上最多同时存在的地点数
      spawnEvery: 40,    // 刷新间隔（秒）
      minDist: 300, maxDist: 700,
      triggerR: 44,      // 触发半径
      trapChance: 0.35   // 选择事件选项后触发陷阱的概率
    },

    // 陷阱：事件选择后概率触发（持续 effectDur 秒，影响之后刷新的敌人）
    traps: {
      effectDur: 45,       // 效果持续时间（秒）
      foeHpMul: 2.0,       // 血肉盛宴：敌人生命倍率
      foeAtkMul: 1.25,     // 狂怒低语：敌人攻击倍率
      ambushCount: 3       // 伏击：立即召唤的敌人数
    },

    // 动态障碍物：随主角移动随机生成/移除；部分伪装成普通掩体的尖刺陷阱
    obstacles: {
      cap: 8, spawnEvery: 4,
      trapChance: 0.22,              // 新生成的障碍物是尖刺陷阱的概率
      trapDmg0: 6, trapDmgK: 3,      // 陷阱伤害 = dmg0 + dmgK×(分钟-1)，固定值不受防御
      trigT: 0.8,                    // 触发后尖刺现形的展示时长（秒）
      minDist: 350, maxDist: 720, cullDist: 1150,
      sizeMin: 46, sizeMax: 88
    },

    // 地图陷阱：初始地图（深渊洞窟）无陷阱，其余地图各有特色灾害
    hazards: {
      swamp:  { count: 5, r: 92, slowMul: 0.5 },                       // 腐雾沼泽：减速泥潭
      vortex: { count: 4, r: 110, pull: 95 },                          // 虚空回廊：引力裂隙
      spikes: { every: 3.2, warn: 0.8, r: 70, dmg0: 7, dmgK: 3.5,
                minDist: 50, maxDist: 380 },                           // 荒芜骨林：骨刺突起
      fire:   { every: 2.8, warn: 1.1, r: 64, dmg0: 9, dmgK: 4.5,
                minDist: 40, maxDist: 360 }                            // 熔岩裂隙：坠落火球
    },

    // 怪物成长曲线（按「分钟」缩放：minute = floor(存活时间/60)+1）
    mon: {
      hp0: 26, hpK: 24, hpQ: 0.24,
      atk0: 9, atkK: 1.9, atkQ: 0.06,
      def0: 1, defK: 0.55,
      eqLvEvery: 6,
      rarK: 0.2,
      mapBoost: 0.12       // 每张新地图敌人 hp/atk +12%
    },

    // 近战敌人：全局限速下相对更快，逼玩家近身缠斗
    melee: { r: 15, speed: 136, atkCd: 1.3, reach: 3 },

    // 远程敌人：与玩家保持距离带，朝玩家发射弹幕
    ranged: {
      r: 13, speed: 82,
      shootCd: 3.0, bulletSpeed: 150,
      keepMin: 200, keepMax: 320
    },

    // BOSS：缓慢追击 + 扇形弹幕
    boss: { r: 24, speed: 74, shootCd: 2.6, bulletSpeed: 170, spread: 3 },

    // 敌人词缀出现节奏（普通敌人按分钟）
    affixes: { firstAt: 3, every: 2 },

    forge: { maxLevel: 5 }
  };

  /* ---------- 地图主题：按等级里程碑解锁（hazard = 特色陷阱，初始地图无） ---------- */
  const MAPS = [
    { name: '深渊洞窟', floor: '#12121c', grid: 'rgba(255,255,255,0.035)', wall: 'rgba(126,138,180,0.55)', ob: '#1d1e2e', obEdge: 'rgba(126,138,180,0.4)', obInner: 'rgba(126,138,180,0.12)' },
    { name: '荒芜骨林', hazard: 'spikes', floor: '#16120e', grid: 'rgba(255,235,205,0.04)',  wall: 'rgba(196,164,120,0.5)',  ob: '#241d15', obEdge: 'rgba(196,164,120,0.4)', obInner: 'rgba(196,164,120,0.1)' },
    { name: '熔岩裂隙', hazard: 'fire',   floor: '#190e0c', grid: 'rgba(255,150,100,0.045)', wall: 'rgba(240,120,90,0.5)',   ob: '#2a1612', obEdge: 'rgba(240,120,90,0.4)',  obInner: 'rgba(240,120,90,0.1)' },
    { name: '虚空回廊', hazard: 'vortex', floor: '#0d1018', grid: 'rgba(140,160,255,0.04)',  wall: 'rgba(140,160,255,0.45)', ob: '#161a28', obEdge: 'rgba(140,160,255,0.35)', obInner: 'rgba(140,160,255,0.08)' },
    { name: '腐雾沼泽', hazard: 'swamp',  floor: '#0f1712', grid: 'rgba(140,230,170,0.04)',  wall: 'rgba(120,220,160,0.45)', ob: '#16241b', obEdge: 'rgba(120,220,160,0.35)', obInner: 'rgba(120,220,160,0.08)' }
  ];

  /* ---------- 地图陷阱说明（横幅提示用） ---------- */
  const HAZ_INFO = {
    spikes: { name: '骨刺突起', icon: '🦴', desc: '地面不时弹出骨刺，留意白色预警圈' },
    fire:   { name: '天降火球', icon: '☄️', desc: '火球不定时坠落，及时离开橙色预警圈' },
    vortex: { name: '引力裂隙', icon: '🌀', desc: '虚空裂隙会把人往中心吸' },
    swamp:  { name: '减速泥潭', icon: '🫧', desc: '绿色泥潭会拖慢玩家与敌人的脚步' }
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

  Object.assign(G, { CFG, MAPS, HAZ_INFO, RARITY, SLOTS, ITEM_DEFS, MONSTER_POOL, BOSS_POOL, PREFIX, AFFIXES });
})(window.ABYSS = window.ABYSS || {});
