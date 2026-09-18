---
name: mockup-to-game-ui
description: 将 UI 示意图、Image2 参考图、AI 概念图转成游戏可用的分层 PNG 素材、素材表和可编辑 UI 场景。Use when Codex needs to recreate or upgrade a game UI from a visual mockup/reference, call gpt-image-2/image_generation to generate new layered bitmap PNG assets instead of directly cropping the mockup, split UI frames/background/props/buttons/cards into separate runtime assets, never generate SVG, wire assets into Godot/Unity/HTML UI, or repair a mockup-driven UI whose layers, props, cards, text, icons, or z-order are incorrect.
---

# 示意图转游戏 UI

## 核心原则

- 把示意图当作风格和构图参考，不要把整张示意图当运行时底图。
- 必须调用 `gpt-image-2`/Responses `image_generation` 生成新的分层位图 PNG 素材；只有用户明确要求时才直接从示意图裁切。
- 严禁使用 SVG，不要手写或生成 SVG 作为素材替代。UI 框、背景、按钮、装饰、卡片组件都用 `gpt-image-2` 生成的位图 PNG。
- 图标、文字、数值、动态内容通常不替换，继续由项目运行时绑定。
- 一个格子只放一个层级资产。不同 z-order、不同可调节点、不同功能的元素必须拆开。
- UI上的装饰、单独的组件也必须独立成格、独立接入，不要和背景或卡片烘在一起。
- 素材表格按资产数量决定，不固定 4x3；先定资产 ID 顺序，再生成。
- 保留原始生成图到 `asset_sources/` 或 `art_sources/`，运行时 PNG 放到项目现有 `assets/` 目录。

## 工作流

1. **读取工程与示意图**
   - 找到现有 UI 场景、脚本绑定、图标目录、运行时资源目录。
   - 判断哪些是视觉层，哪些是动态层：文字、图标、货币数值、属性值、卡片内容通常保留运行时逻辑。
   - 记录目标分辨率、场景坐标系和现有节点命名习惯。

2. **做分层清单**
   - 按职责拆分：背景 tile、顶部栏、按钮框、货币框、属性外框、属性内框、标题牌、属性行条、卡片底板、图标框、标题条、效果条、选择按钮、夹子、装饰物。
   - 如果两个元素需要在场景里单独移动、缩放、开关、替换或排序，就必须拆成两个资产。
   - 卡片不要把底板、图标框、标题牌、效果条和按钮一起生成；它们是不同层级。

3. **生成源素材表**
   - 使用 `gpt-image-2` 进行素材生成；如果当前环境暴露的是 Responses 原生 `image_generation` 工具，就通过该工具指定/调用 `gpt-image-2`，不要改用 SVG、HTML/CSS 矢量图或手绘矢量占位。
   - 按层级分批生成，不要把全局 UI、卡片组件、背景装饰混在同一张表里。
   - 使用 chroma-key 绿幕或纯色背景，要求每格居中、留白、无文字、无数字、无图标、无水印。
   - 固定顺序写在提示词里，例如：`1) top_bar_base, 2) detail_button_frame ...`。
   - 如果需要提示词模板，读取 [prompt-patterns.md](references/prompt-patterns.md)。

4. **检查再切分**
   - 先看源素材表，不合格就重生或拆表：跨格污染、多个层级出现在一格、植物和书在一格、卡片底板压到组件格、出现文字/图标，都不合格。
   - 如果 AI 源表轻微跨格污染，保留原图到 `raw/`，再生成清理后的干净源表；不要把污染源表作为主素材板。

5. **切图与清理**
   - 对常规表按网格切片，输出透明 PNG。
   - 只清理背景色，不要误删绿色主体资产；植物、绿色夹子这类资产要避免按“绿色即透明”粗暴处理。
   - 对被邻格污染的资产，用连通块、裁切范围或手工规则保留目标主体。
   - 命名要表达层级，例如 `card_body_blue.png`、`icon_well_frame.png`、`file_holder_prop.png`。

6. **接入可编辑 UI 场景**
   - 用 `TextureRect`/Sprite/图片节点承载每个视觉层，用 Label/Button 承载动态内容和点击区域。
   - 脚本只绑定数据、图标、文本、按钮事件、卡片颜色变体；不要在脚本里重建整套静态 UI。
   - 场景里保持真实层级：背景在底，装饰在卡片下方或上方按示意图排序，卡片组件按底板、夹子、图标框、图标、标题牌、文字、效果条、按钮排序。

7. **验证**
   - 生成临时 contact sheet 或布局预览，检查层级、边缘透明、文字安全区、卡片和装饰 z-order；检查后删除临时预览。
   - 验证场景引用的资源路径存在，PNG 有 alpha 且非空，运行时目录没有 SVG。
   - 能运行引擎时，用 Godot headless/Unity 导入检查；不能运行时明确说明。
   - 跑 `git diff --check`，不要改动无关文件，不要回滚用户已有改动。

## 常见失败点

- 用整张示意图裁成背景，导致文本、图标、卡片内容被烘死。
- 一格里同时生成卡片底板、按钮、标题牌和图标框，导致后续无法调层级。
- 固定要求 4x3，结果为了填满格子把无关层级合并。
- 绿幕清理过度，把绿色夹子、植物、绿色卡片边缘也删掉。
- 只看单个 PNG，不做完整布局预览，导致书柜、植物或装饰压到卡片上。
- 旧合成资源还留在运行时目录，场景误引用旧图。
- 为省事生成 SVG/矢量占位图，导致风格、笔触、透明边缘和引擎导入结果与 GPT 位图素材不一致。
