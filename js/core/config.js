/* ============================================================
   配置层 · config.js（实时版）
   数值、稀有度、怪物词库 —— 调平衡只改这里
   ============================================================ */
(function (G) {
  'use strict';

  /* =========================================================
     数值配置（实时战斗：全部按「秒」计）
     ========================================================= */
  const CFG = {
    // 巨大世界（模拟无边界）+ 视口（相机跟随玩家，正常游玩触不到边缘）
    world: { w: 100000, h: 100000 },
    viewport: { w: 960, h: 600 },

    // 玩家：WASD 移动，自动向最近的敌人射击（初始属性克制，成长全靠升级选卡）
    player: {
      hp: 100, atk: 10, def: 3,
      r: 13,
      speed: 140,          // 全局降速后的移速
      atkCd: 0.8,          // 基础射击间隔（升级卡「攻速提升」在此基础上乘算）
      range: 320,
      bulletSpeed: 250,    // 弹幕整体降速
      iframes: 0.8
    },

    // 经验与升级：十级一档、档内恒定；跨档二次加速（等级高无所谓，怪物同步变强）
    // 需求 = tierBase + tier*tierStep + tier²*tierAccel
    // 例：1-10级 30/级，11-20级 58，21-30级 134，91-100级约 1290
    xp: { tierSize: 10, tierBase: 30, tierStep: 14, tierAccel: 14 },
    levelup: {
      healPct: 0.12,          // 升级时回复 12% 生命（不再自动成长三维，属性全靠选卡）
      xpMulCap: 1.6,          // 升级效率卡倍率上限（防止后期升级过快）
      luckTier: [0, 0.06, 0.12, 0.20, 0.30]  // 每点幸运对白/绿/蓝/紫/金权重增幅
    },
    maps: { milestoneEvery: 3 },                        // 每 N 级解锁一张新地图（4 级即解锁第二张）

    // 移动端性能降级（触屏设备自动开启，见 main.js / touch.js）
    perf: {
      lowFx: false,        // 关闭 shadowBlur 发光、飘字减半
      floaterCap: 60,      // 飘字上限（lowFx 时取一半）
      capMaxMobile: 120    // 手机端敌人存活上限软降（200 → 120）
    },

    // 源源不断刷怪（对标 VS 四阶段节奏）：一次刷一小群，密度随时间爬升
    spawn: {
      interval0: 2.2,     // 第 1 分钟的刷怪间隔（秒）
      intervalMin: 0.18,  // 间隔下限
      intervalK: 0.14,    // 每分钟缩短量
      capBase: 8,         // 第 1 分钟的场上存活上限（软参考值）
      capMax: 200,        // 存活上限（对标 VS 怪海规模）
      capK: 7.5,          // 每分钟上限增量（约 26 分钟逼近 200）
      hardCap: 260,       // 绝对存活上限（性能保护）；不到此值前无论杀没杀掉都持续刷怪
      offscreen: 90,      // 出生点超出视口对角线的额外距离（确保屏幕外刷新）
      offscreenSpan: 300, // 屏幕外环带厚度
      mageCap: 4,         // 场上法师数量上限
      // 四阶段节奏（对标 VS：0-5 稀疏 / 5-15 爬升 / 15-25 高压 / 25+ 满负荷）
      // batch = 每次刷新数量区间；capMul = 存活上限倍率；rateMul = 刷新间隔倍率（<1 更快）
      phases: [
        { until: 5,  batch: [1, 2], capMul: 0.55, rateMul: 1.45, name: '试探' },
        { until: 15, batch: [2, 4], capMul: 0.75, rateMul: 1.0,  name: '爬升' },
        { until: 25, batch: [3, 6], capMul: 0.92, rateMul: 0.72, name: '高压' },
        { until: 999, batch: [5, 9], capMul: 1.0,  rateMul: 0.55, name: '满负荷' }
      ]
    },

    // 无边界地形：按地块确定性生成陷阱/锚点，随玩家移动换入换出（位置在世界中固定）
    terrain: {
      cell: 900,          // 地块边长
      activeRadius: 1800, // 玩家周围生成半径
      cullRadius: 3000,   // 超出此距离回收区域/锚点
      cullFoeDist: 2200   // 远离玩家的普通敌人回收（防止旧怪堆积）
    },

    // 精英怪：每分钟整点出现一只；每 bossEvery 分钟为 BOSS
    elite: {
      every: 60,          // 精英出现间隔（秒）
      hpMul: 2.4,         // 精英生命倍率
      bossHpMul: 8.0,     // BOSS 生命倍率（持久战，配合半血狂暴）
      atkMul: 1.3,        // 精英攻击倍率
      xpMul: 5,           // 精英经验倍率
      bossXpMul: 12,      // BOSS 经验倍率（远高于精英，击杀应显著升级）
      bossEvery: 5,       // 每 N 分钟出现 BOSS（代替精英）
      auraRadius: 200,    // 精英光环半径：周围小怪攻击提升
      auraAtkMul: 1.15    // 精英光环攻击倍率（温和版 +15%）
    },

    // 宝箱：精英击杀后原地掉落（开启=一次免费升级），开局送一个引导宝箱
    chests: {
      minDist: 260, maxDist: 640,   // 开局宝箱相对玩家的刷新环带
      pickupR: 34,                  // 拾取半径
      mimicChance: 0.22             // 宝箱怪概率（伪装成宝箱，走近后现形）
    },

    // 场景事件：地图上的特定地点，走近触发（一次性）
    // 收益全部接入武器/被动构筑；风险写进选项文案，不再随机背刺。
    events: {
      cap: 2,            // 场上最多同时存在的地点数
      spawnEvery: 40,    // 刷新间隔（秒）
      minDist: 300, maxDist: 700,
      triggerR: 44,      // 触发半径
      weights: { shrine: 3, spring: 3, fork: 2, merchant: 1 },  // 加权随机：祭坛/泉水常见，商人稀有
      nearHazardChance: 0.6,   // 有地形时，事件地点优先刷在灾害锚点附近
      riskDur: 45,             // 事件代价持续时间（秒）
      shrineAtkMul: 1.2,       // 血契：期间新敌人攻击 +20%
      springAtkMul: 1.3,       // 泉水：期间新敌人攻击 +30%
      merchantHpCost: 0.15,    // 商人：付出当前生命的 15%
      sacrificeHpCost: 0.2,    // 祭坛血契：献祭 20% 生命上限
      searchHealPct: 0.4       // 歧路搜寻物资：回复 40% 生命
    },

    // 动态障碍物：随主角移动随机生成/移除；形状按地图主题（forest/root/stone/bone/ice/lava）
    obstacles: {
      cap: 8, spawnEvery: 4,
      minDist: 350, maxDist: 720, cullDist: 1150,
      screenMargin: 60,     // 新障碍物至少生成在视口对角线之外（+余量），避免屏幕内凭空出现
      sizeMin: 46, sizeMax: 88,
      iceHp: 6,             // 冰柱：被攻击 6 次后碎裂
      iceShatterR: 96,      // 冰柱碎裂：对周围敌人的范围半径
      iceShatterDmg0: 22, iceShatterDmgK: 8,  // 碎裂伤害 = dmg0 + dmgK×(分钟-1)
      lavaWarn: 1.4,        // 熔岩块：靠近累计 1.4 秒后开始灼烧
      lavaDps: 6,           // 熔岩块灼烧每秒伤害（固定值）
      boneSpawnCd: 6,       // 骨堆：每 6 秒在附近召唤 1 只骷髅
      boneSpawnRange: 130   // 骨堆召唤判定范围
    },

    // 地图特色机制：每张地图一种，初始森林无陷阱
    hazards: {
      // 沼泽：不规则毒池，进入获得中毒 debuff（每秒扣血）
      poison: {
        cellChance: 0.8, r0: 95, r1: 175,       // 毒池生成概率与半径（更密更大片）
        dps: 4, dpsK: 0.8,                      // 每秒伤害 = dps + dpsK×(分钟-1)
        tick: 0.5,                              // 扣血结算间隔
        slowMul: 0.82                           // 毒池内轻微减速
      },
      // 白骨森林：频繁生成骷髅（无经验、血少、量大）
      skeleton: {
        every: 3.2, batch: 3, batchK: 1,        // 每 3.2 秒生成一批，随分钟增加
        cap: 40,                                // 场上骷髅上限
        hpMul: 0.35, atkMul: 0.6, speedMul: 1.1,
        xp: 0                                   // 击杀无经验
      },
      // 冰川：不规则冰面区域内惯性滑行（加速度+摩擦模型，模拟真实冰面）
      ice: {
        cellChance: 0.6, r0: 140, r1: 230,     // 冰面区域生成概率与半径范围（不规则多边形）
        accel: 1050,                            // 冰面加速度（px/s²）：转弯/反向都要先抵消原速度，故有"刹不住"感
        friction: 300,                          // 冰面摩擦减速（px/s²）：松开按键后仍会向前滑一段
        maxMul: 1.15,                           // 冰面最高速度倍率（略快于地面）
        exitFriction: 2600                      // 离开冰面后的快速减速（恢复跟手操控）
      },
      // 火山：天降岩浆
      lava: {
        every: 3.0, warn: 0.9, r: 66,
        dmg0: 10, dmgK: 4                       // 伤害 = dmg0 + dmgK×(分钟-1)
      }
    },

    // 怪物成长曲线：两分钟一档，档内恒定；血量/攻击按档位指数增长（后期与玩家同步变强）
    // hp = hp0 × hpGrowth^tier；atk = atk0 × atkGrowth^tier；减伤率 = dr0 + tier×drStep（上限 60%）
    // v9.32：生命与防御整体上调 +20%（只抬基数，增长率不变 → 每档恰好 ×1.2）；攻击/移速不变
    mon: {
      tier: 2,
      hp0: 33.6, hpGrowth: 1.55,     // 原 28 → 33.6（×1.2），growth 不变保证每档精确 +20%
      atk0: 9.2, atkGrowth: 1.41,     // 攻击不变
      dr0: 6, drStep: 4.8,            // 原 5/4 → 6/4.8（×1.2），上限仍 60%
      mapBoost: 0.12       // 每张新地图敌人 hp/atk +12%
    },

    // 近战敌人：重装步兵——移速慢、伤害高、减伤高（接触缠斗威胁大）
    melee: { r: 15, speed: 80, atkCd: 1.6, reach: 3, atkMul: 1.2, hpMul: 1.15, defMul: 1.8 },

    // 重甲蛮兵：极慢极肉、伤害高——弹幕（箭矢/浮游炮）难打穿，弱近身爆炸（震荡波/飞刃）
    brute: { r: 17, speed: 58, atkCd: 2.0, reach: 4, atkMul: 1.35, hpMul: 1.9, defMul: 1.9 },

    // 飞行掠袭者：俯冲骚扰型——打一下就撤，飞远后再次俯冲；悬空时震荡波半伤，箭矢是弱点
    flyer: {
      r: 11, speed: 150, atkCd: 1.4, reach: 3, atkMul: 1.0, hpMul: 0.7, defMul: 0.6,
      retreatDist: 300,   // 命中后撤到的安全距离
      retreatSpd: 1.6     // 脱离时的加速倍率（飞得更快更有"擦身而过"感）
    },

    // （飞行轰炸者 bomber 已删除：后期敌方弹幕太密，投弹骚扰型整体移出刷怪池）

    // 远程敌人：游击射手——移速快、伤害低、血薄（风筝型骚扰；刷怪占比已降至 1%）
    ranged: {
      r: 13, speed: 124,
      shootCd: 2.6, bulletSpeed: 150,
      keepMin: 200, keepMax: 320,
      atkMul: 0.55, hpMul: 0.75, defMul: 0
    },

    // 法师敌人：高威胁站桩炮台——不能移动，但会周期性「闪现」到玩家附近保持威胁
    mage: {
      r: 14, speed: 0, castCd: 3.2, aoeR: 52, warn: 1.1,
      atkMul: 1.4, hpMul: 0.7, defMul: 0,
      blinkCd: 6.0,        // 闪现冷却（秒）
      blinkMin: 260, blinkMax: 480,  // 闪现落点与玩家的距离环带
      blinkWarn: 0.45      // 闪现前摇（紫色虚线预警）
    },

    // 宝箱怪：血薄攻高的刺客型突袭者
    mimic: { tele: 0.75, dashSpd: 440, dashDur: 0.42, cd: 1.9, crawl: 30, triggerDist: 330, hpMul: 0.8, atkMul: 1.5 },

    // 骷髅兵（白骨森林）：血少量大、无经验，由骨堆与周期机制生成
    skeleton: { r: 12, speed: 86, atkCd: 1.5, reach: 3, atkMul: 0.6, hpMul: 0.35, defMul: 0.5 },

    // BOSS：技能轮换（扇形弹幕 → 全向环射 → 预警冲撞 → 召唤援军），半血进入狂暴
    boss: {
      r: 24, speed: 74, atkMul: 1.3, defMul: 2.5,
      skillCd: 2.4,          // 技能间隔（秒）
      bulletSpeed: 170, spread: 5, spreadGap: 0.24,   // 扇形弹幕
      ringCount: 16,         // 全向环射弹数
      dashTele: 0.7, dashSpd: 330, dashDur: 0.55, dashDmgMul: 1.25,  // 预警冲撞
      summonCount: 2, summonCap: 8,   // 召唤援军（场上总数上限）
      rageAt: 0.5,           // 半血触发狂暴
      rageSkillMul: 0.6,     // 技能间隔 ×0.6
      rageRingAdd: 4,        // 环射弹数 +4
      rageSpeedMul: 1.25,    // 移速 ×1.25
      rageAtkMul: 1.15       // 攻击 ×1.15
    },

    // 体型随击杀难度：r = 基础半径 × (击杀箭数/refShots)^k，上下限裁剪（越难杀体型越大）
    size: { refShots: 3, k: 0.4, min: 0.85, max: 2.3 },  // 体型 = 击杀所需箭数（血量/玩家攻击）相对基准的幂

    // 敌人词缀出现节奏（普通敌人按分钟）
    affixes: { firstAt: 3, every: 2 }
  };

  /* ---------- 地图主题：按等级里程碑解锁 ----------
     obType: 障碍物形状（root/stone/bone/ice/lava/null）
     hazard: 特色机制（poison/skeleton/ice/lava/null）
  --------------------------------------------------- */
  const MAPS = [
    { name: '幽暗森林', theme: 'forest', obType: ['root', 'stone'],
      floor: '#0e1712', grid: 'rgba(140,200,150,0.035)', wall: 'rgba(110,160,120,0.5)',
      ob: '#1b2a20', obEdge: 'rgba(110,160,120,0.4)', obInner: 'rgba(110,160,120,0.12)' },
    { name: '腐毒沼泽', theme: 'swamp', obType: null, hazard: 'poison',
      floor: '#101a12', grid: 'rgba(160,220,140,0.04)', wall: 'rgba(150,210,130,0.45)',
      ob: '#18251a', obEdge: 'rgba(150,210,130,0.35)', obInner: 'rgba(150,210,130,0.1)' },
    { name: '白骨森林', theme: 'bone', obType: ['bone'], hazard: 'skeleton',
      floor: '#17140f', grid: 'rgba(255,235,205,0.04)', wall: 'rgba(196,164,120,0.5)',
      ob: '#262019', obEdge: 'rgba(196,164,120,0.4)', obInner: 'rgba(196,164,120,0.1)' },
    { name: '冰川裂隙', theme: 'ice', obType: ['ice'], hazard: 'ice',
      floor: '#0e1620', grid: 'rgba(160,210,255,0.045)', wall: 'rgba(150,200,240,0.5)',
      ob: '#1a2a3a', obEdge: 'rgba(150,210,255,0.45)', obInner: 'rgba(190,230,255,0.14)' },
    { name: '熔岩火山', theme: 'lava', obType: ['lava'], hazard: 'lava', obDensity: 2.2,
      floor: '#1b0e0b', grid: 'rgba(255,150,100,0.045)', wall: 'rgba(240,120,90,0.5)',
      ob: '#2d1610', obEdge: 'rgba(240,120,90,0.45)', obInner: 'rgba(255,140,60,0.16)' }
  ];

  /* ---------- 地图机制说明（横幅提示用） ---------- */
  const HAZ_INFO = {
    poison:   { name: '毒沼泽', icon: '☠️', desc: '不规则毒池会使你中毒，持续流失生命' },
    skeleton: { name: '亡者苏醒', icon: '💀', desc: '骨堆会召唤骷髅，骷髅虽多但击杀无经验' },
    ice:      { name: '冰面滑行', icon: '❄️', desc: '冰面区域很滑，松键仍会滑行；击碎冰柱会炸伤周围敌人' },
    lava:     { name: '熔岩地带', icon: '🌋', desc: '熔岩块靠近会灼烧，天上不时有岩浆坠落' }
  };

  const RARITY = [
    { key: 'white',  name: '普通', c: '#c9d1e0', w: w => Math.max(10, 44 - 1.5 * w) },
    { key: 'green',  name: '精良', c: '#4ade80', w: () => 30 },
    { key: 'blue',   name: '稀有', c: '#48b8f8', w: w => 13 + 0.4 * w },
    { key: 'purple', name: '史诗', c: '#a78bfa', w: w => 6 + 0.4 * w },
    { key: 'gold',   name: '传说', c: '#fbbf24', w: w => Math.min(10, 1 + 0.2 * w) }
  ];

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
      desc: '减伤 ×1.8，但生命 −20%',
      data: { defMul: 1.8, hpPenalty: 0.8 },
      apply(u) { u.affixData = this.data; u.baseDef = Math.round(u.baseDef * this.data.defMul); u.baseHp = Math.round(u.baseHp * this.data.hpPenalty); }
    },
    {
      key: 'swift', name: '迅捷', icon: '⚡',
      desc: '移速 +45%，但生命 −25%',
      data: { speedMul: 1.45, hpPenalty: 0.75 },
      apply(u) { u.affixData = this.data; u.baseHp = Math.round(u.baseHp * this.data.hpPenalty); }
    },
    {
      key: 'frenzy', name: '狂怒', icon: '🔥',
      desc: '血量越低攻击越高（最高 +80%），但减伤 −40%',
      data: { maxAtkBonus: 0.8, defPenalty: 0.6 },
      apply(u) { u.affixData = this.data; u.baseDef = Math.round(u.baseDef * this.data.defPenalty); }
    },
    {
      key: 'regen', name: '再生', icon: '🌿',
      desc: '每 3 秒回复 8% 生命，但攻击 −30%',
      data: { every: 3, pct: 0.08, atkPenalty: 0.7 },
      apply(u) { u.affixData = this.data; u.baseAtk = Math.round(u.baseAtk * this.data.atkPenalty); }
    },
    {
      key: 'spikes', name: '尖刺', icon: '🦔',
      desc: '被命中反弹 3 点伤害，但减伤 −40%',
      data: { thorn: 3, defPenalty: 0.6 },
      apply(u) { u.affixData = this.data; u.baseDef = Math.round(u.baseDef * this.data.defPenalty); }
    }
  ];

  Object.assign(G, { CFG, MAPS, HAZ_INFO, RARITY, MONSTER_POOL, BOSS_POOL, PREFIX, AFFIXES });
})(window.ABYSS = window.ABYSS || {});
