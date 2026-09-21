# `baibian.characterStories.v1` 数据包

```json
{
  "schema": "baibian.characterStories.v1",
  "formatVersion": 1,
  "playbookId": "2501",
  "source": { "document": "剧本.docx" },
  "defaults": { "category": "人设", "visible": false, "aiSummary": false, "priority": 10 },
  "records": [{
    "title": "第一幕",
    "roles": ["角色甲"],
    "category": "人设",
    "visible": false,
    "aiSummary": false,
    "priority": 10,
    "deliveryRound": "",
    "publicStoryTitle": "",
    "contentText": "用于校对的纯文本",
    "contentHtml": "<div>普通文本</div><div><b>加粗</b><span style=\"color: rgb(255, 0, 0);\">红色</span></div>"
  }]
}
```

## 字段

- `schema`：必须是 `baibian.characterStories.v1`。
- `formatVersion`：当前为 `1`。
- `playbookId`：可选的目标剧本 ID；插件仍以当前页面为准，不自动跳到其他剧本。
- `roles`：必须是后台显示角色名数组。普通故事通常只有一项；公共剧情列出全部具体角色。
- `category`：按后台下拉框显示文字匹配。普通人物剧情默认“人设”；标题或分段明确属于任务的故事默认“目的”。用户指定统一分类时，每条记录都显式写入该分类，并覆盖自动判断。
- `visible`、`aiSummary`：布尔值。
- `priority`：数字或数字字符串。按每个角色独立排序；默认人物剧情使用 `100`、`90`、`80`……，其配套任务使用 `99`、`89`、`79`……。不同角色可以重复使用同一组优先级，不做跨角色的全局连续编号。用户明确要求统一值（例如全部为 `10`）时，每条记录都使用该值，不再自动递减。
- `deliveryRound`、`publicStoryTitle`：可选，非空时按后台下拉显示文字匹配。
- `contentText`：便于人工校对；若没有 `contentHtml`，插件按换行转为段落。
- `contentHtml`：优先导入的富文本，仅允许 `div`、`br`、`b` 和带规范 RGB 颜色的 `span`。

## 重复判定

插件把标题规范化后，与排序后的角色集合组合为唯一键。默认不选中重复记录；只有用户勾选覆盖开关后，重复记录才可导入。

## 合并校对稿

- 同一批次有多条记录时，除 JSON 和 Markdown 校对目录外，固定生成一个 `剧本名-角色故事合并校对稿.docx`。
- DOCX 的记录集合与数组顺序必须和 `records` 完全一致，不重新按标题或角色排序。
- 每篇使用“角色 / 标题”作为分隔标题，并在新页开始。公共剧情的角色显示为“全部角色”。
- 正文直接从 `contentHtml` 转换；若缺失才使用 `contentText`。保留段落、空行、加粗和 RGB 文字颜色，不恢复字体、字号、缩进、底色或图片。
- DOCX 只用于校对，不写回后台。后台勾选相同记录后，使用顶部“查看全文”拼接预览与该文件逐条比对。
