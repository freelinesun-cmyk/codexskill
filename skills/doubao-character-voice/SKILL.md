---
name: doubao-character-voice
description: Generate Chinese character voices, single-line clips, multi-character dialogue scenes, and batches of independent scripted audio with Volcengine Doubao Audio Generation. Use for Chinese character speech output; do not use for music-only generation or ordinary audio editing.
---

# 豆包人物语音生成

通过豆包语音的 `seed-audio-1.0` 生成角色配音、独立台词、连续多人对白或声景音频，可结合自然语言控制人物的性别、年龄、音色、口音、情绪、语速、音效和时间点。

## 先选生成模式

不要默认把台词拼成连续会话。根据交付方式选择：

| 模式 | 适用场景 | 输出 |
| --- | --- | --- |
| 单句 / 单角色 | 游戏逐句播放、角色独白、一个人多段台词 | 一条台词一个 MP3 |
| 批量独立台词 | 多个角色/段落，彼此不需无缝衔接 | 批量清单中的多个 MP3 |
| 连续多人场景 | 需要自然接话、停顿、共同环境声 | 一段场景 MP3 |
| 声音 / 声景设计 | 参考音色、参考图片、时间轴或明确音效 | 一段设计音频 |

用户没有说明时，先判断音频是运行时“逐句播放”还是要作为“一段场景”播放：前者按独立文件生成，后者才使用连续多人场景。单句配音默认无 BGM、无环境音。

## 凭证与接口

- 只从 Shell 环境读取 `VOLCENGINE_SPEECH_API_KEY`；不要读取、打印或写入旧的 `VOLCENGINE_AUDIO_API_KEY`，更不要把密钥写进项目文件、请求 JSON 或聊天。
- 这是**豆包语音**控制台创建的 API Key，不是火山方舟 API Key。若服务端返回 `401 Invalid X-Api-Key`，停止重试，并请用户检查豆包语音控制台中的 Key 状态、复制方式及 Shell 配置。
- 官方端点为 `POST https://openspeech.bytedance.com/api/v3/tts/create`，鉴权头为 `X-Api-Key`，模型为 `seed-audio-1.0`。最长单次输出为 120 秒，音频 URL 仅短暂有效；优先保存响应中的 Base64 音频到本地。
- 生成会消耗额度。除非用户本轮明确要求生成或重试生成，先使用 `--dry-run` 展示请求概要，再在实际调用前获得确认。

## 工作流程

1. 按选择的模式，把用户给出的角色资料和台词整理为单请求 JSON 或批量清单。`text_prompt` 最多 3000 字符；明确标注每位说话人，附上声音和表演方向。不要凭空改写用户台词。
2. 若用户提供了角色音色参考，可在 `references` 中传最多 3 条、每条不超过 30 秒的参考音频；否则用自然语言区分音色。没有参考素材时，不要假装做了声音复刻。
3. 默认输出 MP3、44100 Hz、开启字幕。不要混入 BGM，除非用户明确要求；音效也应只按剧本需要加入。
4. 先运行脚本的 `--dry-run`，核对模型、提示词长度、输出路径和字幕路径。实际生成时传 `--confirm`；完成后检查 MP3 非空、读取实际时长，并交付本地文件及字幕 JSON。

## 请求提示词写法

独立台词只写一个角色及其当前台词，避免“接话”“上一句”等连续关系。例如：

```text
纯中文人物配音，无背景音乐，无环境音。
麦瑜（成年女性，直率锋利，语速偏快）说：“赵隽安，你不想我妹出家，那你快娶我妹啊！”
```

连续多人场景才应在同一提示词中按顺序描述所有角色，让同一角色的描写保持一致。无论哪种模式，都避免只写“男声 1 / 女声 2”而不提供人物特征。

参考音频最多 3 条、每条不超过 30 秒，并在 `text_prompt` 用 `@音频1` 等按顺序引用；图片参考最多 1 张，且不能与音频参考混用。时间控制可在提示词中写 `[2.0s:5.0s]`。详见使用说明。

## 脚本

新任务使用通用脚本 [scripts/generate_audio.py](scripts/generate_audio.py)：

```zsh
python3 scripts/generate_audio.py \
  --request /absolute/path/dialogue_request.json \
  --output /absolute/path/dialogue.mp3 \
  --subtitle /absolute/path/dialogue.subtitle.json \
  --dry-run
```

确认后移除 `--dry-run` 并加入 `--confirm`。请求 JSON 只包含 `model`、`text_prompt`、可选 `references`、`audio_config` 和 `watermark`，不包含任何密钥。批量独立文件的清单格式、完整参数和使用示例见 [references/usage.md](references/usage.md)。旧 `generate_dialogue.py` 仅保留兼容。

## 交付检查

- 保留生成请求 JSON，便于复现；不要保留包含响应 `audio` Base64 的临时文件。
- 输出名使用稳定、可读的中文或英文 slug；同名成品仅在用户明确要求覆盖时替换。
- 若一次对白超过 120 秒或提示词超过 3000 字，按剧情自然分段，并让用户确认分段方式后生成。
- 批量模式中既有文件默认跳过；只有用户明确要求重做时才传 `--force`。
