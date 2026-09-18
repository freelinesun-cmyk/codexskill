# mockup-to-game-ui

`mockup-to-game-ui` 是一个用于游戏 UI 落地的 Codex Skill。

当你有 UI 示意图、GPT 图像参考图或 AI 概念图时，可以用它让 Codex 帮你把参考图转成可接入项目的 UI 素材、资源清单和可编辑界面结构。它适合用于 Godot、Unity 或 HTML UI 项目中的菜单、弹窗、卡牌、商店、HUD 等界面接入。

## 安装

把这个仓库克隆到 Codex 的 skills 目录：

```powershell
git clone https://github.com/Fater666/mockup-to-game-ui.git "$env:USERPROFILE\.codex\skills\mockup-to-game-ui"
```

如果你已经下载了这个仓库，也可以直接把整个 `mockup-to-game-ui` 文件夹复制到：

```text
%USERPROFILE%\.codex\skills\
```

## 使用

在 Codex 对话里输入：

```text
$mockup-to-game-ui
```

然后告诉 Codex：

- 目标项目路径
- UI 示意图或参考图路径
- 想接入到哪个引擎、场景、页面或目录
- 输出文件希望放在哪里

示例：

```text
$mockup-to-game-ui
请把 C:\Projects\Game\mockups\shop.png 接入到 C:\Projects\Game 的商店界面，目标是 Godot 4。
```
