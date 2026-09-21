---
name: zenmux-media-generation
description: 通过 ZenMux API 快速生成或编辑项目图片、透明素材和首尾帧视频；用户要求原生透明、2K 源图、视频或 API 工作流时使用。
---

# ZenMux 媒体生成

用于通过 ZenMux API 交付项目内的图片或视频素材。默认优先**快速生成并交付**；只有用户明确要求 API 审计、模型能力核对、原生透明或验收报告时，才进入完整审计与验收流程。

普通预览图、无需 API 参数控制的单张图片，优先使用内置 `imagegen` Skill。

## 共通安全要求

- API 密钥只能从 `ZENMUX_API_KEY` 读取，不得写入项目、脚本、日志或聊天回复，也不得回显。
- 若新会话未继承密钥，可静默读取本机 shell 配置后检查；缺少密钥时说明未配置，不要求用户在聊天中发送。
- 生成会产生费用。用户未明确授权某项生成时，只能准备提示词或做只读检查；一次任务被接受后，不得未经许可重复提交。
- 不在输出、错误记录或聊天中暴露 Authorization 头、密钥或完整签名下载 URL。

## 默认：快速图片交付

适用于用户只想尽快拿到图片，且没有要求“API 审计”“模型核对”“原生透明”“Alpha 验收”或正式验收报告的情况。

- 先按模型协议选择端点，不能把 OpenAI `/models` 的结果当作全部图像模型清单：
  - OpenAI 图像模型（例如 `openai/gpt-image-*`）使用 `POST /images/generations`；必要时查询 `GET /api/v1/models`。ZenMux 的该接口不接受 `response_format`；请求 PNG 时传 `output_format: "png"`，并从成功响应的 `data[0].b64_json` 解码保存（不要把它改成 URL 返回格式）。
  - 其他图像模型（包括 ByteDance/Volcengine 与 Qwen）优先使用 Vertex 图像接口。必要时查询 `GET /api/vertex-ai/v1beta/models`，并确认模型同时含有 `text` 输入与 `image` 输出能力。
- Vertex 图像请求使用 `POST /api/vertex-ai/v1/publishers/{provider}/models/{model}:predict`，请求体为 `instances: [{prompt}]` 和 `parameters`。基础参数为 `sampleCount`、`aspectRatio`、`outputOptions: {mimeType: "image/png"}`；非 OpenAI 的分级分辨率使用 `sampleImageSize`，而不是 OpenAI 的 `size`。
- Vertex `predict` 图像请求可能在服务端同步等待 2–3 分钟（Seedream 5.0 Pro 的 2K 请求尤其如此）。提交后必须保留至少 300 秒的客户端/命令超时并持续等待完整 HTTP 响应；不得因 30 秒工具回传、并行分支结束或短超时中断连接。服务端可能在连接中断后仍完成并计费，但管理记录仅保留用量元数据，不能用于回收原始图片字节。
- 已确认的 Vertex 图像模型：
  - 豆包 Seedream 5.0 Pro：`bytedance/doubao-seedream-5.0-pro`。支持文字/参考图输入及图像输出；2K 直出使用 `sampleImageSize: "2K"`，并显式指定 `aspectRatio`。
  - Qwen Image 2.0 Pro：`qwen/qwen-image-2.0-pro`。支持文字/参考图输入及图像输出；根据 Vertex 实时模型能力设置分辨率与比例，不将 OpenAI `size` 字段传给它。
- 使用用户要求的比例、尺寸、质量与格式；未指定时选择适合用途的常规尺寸，不为追求验收而额外生成变体。
- 对普通透明图片：OpenAI Images 模型显式请求 `background=transparent` 和 `output_format=png`；Vertex 模型仅在实时能力或目标模型文档确认支持原生透明时才传递对应参数，并始终请求 PNG。默认不做 Alpha 包围盒、双底色合成或逐帧式视觉验收。
- 生成完成后保存到项目输出目录，用清晰新文件名避免覆盖既有素材。只确认文件已成功保存与基本像素尺寸，然后立即返回绝对路径链接。
- 用户明确说“尽快”“无需审计”“无需验收”时，不执行模型列表查询、模板制作、额外压缩尝试或复核轮次，除非这些步骤是 API 成功返回所必需的。

## 完整图片流程：仅在明确要求时使用

当用户明确要求 API 审计、模型能力核对、可审计参数、原生透明、透明 Alpha 验收、2K 源图验收或正式质量报告时：

1. 按模型协议做带鉴权的只读检查：OpenAI Images 模型查 `GET https://zenmux.ai/api/v1/models`；非 OpenAI 图像模型查 `GET https://zenmux.ai/api/vertex-ai/v1beta/models`。报告 HTTP 状态、目标模型是否可用及输入/输出模态。
2. 按实时能力设置模型、比例、分辨率和输出格式；不把网页参数当作 API 参数。Vertex 非 OpenAI 模型的 2K 请求应使用 `sampleImageSize: "2K"`，并在交付前检查实际像素尺寸。
3. OpenAI 模型的新图使用 `POST /images/generations`；非 OpenAI 图像模型的新图使用 `POST /api/vertex-ai/v1/publishers/{provider}/models/{model}:predict`，为整次请求设置至少 300 秒超时并等待完成。后者从 `predictions[].bytesBase64Encoded` 保存成图，或在返回 `gcsUri` 时立即下载保存。收到响应前绝不声明请求未完成，也不发起重复提交。需保留指定布局或进行合成时，使用目标协议对应的编辑方式并传入参考图。
4. 对“原生透明”素材，使用 PNG；OpenAI Images 模型额外传 `background=transparent`，Vertex 模型则先确认该模型的原生透明参数。编辑流程中提供布局模板或参考图；提示词写明 `isolated subject`、`actual transparent alpha`、`no scenery`、`no solid background`、`no checkerboard`。
5. 验证源图像素、格式、文件大小与构图。原生透明还必须验证 `hasAlpha=true`、四通道、可见主体 Alpha 包围盒，并用两种实色底图检查画布外没有背景残留。
6. 需要放大时，保留源图并明确说明“ZenMux 2K 生成后本地转换”，不得称为原生更高分辨率。

## 视频

使用 `POST /videos` 创建任务，保存任务 ID，并约每 15 秒轮询 `GET /videos/{jobId}`；仅在 `status=succeeded` 后下载 `content.video_url`。

- 快速交付：成功下载后保存并返回路径、时长和分辨率；不额外抽帧做视觉复核，除非用户要求。
- 完整验收：使用 `ffprobe` 检查编码、尺寸、帧率、时长和文件大小；对图生或首尾帧视频抽取开始、中段、结束帧，检查首尾对应、文字、主体和水印。发现问题时先报告并在重试前取得用户授权。
- 图生或首尾帧时，先读取输入尺寸；模型支持 `ratio=adaptive` 时优先使用。复杂且必须准确的文字应在输入图中锁定，不让视频模型临时重绘。

## 交付

- 快速模式：提供保存后的绝对路径链接，并简述模型、尺寸和格式。
- 完整模式：另外说明任务 ID、源图与成图关系、透明/视频验收结论及发现的问题。
- 不覆盖用户已有文件；用户明确要求替换时才覆盖对应成品，同时保留可用源图。
