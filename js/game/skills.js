/* ============================================================
   游戏层 · skills.js
   攻击方式系统 v2：六条攻击线
   箭矢 / 连锁闪电 / 震荡波 / 环绕飞刃 / 浮游炮 / 感应地雷
   - 每条线先「解锁」，之后按维度随机升级（数量/伤害/频率/特殊方向…）
     升级方向不固定：各维度卡随机混入升级卡池
   - 全局冷却卡（cards.js）：箭矢/闪电/震荡波攻击间隔、
     飞刃/浮游炮/地雷的下次出现间隔，全部缩短
   ============================================================ */
(function (G) {
  'use strict';

  const { CFG } = G;

  const MINE_FUSE = 6;   // 地雷过期自爆时间（秒）

  /* =========================================================
     线与维度定义（dims 顺序即卡池内文案顺序）
     eff(lv) 返回该维度在 Lv.lv 时的具体效果描述（卡牌与侧边栏共用）
     ========================================================= */
  const LINES = {
    arrow: {
      name: '箭矢', icon: '🏹',
      color: '#7dd3fc',
      tagline: '持续单体 · 射速流', stats: ['90% 伤害', '1 支'],
      unlockDesc: '解锁箭矢：自动朝鼠标/最近敌人持续射击（初始 1 支，90% 攻击）',
      dims: [
        { key: 'count',  name: '箭矢数量', icon: '🏹', max: 4,
          eff: lv => '每次射击射出 ' + (1 + lv) + ' 支箭矢' },
        { key: 'rate',   name: '射速提升', icon: '⚡', max: 4,
          eff: lv => '射击间隔 ' + (CFG.player.atkCd * Math.pow(0.90, lv)).toFixed(2) + ' 秒/发' },
        { key: 'bounce', name: '弹射强化', icon: '🪃', max: 3,
          eff: lv => lv ? '箭矢碰墙/障碍物后反弹 ' + lv + ' 次，可再次命中' : '箭矢碰墙/障碍物即消失' },
        { key: 'pierce', name: '穿透强化', icon: '🎯', max: 3,
          eff: lv => lv ? '箭矢可穿过 ' + lv + ' 名敌人继续飞行（每次穿透伤害 ×0.7）' : '命中第一个敌人后消失' }
      ]
    },
    chain: {
      name: '连锁闪电', icon: '⚡',
      color: '#a78bfa',
      tagline: '弹射清场 · 高频', stats: ['80% 伤害', '2 跳'],
      unlockDesc: '解锁连锁闪电：每 3.0 秒劈向最近敌人并弹射 2 个目标（主目标 80% 攻击，每跳 ×0.75；不能穿墙）',
      dims: [
        { key: 'jumps', name: '弹射数量', icon: '🔗', max: 4,
          eff: lv => '每次攻击弹射跳跃 ' + (2 + lv) + ' 个目标' },
        { key: 'dmg',   name: '伤害提升', icon: '🗡️', max: 4,
          eff: lv => '每道闪电造成 ' + Math.round((0.8 + 0.2 * lv) * 100) + '% 攻击的伤害（每多弹射 1 目标 ×0.75）' },
        { key: 'rate',  name: '攻击频率', icon: '⏱️', max: 4,
          eff: lv => '每 ' + (3.0 * Math.pow(0.88, lv)).toFixed(2) + ' 秒发动一轮攻击' },
        { key: 'bolts', name: '闪电数量', icon: '🌩️', max: 3,
          eff: lv => '每次攻击同时发出 ' + (1 + lv) + ' 道独立闪电（各自弹射）' }
      ]
    },
    shock: {
      name: '震荡波', icon: '💥',
      color: '#38bdf8',
      tagline: '环形冲击 · 贴身', stats: ['160% 伤害', '半径 180'],
      unlockDesc: '解锁震荡波：每 3.0 秒以自身为中心释放环形冲击（160% 攻击，半径 180，越靠外伤害越低：中心满伤、边缘 60%；不能穿墙）',
      dims: [
        { key: 'range', name: '范围扩大', icon: '🌐', max: 4,
          eff: lv => '冲击波半径 ' + (180 + 24 * lv) + ' 像素' },
        { key: 'dmg',   name: '伤害提升', icon: '🗡️', max: 4,
          eff: lv => '冲击波造成 ' + Math.round((1.6 + 0.35 * lv) * 100) + '% 攻击的伤害' },
        { key: 'rate',  name: '释放频率', icon: '⏱️', max: 4,
          eff: lv => '每 ' + (3.0 * Math.pow(0.88, lv)).toFixed(2) + ' 秒释放一次' },
        { key: 'echo',  name: '连锁震荡', icon: '〰️', max: 3,
          eff: lv => lv ? '命中敌人后在其位置产生 ' + lv + ' 道次级震荡波（半径 45%、伤害 50%）' : '不产生次级震荡波' }
      ]
    },
    orbit: {
      name: '环绕飞刃', icon: '🌀',
      color: '#67e8f9',
      tagline: '绕身防守 · 持续', stats: ['120% 伤害', '3 枚'],
      unlockDesc: '解锁环绕飞刃：每隔 3.5 秒展开 3 枚绕身旋转的飞刃，接触敌人造成 120% 攻击伤害（撞到障碍物会被挡掉）',
      dims: [
        { key: 'count', name: '飞刃数量', icon: '🌀', max: 4,
          eff: lv => '每批 ' + (3 + 2 * lv) + ' 枚飞刃均匀环绕' },
        { key: 'rate',  name: '出现频率', icon: '⏱️', max: 4,
          eff: lv => '每 ' + (5 * Math.pow(0.88, lv)).toFixed(2) + ' 秒展开一批（持续约 ' + (5 * Math.pow(0.88, lv) * 0.62).toFixed(1) + ' 秒）' },
        { key: 'range', name: '范围扩大', icon: '🌐', max: 4,
          eff: lv => '绕行半径 ' + (92 + 16 * lv) + ' 像素' },
        { key: 'dmg',   name: '伤害提升', icon: '🗡️', max: 4,
          eff: lv => '每次接触造成 ' + Math.round((1.2 + 0.2 * lv) * 100) + '% 攻击的伤害' }
      ]
    },
    drone: {
      name: '浮游炮', icon: '🔮',
      color: '#c084fc',
      tagline: '自动哨戒 · 拦截', stats: ['80% 伤害', '0.8s'],
      unlockDesc: '解锁浮游炮：停在玩家周围射击（80% 攻击 / 0.8s），可拦截敌方弹幕，存活 4 秒后收回；子弹撞墙即消失',
      dims: [
        { key: 'count', name: '浮游炮数量', icon: '🔮', max: 3,
          eff: lv => '每次部署 ' + (1 + lv) + ' 座浮游炮（环绕玩家四周固定方位）' },
        { key: 'dmg',   name: '子弹伤害', icon: '🗡️', max: 4,
          eff: lv => '每发子弹造成 ' + Math.round((0.8 + 0.1 * lv) * 100) + '% 攻击的伤害' },
        { key: 'life',  name: '存在时间', icon: '⌛', max: 3,
          eff: lv => '部署后存活 ' + (4 + 1.5 * lv).toFixed(1) + ' 秒（每 6.5 秒重新部署一批）' }
      ]
    },
    mine: {
      name: '感应地雷', icon: '🧨',
      color: '#fbbf24',
      tagline: '布设爆破 · 陷阱', stats: ['180% 伤害', '半径 80'],
      unlockDesc: '解锁感应地雷：每 3.0 秒在身边布设地雷（180% 攻击，半径 80），敌人靠近或 6 秒到期后自爆；不会埋进障碍物',
      dims: [
        { key: 'dmg',   name: '伤害提升', icon: '🗡️', max: 4,
          eff: lv => '每枚地雷爆炸造成 ' + Math.round((1.8 + 0.3 * lv) * 100) + '% 攻击的伤害' },
        { key: 'count', name: '布雷数量', icon: '🧨', max: 3,
          eff: lv => '每次部署 ' + (1 + lv) + ' 枚地雷（散布在玩家两侧）' },
        { key: 'rate',  name: '部署冷却', icon: '⏱️', max: 4,
          eff: lv => '每 ' + (3.0 * Math.pow(0.88, lv)).toFixed(2) + ' 秒布设一批' },
        { key: 'range', name: '范围扩大', icon: '🌐', max: 4,
          eff: lv => '爆炸半径 ' + (80 + 20 * lv) + ' 像素' }
      ]
    },
    fireball: {
      name: '火球', icon: '🔥',
      color: '#fb923c',
      tagline: '低频高伤 · 单发炮', stats: ['240% 伤害', '3.6s'],
      unlockDesc: '解锁火球：每 3.6 秒朝最近敌人投出 1 颗火球，命中炸开范围伤害（240% 攻击，半径 70）——低频高伤的单发炮，撞到障碍物会直接炸开',
      dims: [
        { key: 'count',  name: '火球数量', icon: '🔥', max: 3,
          eff: lv => '每次投出 ' + (1 + lv) + ' 颗火球' },
        { key: 'radius', name: '爆炸半径', icon: '🌐', max: 4,
          eff: lv => '爆炸半径 ' + (70 + 16 * lv) + ' 像素' },
        { key: 'dmg',    name: '伤害提升', icon: '🗡️', max: 4,
          eff: lv => '爆炸造成 ' + Math.round((2.4 + 0.6 * lv) * 100) + '% 攻击的伤害' },
        { key: 'rate',   name: '投掷频率', icon: '⏱️', max: 4,
          eff: lv => '每 ' + (3.6 * Math.pow(0.94, lv)).toFixed(2) + ' 秒投出一批' }
      ]
    },
    boomerang: {
      name: '回旋镖', icon: '🪃',
      color: '#fca5a5',
      tagline: '往返双段 · 穿透', stats: ['100% 伤害', '穿透 3'],
      unlockDesc: '解锁回旋镖：每 3.0 秒将回旋镖逐把依次投出，飞出再返回，去回各命中一次（100% 攻击，穿透 3 敌；撞到障碍物立刻折返）',
      dims: [
        { key: 'count',  name: '回旋镖数量', icon: '🪃', max: 3,
          eff: lv => '每次投出 ' + (1 + lv) + ' 把回旋镖' },
        { key: 'rate',   name: '投掷频率', icon: '⏱️', max: 4,
          eff: lv => '每 ' + (3.0 * Math.pow(0.88, lv)).toFixed(2) + ' 秒投出一批' },
        { key: 'dmg',    name: '伤害提升', icon: '🗡️', max: 4,
          eff: lv => '每段命中造成 ' + Math.round((1 + 0.22 * lv) * 100) + '% 攻击的伤害' },
        { key: 'pierce', name: '穿透强化', icon: '🎯', max: 3,
          eff: lv => '每段最多命中 ' + (3 + lv) + ' 名敌人' }
      ]
    }
  };

  const LINE_KEYS = Object.keys(LINES);

  /* =========================================================
     超级武器元数据：武器满级 + 配方被动满级自动进化（详见 build.js）
     - 每局可拥有多把超级武器（p.evolved 记录所有已进化线 key）
     - tier: 'extreme'（极致档）/ 'focused'（收敛档）
     ========================================================= */
  const ULT = {
    arrow: { name: '贯穿诸天', icon: '🏹', tier: 'focused',
      desc: '箭数翻倍 · 可穿 5 名敌人且穿透不再衰减 · 射速 +25% · 射程 ×1.55' },
    chain: { name: '雷狱', icon: '⚡', tier: 'extreme',
      desc: '每跳固定 100% 伤害不再递减 · 弹射目标 +4 · 闪电道数翻倍 · 麻痹延长' },
    shock: { name: '湮灭冲击', icon: '💥', tier: 'extreme',
      desc: '半径 ×1.8 · 无视距离衰减（全距离满伤）· 伤害 ×1.5' },
    orbit: { name: '无尽刃环', icon: '🌀', tier: 'focused',
      desc: '飞刃常驻不收起 · 数量 +6 · 命中半径 ×1.5 · 转速 ×1.4' },
    drone: { name: '浮游炮阵', icon: '🔮', tier: 'focused',
      desc: '炮台常驻 · 数量 +3 · 子弹穿透 3 人 · 射速 ×1.6' },
    mine:  { name: '灭世雷区', icon: '🧨', tier: 'focused',
      desc: '布雷数翻倍 · 半径 ×2 · 引爆连锁引爆范围内其他地雷' },
    fireball: { name: '陨火焚天', icon: '🔥', tier: 'extreme',
      desc: '数量翻倍 · 爆炸半径 ×1.5 · 火球穿透 2 名敌人才爆炸' },
    boomerang: { name: '无尽回旋', icon: '🪃', tier: 'focused',
      desc: '数量翻倍 · 往返 4 段命中 · 每段穿透 +3' }
  };

  /** 该线是否所有维度都满级 */
  function isLineMaxed(p, k) {
    if (!p || !p.sd || !p.sd[k]) return false;
    return LINES[k].dims.every(d => (p.sd[k][d.key] || 0) >= d.max);
  }

  /** 作弊码：直接赋予某条线的超级武器（解锁 + 全维度拉满 + 标记进化 + 重算，可叠加多把） */
  function grantUltimate(p, k) {
    if (!p || !LINES[k]) return false;
    p.skills[k] = 1;
    if (!p.sd[k]) p.sd[k] = {};
    LINES[k].dims.forEach(d => { p.sd[k][d.key] = d.max; });
    p.evolved = p.evolved || {};
    p.evolved[k] = true;
    if (p.sk && p.sk[k]) p.sk[k].t = 0.5;   // 让技能很快出现第一批
    applySkillBuild(p);
    return true;
  }

  /* =========================================================
     运行态初始化（state.js makePlayer 时调用）
     p.skills = 解锁标记；p.sd = 各维度等级；p.cdr = 全局冷却层数
     p.evolved = 已进化超级武器线集合（每局可多把，重开即清空）
     ========================================================= */
  function initSkills(p, startLine) {
    p.skills = {};
    p.sd = {};
    LINE_KEYS.forEach(k => {
      p.skills[k] = 0;
      p.sd[k] = {};
      LINES[k].dims.forEach(d => { p.sd[k][d.key] = 0; });
    });
    // 开局选中的初始武器（默认箭矢，兼容无参调用/测试）；仅解锁该线，不含维度升级
    const start = (startLine && LINES[startLine]) ? startLine : 'arrow';
    p.startLine = start;
    p.skills[start] = 1;
    p.cdr = p.cdr || 0;                 // 全局冷却卡层数
    p.evolved = {};                     // 已进化超级武器线集合，重开即清空
    p.orbitTriple = false;              // 飞刃终极三层刀阵标记，重开即清空
    p.sk = {
      chain: { t: 0 },
      shock: { t: 0 },
      orbit: { t: 0.3, active: 0 },   // 首次部署延迟 0.5→0.3，开局飞刃更快出现
      drone: { t: 0.5, active: 0, shootT: 0 },
      mine: { t: 0 },
      fireball: { t: 0.6 },
      boomerang: { t: 0.9, queue: 0, shootT: 0 }
    };
    p.orbits = 0;
    applySkillBuild(p);
    if (G.state && !G.state.mines) G.state.mines = [];
    if (G.state && !G.state.skillFx) G.state.skillFx = [];
    if (G.state && !G.state.fireballs) G.state.fireballs = [];
    if (G.state && !G.state.boomerangs) G.state.boomerangs = [];
  }

  /* =========================================================
     由解锁/维度等级/全局冷却 重算全部运行参数
     ========================================================= */
  function applySkillBuild(p) {
    if (!p || !p.sk) return;
    const sd = p.sd || {};
    const g = k => sd[k] || {};
    const D = Math.pow(0.9, (p.cdr || 0) + (p.taskCdr || 0)) * Math.pow(0.95, p.pasCdr || 0);   // 全局冷却：冷却卡 + 任务奖励 + 急速被动
    const isUlt = k => !!(p.evolved && p.evolved[k]);   // 本局已进化的超级武器线（可多把）

    /* 箭矢（基础远程弹幕；单体线，Lv8 对单约 6.2A） */
    const a = g('arrow');
    p.shots = 1 + (a.count || 0);
    p.shotDmgMul = 0.9;
    p.atkCdMul = Math.pow(0.90, a.rate || 0);
    p.bounce = a.bounce || 0;
    p.pierce = a.pierce || 0;
    // 终极·贯穿诸天（收敛档）：箭数翻倍、穿 5 且不衰减、射速 +25%、射程 ×1.55
    if (isUlt('arrow')) {
      p.shots *= 2;
      p.pierce = Math.max(5, p.pierce);
      p.atkCdMul *= 0.75;
      p.ultPierceNoDecay = true;
      p.arrowRangeMul = 1.55;         // 终极箭矢攻击范围（射程）放大，独立于全局 p.range
    } else { p.ultPierceNoDecay = false; p.arrowRangeMul = 1; }

    /* 连锁闪电（远程爆发 AoE：1.8×攻 / 3s / 弹射 2 目标） */
    const c = g('chain'), ch = p.sk.chain;
    ch.cd = Math.max(1.1, 3.0 * Math.pow(0.88, c.rate || 0) * D);
    ch.jumps = 2 + (c.jumps || 0);
    ch.mult = 0.8 + 0.2 * (c.dmg || 0);
    ch.bolts = 1 + (c.bolts || 0);
    // 终极·雷狱（极致档）：每跳固定 100%、弹射目标 +4、道数翻倍、麻痹延长
    if (isUlt('chain')) {
      ch.jumps += 4;
      ch.bolts *= 2;
      ch.ultNoDecay = true;
      ch.ultStun = 0.8;
    } else { ch.ultNoDecay = false; ch.ultStun = 0; }

    /* 震荡波（近身 AoE：1.4×攻 / 3s / 半径 180） */
    const s = g('shock'), so = p.sk.shock;
    so.cd = Math.max(1.5, 3.0 * Math.pow(0.88, s.rate || 0) * D);
    so.r = 180 + 24 * (s.range || 0);
    so.mult = 1.6 + 0.35 * (s.dmg || 0);
    so.echo = s.echo || 0;
    // 终极·湮灭冲击（极致档）：半径 ×1.8、无视距离衰减（全距离满伤）、伤害 ×1.5（撞墙反弹已取消）
    if (isUlt('shock')) {
      so.r *= 1.8;
      so.mult *= 1.5;
      so.ultNoFalloff = true;
    } else so.ultNoFalloff = false;

    /* 环绕飞刃（近身持续：3 枚起，接触伤害 0.8×攻，触发间隔 0.45s） */
    const o = g('orbit'), ob = p.sk.orbit;
    ob.interval = Math.max(1.5, 3.5 * Math.pow(0.88, o.rate || 0) * D);   // 部署间隔 5→3.5，重新部署更快
    ob.dur = Math.max(2.6, ob.interval * 0.62);
    ob.count = 3 + 2 * (o.count || 0);
    ob.r = 92 + 16 * (o.range || 0);   // 绕行半径上调：62~102 → 92~156，覆盖更远敌人
    ob.spd = 2.4 + 0.55 * (o.speed || 0);
    p.orbitR = ob.r;
    p.orbitSpd = ob.spd;
    // 飞刃单次接触伤害：新增伤害维度（原「转速」维度改为伤害，转速固定）
    ob.mult = 1.2 + 0.2 * (o.dmg || 0);
    p.orbitDmgMul = ob.mult;
    // 终极·无尽刃环（收敛档）：数量 +6、转速 ×1.4、命中半径 ×1.5、常驻不收起
    // 三层反向刀阵：主环/外环/内环各自旋转，外环与内环反向
    if (isUlt('orbit')) {
      ob.count += 6;
      ob.spd *= 1.4;
      p.orbitSpd = ob.spd;
      ob.ultPersistent = true;
      p.orbitTriple = true;
      p.orbitHitRadius = 14 * 1.5;
    } else { ob.ultPersistent = false; p.orbitTriple = false; p.orbitHitRadius = 14; }

    /* 浮游炮（远程持续：0.9×攻 / 0.8s） */
    const d = g('drone'), dr = p.sk.drone;
    dr.interval = Math.max(2.5, 6.5 * D);
    dr.count = 1 + (d.count || 0);
    dr.mult = 0.8 + 0.1 * (d.dmg || 0);
    dr.life = 4 + 1.5 * (d.life || 0);
    dr.cd = 0.8;
    // 终极·浮游炮阵（收敛档）：数量 +3、射速 ×1.6、子弹穿透 3、常驻
    if (isUlt('drone')) {
      dr.count += 3;
      dr.cd = 0.8 / 1.6;
      dr.ultPierce = 3;
      dr.ultPersistent = true;
    } else { dr.ultPierce = 0; dr.ultPersistent = false; }

    /* 感应地雷（近身陷阱：1.6×攻 / 3s / 半径 80） */
    const m = g('mine'), mi = p.sk.mine;
    mi.cd = Math.max(1.5, 3.0 * Math.pow(0.88, m.rate || 0) * D);
    mi.count = 1 + (m.count || 0);
    mi.r = 80 + 20 * (m.range || 0);
    mi.mult = 1.8 + 0.3 * (m.dmg || 0);
    // 终极·灭世雷区（收敛档）：布雷数翻倍、半径 ×2、连锁引爆
    if (isUlt('mine')) {
      mi.count *= 2;
      mi.r *= 2;
      mi.ultChain = true;
    } else mi.ultChain = false;

    /* 火球（低频高伤的单发范围炮：2.2×攻 / 3.6s / 半径 70） */
    const f = g('fireball'), fi = p.sk.fireball;
    fi.cd = Math.max(1.8, 3.6 * Math.pow(0.94, f.rate || 0) * D);
    fi.count = 1 + (f.count || 0);
    fi.r = 70 + 16 * (f.radius || 0);
    fi.mult = 2.4 + 0.6 * (f.dmg || 0);   // 单发炮：满级 dmg3 = 4.2×攻
    fi.speed = 300;
    // 终极·陨火焚天：数量翻倍、半径 ×1.5、穿透 2 敌才爆炸
    fi.pierce = 0;
    if (isUlt('fireball')) {
      fi.count *= 2;
      fi.r *= 1.5;
      fi.pierce = 2;
    }

    /* 回旋镖（往返多段：1.0×攻 / 3s / 穿透 3；逐把依次发射） */
    const bm = g('boomerang'), bo = p.sk.boomerang;
    bo.cd = Math.max(1.5, 3.0 * Math.pow(0.88, bm.rate || 0) * D);   // 新增投掷频率维度
    bo.count = 1 + (bm.count || 0);
    bo.dist = 340;                                                    // 距离固定（原距离维度改为频率）
    bo.mult = 1 + 0.22 * (bm.dmg || 0);
    bo.pierce = 3 + (bm.pierce || 0);
    bo.legs = 2;
    bo.speed = 340;
    bo.gap = 0.22;   // 逐把发射间隔（秒）：count 把依次飞出，不一次性全扔
    // 终极·无尽回旋：数量翻倍、往返 4 段、每段穿透 +3
    if (isUlt('boomerang')) {
      bo.count *= 2;
      bo.legs = 4;
      bo.pierce += 3;
    }
  }

  /* =========================================================
     升级卡生成：每条线一张解锁卡 + 每维度一张维度卡
     （未解锁的线：其维度卡 max() 恒真 → 自动排除出卡池）
     ========================================================= */
  function makeAllSkillCards() {
    const cards = [];
    LINE_KEYS.forEach(k => {
      const L = LINES[k];
      cards.push({
        key: 'unlock_' + k, kind: 'skill', line: k, sub: 'unlock',
        name: L.name, icon: L.icon,
        max: p => !!p.skills[k],
        val: () => '解锁',
        desc: p => p.skills[k] ? L.name + '已解锁' : L.unlockDesc,
        apply(p) {
          p.skills[k] = 1;
          if (k === 'orbit' || k === 'drone' || k === 'mine') p.sk[k].t = k === 'orbit' ? 0.3 : 0.5;  // 解锁后出现第一批（飞刃更快）
          applySkillBuild(p);
        }
      });
      L.dims.forEach(d => {
        cards.push({
          key: 'sk_' + k + '_' + d.key, kind: 'skill', line: k, sub: 'dim', dim: d.key,
          name: L.name + '·' + d.name, icon: d.icon,
          max: p => !p.skills[k] || (p.sd[k][d.key] || 0) >= d.max,
          val: p => 'Lv.' + ((p.sd[k] && p.sd[k][d.key]) || 0) + '→' + (((p.sd[k] && p.sd[k][d.key]) || 0) + 1),
          // 详细描述：当前效果 → 升级后效果（具体数值）
          desc: p => {
            const cur = (p.sd[k] && p.sd[k][d.key]) || 0;
            const next = Math.min(d.max, cur + 1);
            return '当前：' + d.eff(cur) + '<br>升到 Lv.' + next + '：' + d.eff(next);
          },
          apply(p) {
            p.sd[k][d.key] = (p.sd[k][d.key] || 0) + 1;
            applySkillBuild(p);
          }
        });
      });
    });
    return cards;
  }

  const SKILL_CARDS = makeAllSkillCards();

  /* =========================================================
     技能伤害 = 攻击 × 倍率
     ========================================================= */
  function skillDamage(p, mult) {
    return Math.max(1, Math.round(p.atk * mult));
  }

  /* =========================================================
     目标搜索
     ========================================================= */
  function nearestFoeFrom(x, y, maxD, exclude) {
    let best = null, bd = maxD === undefined ? Infinity : maxD;
    for (const f of G.state.foes) {
      if (f.dead || (exclude && exclude.has(f))) continue;
      const d = G.dist(x, y, f.x, f.y);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  function nearestFoe(p, maxD, exclude) {
    return nearestFoeFrom(p.x, p.y, maxD, exclude);
  }

  /* =========================================================
     连锁闪电：锯齿电弧生成 + 多道独立闪电
     ========================================================= */
  /** 把折线细分并加随机法向抖动，形成锯齿闪电路径 */
  function jaggedPath(pts) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i], B = pts[i + 1];
      out.push(A);
      const seg = Math.max(2, Math.round(G.dist(A.x, A.y, B.x, B.y) / 26));
      const nx = -(B.y - A.y), ny = B.x - A.x;
      const nl = Math.hypot(nx, ny) || 1;
      for (let k = 1; k < seg; k++) {
        const t = k / seg;
        const off = (Math.random() * 2 - 1) * 11;
        out.push({ x: A.x + (B.x - A.x) * t + (nx / nl) * off, y: A.y + (B.y - A.y) * t + (ny / nl) * off });
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /** 发射一道连锁闪电：从玩家劈向 startFoe 并弹跳 jumps 次（不能穿墙） */
  function fireChainBolt(p, startFoe, hitSetAll) {
    const cfg = p.sk.chain;
    const hitSet = hitSetAll || new Set();
    const pts = [{ x: p.x, y: p.y }];
    const hits = [];
    let cur = startFoe;
    for (let i = 0; i < cfg.jumps && cur; i++) {
      const from = pts[pts.length - 1];
      // 墙体阻挡：电流无法穿过障碍物命中后面的敌人 → 连锁在此中断
      if (G.losBlocked && G.losBlocked(from.x, from.y, cur.x, cur.y)) break;
      hitSet.add(cur);
      pts.push({ x: cur.x, y: cur.y });
      hits.push(cur);
      // 多目标伤害递减：主目标 100%，每多弹射 1 个目标 ×0.75；终极·雷狱每跳固定 100%
      const decay = cfg.ultNoDecay ? 1 : Math.pow(0.75, i);
      G.dealDamage(p, cur, skillDamage(p, cfg.mult * decay), { noThorn: true, noShock: true, noSplash: true, tag: 'chain' });
      if (!cur.dead) cur.stunT = Math.max(cur.stunT || 0, cfg.ultStun || 0.35);   // 短暂麻痹（终极延长）
      let next = null, nd = 240;
      for (const f of G.state.foes) {
        if (f.dead || hitSet.has(f)) continue;
        const dd = G.dist(cur.x, cur.y, f.x, f.y);
        if (dd >= nd) continue;
        if (G.losBlocked && G.losBlocked(cur.x, cur.y, f.x, f.y)) continue;   // 只看得到的敌人
        nd = dd; next = f;
      }
      cur = next;
    }
    // 特效：锯齿电弧 + 每个命中点闪光；终极·雷狱用更狂暴的雷电表现
    const ult = !!cfg.ultNoDecay;
    G.state.skillFx.push({ kind: 'chain', pts: jaggedPath(pts), t: 0, dur: ult ? 0.45 : 0.32, ult });
    hits.forEach(h => G.state.skillFx.push({ kind: 'zap', x: h.x, y: h.y, r: ult ? 40 : 26, t: 0, dur: ult ? 0.42 : 0.3, ult }));
  }

  /* =========================================================
     震荡波：主波 + 次级震荡波（echo 维度）
     ========================================================= */
  const SHOCK_WAVE_SPEED = 600;   // 波面扩散速度（像素/秒）：基础半径 180 约 0.3s 扫完，比原来瞬间结算慢
  const SHOCK_WAVE_BAND = 18;     // 波面厚度（像素）：敌人落在波面带内即被命中

  /** 发射一道扩散波：fx 同时承担渲染与逐帧命中 */
  function spawnShockWave(p, x, y, maxR, mult) {
    G.state.skillFx.push({
      kind: 'shock', x, y, r: maxR, t: 0,
      dur: maxR / SHOCK_WAVE_SPEED + 0.1,   // 波扫完再多留一点淡出时间
      ult: !!p.sk.shock.ultNoFalloff,
      wave: {
        owner: p, maxR, mult,
        r: 0, prevR: 0,
        hit: new Set(),
        allowEcho: true,
        echoDone: false
      }
    });
  }

  /** 逐帧推进所有扩散波：波面扫过敌人时命中一次 */
  function advanceShockWaves(dt) {
    const fxArr = G.state.skillFx || [];
    for (const fx of fxArr) {
      if (fx.kind !== 'shock' || !fx.wave) continue;   // echo 次级波走旧的瞬间结算
      const w = fx.wave;
      w.prevR = w.r;
      w.r = Math.min(w.maxR, w.r + SHOCK_WAVE_SPEED * dt);
      // 波面带：[prevR - BAND, r + BAND]，只命中尚未命中过的敌人
      const lo = Math.max(0, w.prevR - SHOCK_WAVE_BAND);
      const hi = w.r + SHOCK_WAVE_BAND;
      for (const f of G.state.foes) {
        if (f.dead || w.hit.has(f)) continue;
        const d = G.dist(fx.x, fx.y, f.x, f.y);
        if (d >= lo && d <= hi) {
          w.hit.add(f);
          // 墙体阻挡：震荡波无法穿过障碍物打到后面的敌人
          if (G.losBlocked && G.losBlocked(fx.x, fx.y, f.x, f.y)) continue;
          const survived = shockHitFoe(w.owner, f, fx.x, fx.y, w.maxR, w.mult);
          if (survived) (w.survivors || (w.survivors = [])).push(survived);
        }
      }
      // 波扫完边缘后触发一次连锁震荡（echo 维度）
      if (!w.echoDone && w.r >= w.maxR) {
        w.echoDone = true;
        if (w.allowEcho) shockEchoFromFoes(w.owner, w.survivors || [], w.maxR, w.mult);
      }
    }
  }

  /** 震荡波对单个目标的伤害（距离衰减：中心 100% → 边缘 40%；终极无视衰减） */
  function shockHitFoe(p, f, x, y, maxR, mult) {
    const d = G.dist(x, y, f.x, f.y);
    const noFalloff = !!p.sk.shock.ultNoFalloff;
    const distFalloff = noFalloff ? 1 : Math.max(0.4, 1 - 0.6 * (d / maxR));
    G.dealDamage(p, f, skillDamage(p, mult * distFalloff), { noThorn: true, noShock: true, noSplash: true, tag: 'shock' });
    return f.dead ? null : f;
  }

  /** 连锁震荡（echo 维度）：在命中敌人处生成更小的次级波（50% 伤害，不再连锁） */
  function shockEchoFromFoes(p, hitFoes, r, mult) {
    const echoN = p.sk.shock.echo || 0;
    if (echoN <= 0 || !hitFoes.length) return;
    const picks = hitFoes.slice().sort(() => Math.random() - 0.5).slice(0, echoN);
    picks.forEach((f, i) => {
      G.state.skillFx.push({ kind: 'shockEcho', x: f.x, y: f.y, r: r * 0.45, t: 0, dur: 0.4, delay: 0.18 + i * 0.08, ult: !!p.sk.shock.ultNoFalloff });
      setTimeout(() => {
        if (!G.state.player || G.state.phase !== 'play') return;
        shockBlast(p, f.x, f.y, r * 0.45, mult * 0.5, false);
      }, 180 + i * 80);
    });
  }

  function shockBlast(p, x, y, r, mult, allowEcho) {
    // 瞬间结算版（供 echo 次级波与测试用）；主波走逐帧扩散 advanceShockWave
    const inRange = G.state.foes.filter(f => !f.dead && G.dist(x, y, f.x, f.y) <= r
      && !(G.losBlocked && G.losBlocked(x, y, f.x, f.y)));   // 不穿墙
    const hitFoes = [];
    for (const f of inRange) {
      const survived = shockHitFoe(p, f, x, y, r, mult);
      if (survived) hitFoes.push(survived);
    }
    if (allowEcho) shockEchoFromFoes(p, hitFoes, r, mult);
  }

  /* =========================================================
     浮游炮
     ========================================================= */
  /** 浮游炮位置：停在玩家周围固定方位（不旋转，随玩家移动） */
  function dronePos(p, i, count) {
    const a = 0.7 + (i / Math.max(1, count)) * Math.PI * 2;
    const R = 58;
    return { x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R };
  }

  function fireDroneVolley(p) {
    const d = p.sk.drone;
    for (let i = 0; i < d.count; i++) {
      const pos = dronePos(p, i, d.count);
      const target = nearestFoeFrom(pos.x, pos.y, p.range * 1.4);
      if (!target) continue;
      const a = Math.atan2(target.y - pos.y, target.x - pos.x);
      const spd = CFG.player.bulletSpeed;
      G.state.bullets.push({
        x: pos.x, y: pos.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        r: 4, dmg: skillDamage(p, d.mult), side: 'p', life: p.range / spd,
        owner: p, hit: [], skill: 'drone', color: '#c084fc',   // 紫色弹幕，与玩家箭矢区分
        noSplit: true,
        ult: !!d.ultPersistent,        // 终极·浮游炮阵：专属金色外观
        pierceLeft: d.ultPierce || 0   // 终极·浮游炮阵：子弹穿透 3 人
      });
    }
  }

  /* =========================================================
     感应地雷
     ========================================================= */
  function explodeMine(m, p, trigger, chained) {
    G.state.skillFx.push({ kind: 'shockEcho', x: m.x, y: m.y, r: m.r, t: 0, dur: 0.35 });
    // 首个触碰的敌人受全额伤害，范围内其余敌人只受一半
    const inRange = G.state.foes.filter(f => !f.dead && !f.fly && G.dist(f.x, f.y, m.x, m.y) <= m.r);
    for (const f of inRange) {
      const mul = f === trigger ? 1 : 0.5;
      G.dealDamage(p, f, Math.max(1, Math.round(m.dmg * mul)), { noThorn: true, noShock: true, noSplash: true, tag: 'mine' });
    }
    // 终极·灭世雷区：连锁引爆范围内其他地雷（只连锁一次，避免无限递归）
    if (p.sk.mine.ultChain && !chained) {
      const others = G.state.mines.filter(o => o !== m && G.dist(o.x, o.y, m.x, m.y) <= m.r);
      others.forEach(o => {
        const idx = G.state.mines.indexOf(o);
        if (idx >= 0) G.state.mines.splice(idx, 1);
        explodeMine(o, p, null, true);
      });
    }
  }

  /* =========================================================
     火球：直线飞行，命中炸开范围伤害；终极穿透 2 敌才爆炸
     ========================================================= */
  function explodeFireball(p, f) {
    G.state.skillFx.push({ kind: 'fireballBoom', x: f.x, y: f.y, r: f.r, t: 0, dur: 0.35, ult: !!f.ult });
    const inRange = G.state.foes.filter(e => !e.dead && G.dist(e.x, e.y, f.x, f.y) <= f.r + e.r);
    for (const e of inRange) {
      G.dealDamage(p, e, Math.max(1, Math.round(f.dmg)), { noThorn: true, noShock: true, noSplash: true, tag: 'fireball' });
    }
  }

  function fireFireballs(p) {
    const cfg = p.sk.fireball;
    for (let i = 0; i < cfg.count; i++) {
      const target = nearestFoe(p, p.range * 1.6);
      if (!target) break;
      const a = Math.atan2(target.y - p.y, target.x - p.x) + (i ? (Math.random() - 0.5) * 0.5 : 0);
      G.state.fireballs.push({
        x: p.x + Math.cos(a) * (p.r + 4), y: p.y + Math.sin(a) * (p.r + 4),
        vx: Math.cos(a) * cfg.speed, vy: Math.sin(a) * cfg.speed,
        r: 8, dmg: skillDamage(p, cfg.mult), splash: cfg.r,
        life: (p.range * 1.8) / cfg.speed, owner: p,
        pierceLeft: cfg.pierce || 0, hit: [], ult: !!p.evolved.fireball
      });
    }
  }

  /** 逐帧推进火球：命中敌人 → 若还有穿透次数则穿过并伤害，否则爆炸 */
  function updateFireballs(dt) {
    const arr = G.state.fireballs || [];
    const W = G.CFG.world;
    for (let i = arr.length - 1; i >= 0; i--) {
      const f = arr[i];
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.life -= dt;
      let boom = f.life <= 0 || f.x < 0 || f.x > W.w || f.y < 0 || f.y > W.h;
      // 撞到障碍物：直接炸开（不穿墙）
      if (!boom && G.state.obstacles && G.state.obstacles.length) {
        for (const o of G.state.obstacles) {
          if (G.circlePoly(f.x, f.y, f.r, o)) { boom = true; break; }
        }
      }
      if (!boom) {
        for (const e of G.state.foes) {
          if (e.dead || f.hit.indexOf(e) >= 0) continue;
          if (G.dist(f.x, f.y, e.x, e.y) < f.r + e.r) {
            f.hit.push(e);
            if (f.pierceLeft > 0) {
              // 终极：穿透命中直接伤害，耗尽后可再炸一次
              G.dealDamage(f.owner, e, Math.max(1, Math.round(f.dmg * 0.6)), { noThorn: true, noShock: true, noSplash: true, tag: 'fireball' });
              f.pierceLeft--;
            } else {
              boom = true;
            }
            break;
          }
        }
      }
      if (boom) {
        explodeFireball(f.owner, f);
        arr.splice(i, 1);
      }
    }
  }

  /* =========================================================
     回旋镖：飞出→返回，每段独立命中（去/回各一次），终点回到玩家
     ========================================================= */
  /** 发射单把回旋镖：index/total 决定本把的方位偏移，实现逐把散开发射 */
  function fireOneBoomerang(p, index, total) {
    const cfg = p.sk.boomerang;
    const target = nearestFoe(p, p.range * 1.8);
    const a = target
      ? Math.atan2(target.y - p.y, target.x - p.x) + (total > 1 ? (index / total) * Math.PI * 2 : 0)
      : (index / Math.max(1, total)) * Math.PI * 2;
    G.state.boomerangs.push({
      x: p.x, y: p.y, dirX: Math.cos(a), dirY: Math.sin(a),
      r: 11, dmg: skillDamage(p, cfg.mult), owner: p,
      speed: cfg.speed, dist: cfg.dist, traveled: 0, phase: 0, // phase 0=飞出 1=返回
      legs: cfg.legs, legIdx: 0, pierce: cfg.pierce, hit: [], rot: 0, ult: !!p.evolved.boomerang
    });
  }

  /** 一次性发完整批（兼容旧调用/测试）；游戏内实际走逐把队列 */
  function fireBoomerangs(p) {
    const cfg = p.sk.boomerang;
    for (let i = 0; i < cfg.count; i++) fireOneBoomerang(p, i, cfg.count);
  }

  /** 逐帧推进回旋镖：飞出到 dist 后折返，回到玩家算一段；legs 段后消失 */
  function updateBoomerangs(dt) {
    const arr = G.state.boomerangs || [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      const p = b.owner;
      const step = b.speed * dt;
      if (b.phase === 0) {
        // 飞出：沿单位方向向量推进（初始化时 dirX/dirY 即单位向量）
        b.x += b.dirX * step;
        b.y += b.dirY * step;
        b.traveled += step;
        b.rot += 16 * dt;
        // 撞到障碍物：立刻折返（不穿墙）
        let blocked = false;
        if (G.state.obstacles && G.state.obstacles.length) {
          for (const o of G.state.obstacles) {
            if (G.circlePoly(b.x, b.y, b.r, o)) { blocked = true; break; }
          }
        }
        if (blocked || b.traveled >= b.dist) { b.phase = 1; b.hit = []; b.traveled = 0; }
      } else {
        // 返回玩家：必须完整飞回手里才算一段完成（途中不换向）
        const dx = p.x - b.x, dy = p.y - b.y;
        const d = Math.hypot(dx, dy) || 1;
        // 移动量不超过剩余距离，避免越过玩家导致来回抖动
        const move = Math.min(step, d);
        b.x += (dx / d) * move;
        b.y += (dy / d) * move;
        b.traveled += step;
        b.rot -= 16 * dt;
        // 真正抵达手里；极端情况（玩家移速超过回旋镖）用长距离兜底并吸附到手里
        const landed = Math.hypot(p.x - b.x, p.y - b.y) <= p.r + b.r + 2;
        const stuck = b.traveled > b.dist * 5;
        if (landed || stuck) {
          b.x = p.x; b.y = p.y;   // 明确收回手中
          b.legIdx++;
          if (b.legIdx >= b.legs) { arr.splice(i, 1); continue; }
          // 下一段重新朝最近敌人飞出
          const target = nearestFoe(p, p.range * 1.8);
          const a = target ? Math.atan2(target.y - p.y, target.x - p.x) : Math.random() * Math.PI * 2;
          b.dirX = Math.cos(a); b.dirY = Math.sin(a);
          b.phase = 0; b.hit = []; b.traveled = 0;
          continue;
        }
      }
      // 命中判定（每段每敌一次，最多 pierce 个）
      if (b.hit.length < b.pierce) {
        for (const e of G.state.foes) {
          if (e.dead || b.hit.indexOf(e) >= 0) continue;
          if (G.dist(b.x, b.y, e.x, e.y) < b.r + e.r) {
            b.hit.push(e);
            G.dealDamage(p, e, Math.max(1, Math.round(b.dmg)), { noThorn: true, noShock: true, noSplash: true, tag: 'boomerang' });
            if (b.hit.length >= b.pierce) break;
          }
        }
      }
    }
  }

  /* =========================================================
     技能运行态更新（flow.update 每帧调用）
     ========================================================= */
  function updateSkills(dt) {
    const p = G.state.player;
    if (!p || p.dead || !p.skills || !p.sk) return;
    const sk = p.sk;

    /* ---- 震荡波：发射一道向外扩散的波，敌人被波面扫到才受伤害 ---- */
    if (p.skills.shock) {
      sk.shock.t -= dt;
      if (sk.shock.t <= 0) {
        sk.shock.t = sk.shock.cd;
        const s = sk.shock;
        spawnShockWave(p, p.x, p.y, s.r, s.mult);
      }
    }

    /* ---- 连锁闪电 ---- */
    if (p.skills.chain) {
      sk.chain.t -= dt;
      if (sk.chain.t <= 0) {
        sk.chain.t = sk.chain.cd;
        const used = new Set();
        for (let b = 0; b < sk.chain.bolts; b++) {
          const first = nearestFoe(p, p.range * 1.5, used);
          if (!first) break;
          fireChainBolt(p, first, used);
        }
      }
    }

    /* ---- 环绕飞刃：周期展开/收起；终极·无尽刃环常驻不收起 ---- */
    if (p.skills.orbit) {
      const o = sk.orbit;
      if (o.ultPersistent) {
        p.orbits = o.count;   // 常驻：始终保持展开
      } else if (o.active > 0) {
        o.active -= dt;
        p.orbits = o.count;
        if (o.active <= 0) { p.orbits = 0; o.t = o.interval; }
      } else {
        o.t -= dt;
        if (o.t <= 0) { o.active = o.dur; p.orbits = o.count; }
      }
    }

    /* ---- 浮游炮：周期部署，存活一段时间后消失；终极·浮游炮阵常驻 ---- */
    if (p.skills.drone) {
      const d = sk.drone;
      if (d.ultPersistent && d.active > 0) {
        d.shootT -= dt;
        if (d.shootT <= 0) { d.shootT = d.cd; fireDroneVolley(p); }
      } else if (d.active > 0) {
        d.active -= dt;
        d.shootT -= dt;
        if (d.shootT <= 0) { d.shootT = d.cd; fireDroneVolley(p); }
        if (d.active <= 0) { d.active = 0; d.t = d.interval; }
      } else {
        d.t -= dt;
        if (d.t <= 0) { d.active = d.life; d.shootT = 0.3; }
      }
    }

    /* ---- 感应地雷 ---- */
    if (p.skills.mine) {
      sk.mine.t -= dt;
      if (sk.mine.t <= 0) {
        sk.mine.t = sk.mine.cd;
        const cfg = sk.mine;
        for (let i = 0; i < cfg.count; i++) {
          // 选一个不在障碍物内部的位置（地雷不能埋进石头里）
          let mx = p.x, my = p.y, placed = false;
          for (let t = 0; t < 8; t++) {
            const a = Math.random() * Math.PI * 2;
            const dd = 60 + Math.random() * 40;
            const tx = p.x - Math.cos(a) * dd * (i ? -1 : 1);
            const ty = p.y - Math.sin(a) * dd * (i ? -1 : 1);
            let blocked = false;
            const obs = G.state.obstacles || [];
            for (const o of obs) {
              if (G.circlePoly(tx, ty, 10, o)) { blocked = true; break; }
            }
            if (!blocked) { mx = tx; my = ty; placed = true; break; }
          }
          if (!placed) continue;   // 周围全是障碍物：这枚不埋
          G.state.mines.push({
            x: mx, y: my,
            r: cfg.r, t: 0, dmg: skillDamage(p, cfg.mult), armed: 0.4,
            ult: !!cfg.ultChain,   // 终极·灭世雷区：专属外观
            fuse: MINE_FUSE   // 过期自爆（反挂机）
          });
        }
      }
      // 触发判定
      for (let i = G.state.mines.length - 1; i >= 0; i--) {
        const m = G.state.mines[i];
        if (!m) continue;
        m.t += dt;
        if (m.armed > 0) { m.armed -= dt; continue; }
        const trigger = G.state.foes.find(f => !f.dead && !f.fly && G.dist(f.x, f.y, m.x, m.y) < f.r + 18);
        if (trigger) {
          G.state.mines.splice(i, 1);
          explodeMine(m, p, trigger);
          continue;
        }
        // 过期自爆：一段时间未触发也会爆炸（挂机布雷不再是无限收益）
        m.fuse -= dt;
        if (m.fuse <= 0) {
          G.state.mines.splice(i, 1);
          explodeMine(m, p, null);
        }
      }
    }

    /* ---- 火球 ---- */
    if (p.skills.fireball) {
      sk.fireball.t -= dt;
      if (sk.fireball.t <= 0) {
        sk.fireball.t = sk.fireball.cd;
        fireFireballs(p);
      }
    }

    /* ---- 回旋镖：节拍到点后把 count 把排入队列，按 gap 逐把依次发射 ---- */
    if (p.skills.boomerang) {
      const bo = sk.boomerang;
      bo.t -= dt;
      if (bo.t <= 0) {
        bo.t = bo.cd;
        bo.queue = bo.count;
        bo.shootT = 0;   // 下一帧立刻发第一把
      }
      if (bo.queue > 0) {
        bo.shootT -= dt;
        if (bo.shootT <= 0) {
          fireOneBoomerang(p, bo.count - bo.queue, bo.count);
          bo.queue--;
          bo.shootT = bo.gap;
        }
      }
    }

    /* ---- 震荡波扩散推进（波面扫到敌人才命中） ---- */
    advanceShockWaves(dt);
    updateFireballs(dt);
    updateBoomerangs(dt);

    /* ---- 特效计时 ---- */
    for (let i = G.state.skillFx.length - 1; i >= 0; i--) {
      const fx = G.state.skillFx[i];
      fx.t += dt;
      if (fx.delay > 0) fx.delay -= dt;
      else if (fx.t >= fx.dur) G.state.skillFx.splice(i, 1);
    }
  }

  Object.assign(G, {
    LINES, LINE_KEYS, SKILL_CARDS, ULT,
    isLineMaxed, grantUltimate,
    applySkillBuild, initSkills, updateSkills,
    skillDamage, nearestFoe, nearestFoeFrom,
    dronePos, explodeMine, fireChainBolt, shockBlast, spawnShockWave, advanceShockWaves, SHOCK_WAVE_SPEED, MINE_FUSE,
    explodeFireball, fireFireballs, updateFireballs, fireBoomerangs, fireOneBoomerang, updateBoomerangs
  });
})(window.ABYSS = window.ABYSS || {});
