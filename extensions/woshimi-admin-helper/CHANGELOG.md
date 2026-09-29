# 版本记录

本文件记录“我是谜后台辅助工具”的公开版本变化。后续每次发布都应先更新
`manifest.json` 版本号和本文件，再提交源码、安装包并创建同名 Git 标签。

## [2.5.12] - 2026-09-29

### 新增

- 批量添加投票的角色关联步骤新增顶部“关联所有角色”选项。

### 交互

- 勾选后，下方逐题的公共角色与具体角色复选框会禁用并变灰，无需再逐项选择。
- 提交时，每个新投票会自动关联当前剧本的全部具体角色；“公共角色”不在自动关联范围内。
- 不勾选时保持原有逐题设置逻辑。
- 兼容后台仅在选择“多选”后动态加载“多选全匹配”的表单，避免多选题进入角色关联步骤时报配置缺失。
- 批量添加投票时，标题末尾标注“多选”或“不定项”都会统一按 2 分、多选、多选全匹配创建。

## [2.5.11] - 2026-09-28

### 新增

- “添加投票选项图片”支持一次选择包含多个投票子目录的总文件夹，并自动填充当前勾选的全部投票。
- 新增《投票图片文件夹整理说明》，包含可直接交给 AI 使用的目录整理规范。

### 匹配与校验

- 投票子文件夹优先按清理后的完整标题匹配，支持唯一近似标题；标题差异较大时可用 `01、02……` 前缀按当前勾选列表顺序兜底。
- 子文件夹内图片按数字文件名自然排序并依次对应选项；未匹配、歧义、缺少文件夹或图片数量不符时禁止上传。
- 保留原有按单个投票选择多张图片的入口，选择文件夹后仍需人工确认才会上传。

## [2.5.10] - 2026-09-23

### 新增

- 批量添加线索图片时，可点击列表中的缩略图打开单张完整图片预览。

### 交互

- 大图按原始比例完整显示；支持点击遮罩空白处、右上角关闭按钮或按 Esc 返回匹配列表。
- 保留原有图片匹配顺序与批量上传流程，预览操作不会触发上传。

## [2.5.9] - 2026-09-23

### 新增

- 线索列表新增“批量修改线索的调查点”按钮；勾选线索后可统一选择新的调查点并逐条保存。

### 安全性

- 批量修改时先读取每条线索的完整编辑配置，仅替换调查点字段，保留名称、描述、主图、技能包及其他配置。
- 保存成功的线索自动取消勾选；失败项继续保留勾选并显示具体失败原因，便于重新处理。

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

[2.5.12]: https://github.com/freelinesun-cmyk/codexskill/tree/woshimi-admin-helper-v2.5.12/extensions/woshimi-admin-helper
[2.5.11]: https://github.com/freelinesun-cmyk/codexskill/tree/woshimi-admin-helper-v2.5.11/extensions/woshimi-admin-helper
[2.5.10]: https://github.com/freelinesun-cmyk/codexskill/tree/woshimi-admin-helper-v2.5.10/extensions/woshimi-admin-helper
[2.5.9]: https://github.com/freelinesun-cmyk/codexskill/tree/woshimi-admin-helper-v2.5.9/extensions/woshimi-admin-helper
[2.5.8]: https://github.com/freelinesun-cmyk/codexskill/tree/woshimi-admin-helper-v2.5.8/extensions/woshimi-admin-helper
[2.5.7]: https://github.com/freelinesun-cmyk/codexskill/tree/woshimi-admin-helper-v2.5.7/extensions/woshimi-admin-helper
