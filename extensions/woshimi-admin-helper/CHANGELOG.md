# 版本记录

本文件记录“我是谜后台辅助工具”的公开版本变化。后续每次发布都应先更新
`manifest.json` 版本号和本文件，再提交源码、安装包并创建同名 Git 标签。

## [2.5.8] - 2026-09-22

### 新增

- 批量添加投票选项支持 `A选项正文`、`B选项正文`、`C选项正文` 这类无空格、无标点的连续字母序号格式。

### 修复

- 保留选项正文内部的中文逗号，避免将一行误拆成多个选项。
- 仅在整组字母连续且正文包含中文时移除前缀，降低对普通英文文本的误判。

## [2.5.7] - 2026-09-18

### 新增

- 线索列表分页自动选择可容纳当前全部记录的最小可用页容量；若没有足够大的选项，则选择最大页容量。

### 调整

- 将线索列表分页逻辑拆分到独立的 `clue.js`，减少与其他页面功能的耦合。

[2.5.8]: https://github.com/freelinesun-cmyk/codexskill/tree/woshimi-admin-helper-v2.5.8/extensions/woshimi-admin-helper
[2.5.7]: https://github.com/freelinesun-cmyk/codexskill/tree/woshimi-admin-helper-v2.5.7/extensions/woshimi-admin-helper
