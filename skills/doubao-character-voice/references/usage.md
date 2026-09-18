# 使用说明

## 单个独立角色音频

每个请求 JSON 对应一个音频。将“角色特征 + 当前情绪 + 原文台词”写入 `text_prompt`，没有连续剧情需求时不要添加其他角色、BGM 或环境音。

```json
{
  "model": "seed-audio-1.0",
  "text_prompt": "纯中文人物配音，无背景音乐，无环境音。林醒枝：成年女性，爽朗直接，语速自然偏快。她说：‘没有可比性！’",
  "audio_config": {"format": "mp3", "sample_rate": 44100, "enable_subtitle": true},
  "watermark": {}
}
```

```zsh
python3 scripts/generate_audio.py --request /absolute/line.json --output /absolute/line.mp3 --subtitle /absolute/line.subtitle.json --dry-run
python3 scripts/generate_audio.py --request /absolute/line.json --output /absolute/line.mp3 --subtitle /absolute/line.subtitle.json --confirm
```

## 批量独立音频

清单中的每项都独立调用、独立输出，不会被合成为连续对话。相对路径以清单文件所在目录为准。

```json
{
  "items": [
    {"id": "mai-yan-001", "request": "requests/mai-yan-001.json", "output": "audio/mai-yan-001.mp3", "subtitle": "audio/mai-yan-001.subtitle.json"},
    {"id": "lin-xingzhi-001", "request": "requests/lin-xingzhi-001.json", "output": "audio/lin-xingzhi-001.mp3"}
  ]
}
```

```zsh
python3 scripts/generate_audio.py --batch /absolute/batch.json --dry-run
python3 scripts/generate_audio.py --batch /absolute/batch.json --confirm
```

输出已存在时默认跳过；仅在用户同意覆盖时用 `--force --confirm`。

## 连续多人场景

一个请求只生成一段音频。使用同一 `text_prompt` 描述角色顺序、持续情绪和必要的环境声：

```text
纯中文连续剧情对白，无背景音乐。赵隽安（成年男性，斯文温和，焦急克制）说：“什么？阿颜，你不要做傻事啊！”麦瑜（成年女性，直率锋利）紧接着说：“赵隽安，你不想我妹出家，那你快娶我妹啊！”室内保持安静。
```

## 参考、时间轴与参数

- `references` 可包含最多 3 条音频参考（每条最多 30 秒）或 1 张图片参考；两类参考不能混用。
- 音频参考使用 `@音频1` 等在提示词中引用。`speaker`、`audio_data`、`audio_url` 三者互斥。
- 图片参考使用 `image_data` 或 `image_url`，二者互斥。
- 时间轴可写 `[2.0s:5.0s]`；单次输出最长 120 秒，提示词最多 3000 字符。
- `audio_config` 支持 `format`（mp3/wav/pcm/ogg_opus）、`sample_rate`、`speech_rate`、`loudness_rate`、`pitch_rate`、`enable_subtitle`。常规配音建议 MP3、44100 Hz、字幕开启。

## 凭证与排错

脚本只读取 `VOLCENGINE_SPEECH_API_KEY`。不要将 Key 写入 JSON、清单或项目文件。`401 Invalid X-Api-Key` 时停止重试，检查豆包语音控制台中的 Key 状态和 Shell 配置。费用以 API 返回的 `original_duration` 和最终账单为准；账单可能延迟。

官方文档：<https://docs.volcengine.com/docs/DoubaoVoice/audio-generation-http?lang=zh>
