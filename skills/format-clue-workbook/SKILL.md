---
name: format-clue-workbook
description: Normalize Chinese murder-mystery clue Excel workbooks into the standard six-column clue import format, assign one continuous investigation-point ID per clue package, populate two clue-skill IDs, preserve descriptions, and verify the finished workbook. Use when the user asks to 整理线索表、规范线索格式、转换线索 Excel、生成调查点 ID，或按“线索整理”模板输出线索数据。
---

# woshimi 规范整理线索表格

把以分组标题和编号描述为主的原始 Excel，整理成后台可用的标准线索表。使用 `assets/线索整理模板.xlsx` 作为结构和样式基准。

## 必填输入

开始处理前确认以下内容：

1. 待整理的 `.xlsx` 文件。
2. 调查点起始 ID。
3. 线索技能-1 ID。
4. 线索技能-2 ID。

任一 ID 缺失时，先向用户索要，不得猜测、沿用历史值或使用模板中的示例值。将 ID 写为数值，而非文本。

推荐询问语：

> 请提供调查点起始 ID、线索技能-1 ID、线索技能-2 ID。

## 工具要求

使用 `spreadsheets:Spreadsheets` Skill 和 `@oai/artifact-tool` 完成读取、编辑、渲染与导出。先加载工作区依赖并完整遵循 Spreadsheets Skill。不得使用 `openpyxl`、`xlsxwriter` 或 `pandas.ExcelWriter` 写入工作簿。

必须读取并调用 `scripts/normalize_clues.mjs` 中的 `normalizeClues(sourceValues, options)` 生成完整数据矩阵。该脚本是调查点 ID 和分组边界的唯一来源。不要自行重写编号逻辑。

导出后必须重新导入生成的 `.xlsx`，并调用同一脚本中的 `verifyNormalizedRows(readBackValues, options)` 校验实际落盘值。不能只校验内存中的 `outputRows`；模板复制、填充或表格软件自动处理可能把中间包覆盖成类似 `9947、9947、9949` 的错误序列。校验失败时不得交付，需重新写入 D:F 后再次导出。

始终另存整理后的文件，不覆盖用户原文件。

## 转换规则

标准表头固定为：

| 列 | 字段 | 规则 |
|---|---|---|
| A | 线索包名字 | 仅同包第一条填写 `场景一、包名`；后续行留空 |
| B | 线索名 | 多条时为 `包名1`、`包名2`；仅一条时为 `包名` |
| C | 描述 | 保留原文，去掉开头的数字序号和 `.／．／、`；只有名称而无描述时留空 |
| D | 调查点id | 固定为 `调查点起始 ID + 当前线索包索引`；同包所有行共用该值 |
| E | 线索技能-1 | 每条线索填写用户提供的技能-1 ID |
| F | 线索技能-2 | 每条线索填写用户提供的技能-2 ID |

识别 `【人物调查】` 这类单元格为线索包标题。识别标题下方的非空行为该包线索。遇到完全空白的分隔行后，从 `场景一` 重新计算场景序号，但调查点 ID 继续递增，不得重置。

不要根据模板中的原行号、场景序号或上一单元格推导调查点 ID。不要对 D、E、F 列使用 `fillDown()`、模板分段复制或局部覆盖。把 `normalizeClues` 返回的 `outputRows` 作为一个完整二维矩阵一次性写入 A:F。

使用中文场景数字：一、二、三……。清理描述开头的序号时同时兼容普通空格、不间断空格和全角标点，不改写正文内容。

在 `Sheet2` 按出现顺序写入纯线索包名称，一行一个，不加“场景”前缀。

如果源文件不是“第一列包含分组标题及描述”的布局，先检查所有相关列并按语义映射；不要机械丢弃已经存在的描述、名称或分组信息。

## 格式要求

- 匹配模板的工作表名称、六列顺序、字体和线索包首行加粗样式。
- 加宽描述列并启用自动换行，确保长描述可读。
- 调查点和技能列使用整数格式。
- 冻结表头行。
- 保留 `Sheet2` 的包名辅助列表。
- 不添加无关图表、说明页或额外字段。

## 验证与交付

导出前完成以下检查：

1. 线索条数与源文件各包线索总数一致。
2. 每包只占用一个调查点 ID，并逐包验证 `实际 ID = 起始 ID + 包索引`。
3. 去重后的调查点 ID 必须严格等于从起始 ID 开始、长度等于线索包数量的连续序列；发现缺号、重复跨包或跳号时停止交付。
4. E、F 两列每条记录均为用户提供的对应 ID。
5. 每个描述已去掉开头序号，但正文无缺失。
6. 扫描公式错误。
7. 导出后重新导入文件，按 A 列非空行识别每个包的起点，并再次检查 D 列分段与连续性。
   必须使用 `verifyNormalizedRows`，它会检查表头、包起点数量、每包 ID、严格连续序列、整数类型及 E/F 技能 ID。
8. 渲染并目视检查 `Sheet1` 和 `Sheet2`，修复截断、错位或异常空白。

将最终 `.xlsx` 保存到当前任务的 `outputs/` 目录，并在回复中报告线索包数、线索数及调查点 ID 范围。
