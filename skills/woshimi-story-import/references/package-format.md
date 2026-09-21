# 导入包与富文本规范

## 顶层字段

三类 JSON 都使用：

```json
{
  "schema": "woshimi.characterStories.v1",
  "formatVersion": 1,
  "playbookId": "后台剧本 ID",
  "createdAt": "ISO-8601 时间",
  "source": {"name": "源文档名", "sha256": "..."},
  "defaults": {
    "category": "人设",
    "status": "否",
    "priority": 0,
    "refId": 0,
    "deliveryScene": 0
  },
  "roles": ["角色甲", "角色乙"],
  "records": []
}
```

## 记录字段

每条记录至少包含 `title`、角色目标（`role` 或 `roles`）、`category`、`status`、`priority`、`refId`、`deliveryScene`、`paragraphCount`、`characterCount`、`contentText` 和 `contentHtml`。

- 单角色故事/投票：`role` 为角色名；可同时写入只含该角色的 `roles` 数组。
- 公共剧情/公共投票/阶段复盘：`role` 为 `null`，`roles` 为全部具体角色。公共剧情仍保存在“故事”数据包中。
- 可增加 `act`、`mode`、`sourceHeading(s)`、首尾摘要、图片统计等校对字段。

## HTML

人物故事与阶段复盘按 DOCX run 生成 `<span>`，保留字体、字号、正常颜色、粗体、下划线等源格式。段落用 `<p class="MsoNormal">` 并保留有效段落样式。

投票正文使用规范化样式：

```html
<p class="MsoNormal" style="margin:0pt 0pt 0.0001pt;color:#000000;text-align:justify;text-indent:0.0000pt"><span style="font-family:宋体;font-size:12pt">正文</span></p>
```

投票题干和投票说明行使用相同样式，并在 `<span>` 上增加 `font-weight:bold`。自动识别范围：

- 以 `？` 或 `?` 结尾的提问行，例如“你的名字是？”或“1.【平旦】制作密室用到了什么东西？”；
- 使用 `【】` 包围、包含“题”“问题”或“推理成功”等词的投票说明行。

选项、角色名和“公共投票”等普通分隔行保持正常字重。先去掉源文档的所有答案样式，再按上述语义重新加粗，避免把正确选项带入。投票 HTML 不得出现非黑色 `color`、`background-color`、`<b>`、`<strong>`、`text-decoration:underline` 或 `<u>`；`font-weight:bold` 只能出现在识别出的题干或投票说明行。

## 校对

- 故事目录：按记录列标题、角色、开头 20 字、结尾 20 字、段落和字数。
- 投票校对：先列标题/模式/角色映射，再逐条展示完整正文。
- 复盘校对：列阶段标题、源标题、全部角色、首尾摘要，并附完整正文及被排除的最终真相说明。
- 所有校对文件都应写明对应 JSON、源文档和记录数量。

## 后台匹配

- 角色按规范化后的显示名称精确匹配，不依赖后台列表预先导出。
- 重复键为标题加角色集合；角色数组排序不应影响判重。
- 纯公共剧情、纯公共投票和阶段复盘记录在表单中选择全部具体角色。不要同时选择“公共角色”。
