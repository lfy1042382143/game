# 深渊试炼 · Abyss Trial

回合制属性成长战斗小游戏。杀掉一头怪物 → 三选一强化 → 迎接下一波，直到倒下。
纯前端、零依赖、零构建，双击 `index.html` 即可游玩。

## 玩法

- **攻击**：常规输出，伤害 = 攻击 − 目标防御（带 15% 保底）
- **防御**：按防御属性换护盾（`8 + 防御 × 2.4 + 壁垒甲加成`），护盾上限为生命上限的 50%，不防御的回合衰减 30%
- **升级**：每波胜利后从三张卡里选一张 —— 属性、新装备、强化已有装备、升华（升稀有度）
- **装备**：4 部位（武器 / 护甲 / 头盔 / 饰品）× 3 件，五档稀有度，可升到 Lv.5 后升华
- **怪物**：每 4 波获得一件装备，血量低于 35% 会转入防御；每 5 波是 BOSS

快捷键：`空格/回车` 攻击、`D/F` 防御、`R` 重开、`Esc` 关闭详情面板。

## 目录结构

```
index.html                 仅结构：卡片、弹窗、详情面板的 DOM 骨架
css/
  base.css                 重置、主题底色、背景层、应用骨架
  battle.css               顶栏、角色卡（头像/血条/护盾条/属性/装备栏/状态）、VS 区
  hud.css                  BOSS 进度点、操作按钮
  effects.css              伤害飘字、动作动画
  overlay.css              升级三选一、结算弹窗、波次横幅
  inspector.css            属性 / 装备详情面板
  responsive.css           窄屏与矮屏适配（最后加载，便于覆盖）
js/
  core/
    config.js              所有数值：属性成长、怪物曲线、装备定义、词库
    utils.js               $ / sleep / pick / clamp / fmt
    audio.js               WebAudio 实时合成音效
  systems/
    equipment.js           装备实例、属性聚合、战力重算
    state.js               全局状态与单位工厂
    combat.js              伤害结算、护盾、暴击、吸血、反伤、流血
    monster.js             按波次生成怪物与随机装备
    cards.js               升级卡池与三选一交互
    flow.js                回合时序、波次推进、胜负判定
  ui/
    dom.js                 集中缓存 DOM 引用
    render.js              血条 / 属性 / 装备栏 / 状态 / 按钮
    fx.js                  飘字、冲击、横幅
    inspector.js           详情面板：基础值→装备→合计、词条、对抗预估
  main.js                  事件绑定与启动（必须最后加载）
```

模块之间**不互相 import**，全部挂到 `window.ABYSS` 命名空间上，靠 `<script>` 顺序解决依赖：

```js
(function (G) {
  'use strict';
  const { CFG, clamp } = G;      // 依赖在加载时解构，所以被依赖的模块必须排在前面
  function foo() { /* ... */ }
  Object.assign(G, { foo });     // 对外暴露
})(window.ABYSS = window.ABYSS || {});
```

这样既能分文件维护，又不需要打包器，`file://` 直接打开也不会被 ES Module 的 CORS 策略拦住。

## 调整数值

改 `js/core/config.js` 一处即可，不用碰其它文件：

| 字段 | 作用 |
| --- | --- |
| `player` | 初始生命 / 攻击 / 防御 |
| `attr` | 三种属性的五档升级值（白→金） |
| `mon` | 怪物成长曲线：`hp0/hpK/hpQ` 生命、`atk0/atkK/atkQ` 攻击、`def0/defK` 防御、`bossHp/bossAtk` BOSS 倍率、`eqEvery` 装备间隔、`bleedMul` 流血强度 |
| `heal` | 每波战后回复（有上限，避免滚雪球） |
| `defend` | 护盾公式、上限百分比、未防御时的衰减 |
| `rage` | 单场超过 N 回合后怪物每回合增伤，防止无限僵持 |
| `forge` | 装备强化等级上限 |

装备词条在 `ITEM_DEFS` 里，`stat` 是各稀有度的基础属性，`step` 是每级追加，`mk(r, L0)` 算出具体效果，`desc/tag` 负责文案。

## 平衡基线

用真实游戏代码跑 40 局自动对局（随机选卡、12% 概率防御）的统计：

| 指标 | 结果 |
| --- | --- |
| 中位波数 | 21 |
| p10 / p90 | 14 / 28 |
| 平均 | 20.6 |
| 每波回合 | 5~6 |

改完数值建议同样跑一遍批量对局，确认中位仍落在 18~22 波区间。

## 部署

线上地址：<https://abyss-trial.pages.dev>（Cloudflare Pages，项目名 `abyss-trial`）

```bash
bash scripts/deploy.sh        # 生成 dist/ 并推送到 Cloudflare Pages
```

脚本只拷贝 `index.html`、`css/`、`js/` 到 `dist/`（`.git/`、`.workbuddy/` 不上传），再执行 `wrangler pages deploy`。
首次在新机器部署需先 `npx wrangler login` 授权。

`wrangler.toml` 里固定了项目名与产物目录，所以也可以直接：

```bash
npx wrangler pages deploy
```

