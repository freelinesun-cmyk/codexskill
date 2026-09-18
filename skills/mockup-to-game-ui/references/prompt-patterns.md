# 示意图转游戏 UI 提示词模板

## 通用约束

在生成任何素材表时加入这些约束：

```text
Style reference: follow the provided UI mockup's game art style, color mood, line weight, chunky readable shapes, clean black outline, light office-game texture.
Output: a clean sprite sheet of separate UI assets, one asset per cell, evenly spaced grid, flat chroma green background (#00ff00), generous padding.
Constraints: no readable text, no numbers, no icons, no characters, no logos, no watermark, no full UI screenshot, no merged layers, no overlapping cells.
Each cell must contain exactly one requested asset. Do not combine assets that will be separate layers in the game UI.
```

## 全局 UI 层素材表

用于顶部栏、按钮框、属性面板、行条等全局控件：

```text
Create a 2D game UI asset sheet from the provided UI mockup reference.
Grid: [columns] columns x [rows] rows, one centered asset per cell.
Assets in exact left-to-right, top-to-bottom order:
1) top_bar_base
2) detail_button_frame
3) currency_panel_frame
4) reroll_button_frame
5) stats_outer_frame
6) stats_inner_panel
7) stats_title_tab
8) stat_row_strip

Important: no Chinese text, no dollar sign, no stat icons, no card content. Frames and panels only.
```

## 卡片分层素材表

卡片底板、组件、夹子建议拆成多张表；不要强行塞进 4x3。

### 卡片底板

```text
Create a 4-asset sprite sheet of separate upgrade card body panels.
Grid: 4 columns x 1 row.
Assets in exact order:
1) card_body_yellow
2) card_body_blue
3) card_body_purple
4) card_body_green

Only the card body/background frame. No icon well, no title plate, no effect strip, no choose button, no clip, no text.
```

### 卡片组件

```text
Create a 4-asset sprite sheet of separate upgrade card UI components.
Grid: 4 columns x 1 row.
Assets in exact order:
1) icon_well_frame
2) title_plate
3) effect_strip
4) choose_button_frame

Each component must be isolated in its own cell. No card body, no icon, no text.
```

### 颜色夹子

```text
Create a 4-asset sprite sheet of separate small card corner clips.
Grid: 4 columns x 1 row.
Assets in exact order:
1) clip_green
2) clip_blue
3) clip_purple
4) clip_yellow

Only the small clip asset. No card body, no background prop, no text.
```

## 背景与装饰素材表

植物、书、文件夹、管线必须单独成格：

```text
Create a 2D game environment UI decoration sprite sheet from the provided UI mockup reference.
Grid: [columns] columns x [rows] rows, one asset per cell.
Assets in exact order:
1) tile_patch_large
2) top_tile_patch
3) option_area_tile_patch
4) planter_prop
5) file_holder_prop
6) side_office_pipe_prop

Important: planter and file holder are separate assets in separate cells. Do not combine them. No UI cards, no text, no icons.
```

## 质量检查提示

生成后逐项检查：

- 是否每格只有一个层级资产。
- 是否有文字、数字、图标或水印。
- 是否有跨格污染、边缘截断、主体太小。
- 卡片组件是否被卡片底板污染。
- 绿色主体是否会被后续 chroma 清理误删。
- 背景装饰是否独立，不和卡片或背景烘在一起。
