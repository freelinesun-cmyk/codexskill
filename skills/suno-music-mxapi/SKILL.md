---
name: suno-music-mxapi
description: Generate, poll, download, and organize Suno V6 music through the MXAPI Shell workflow. Use for Suno-style songs, instrumental BGM, extensions, or covers when an MXAPI key is configured; do not use for ordinary local audio editing.
---

# Suno Music via MXAPI

Use this skill to create Suno V6 music through MXAPI's asynchronous API. It is a third-party aggregation service, not a Suno first-party API. Treat a successful task as technical completion only; do not infer commercial-use rights from it.

## Before a paid generation

- Read `SUNO_API_KEY` only from an interactive `zsh` environment or a project-local ignored `.env`. Never place it in source code, manifests, command output, or chat.
- Use `SUNO_API_BASE`, defaulting to `https://open.mxapi.org` only if it is absent.
- Inspect the target project for existing audio files and manifests. Preserve nonempty tracks by default.
- Draft a dry-run that lists titles, prompts, models, target paths, and expected number of candidates. One generation request normally produces two candidates.
- Check the available points before a paid request when the account is in scope. The balance endpoint is `GET /api/v1/points/balance`.
- Obtain explicit confirmation immediately before a paid generation request unless the current user message explicitly directs generation. Creating an account, key, or recharge is not authorization to spend points.

## Shell configuration

For macOS, the user can put the following in `~/.zshrc` themselves:

```zsh
export SUNO_API_BASE='https://open.mxapi.org'
export SUNO_API_KEY='their-access-key'
```

They must run `source ~/.zshrc` or use a new terminal. Verify without exposing the secret:

```zsh
zsh -ic 'if [[ -n "$SUNO_API_KEY" ]]; then print "SUNO_API_KEY 已加载（长度 ${#SUNO_API_KEY}）"; else print "SUNO_API_KEY 未加载"; fi; print "SUNO_API_BASE=${SUNO_API_BASE:-未配置}"'
```

Run requests inside interactive zsh so the configured variables are available. Keep authentication out of browser/frontend code.

## API workflow

### 1. Submit a generation task

Use `POST $SUNO_API_BASE/api/v2/music/generate` with Bearer authentication and JSON. `chirp-hawk` is V6, `chirp-hawk-wild` is V6-wild, and `chirp-goose` is V6-mini.

For dialogue-safe game BGM, use inspiration mode with a nonempty `gpt_description_prompt` and set `make_instrumental` to `true`. The prompt must explicitly say instrumental only/no vocals, identify the story mood and instruments, keep intensity low enough for dialogue, and request smooth beginnings/endings for loops.

```json
{
  "gpt_description_prompt": "Chinese fantasy instrumental game BGM, no vocals or lyrics. Guqin, xiao, sheng and restrained percussion; mysterious, low dialogue-safe intensity, gentle loopable beginning and ending.",
  "make_instrumental": true,
  "mv": "chirp-hawk",
  "title": "Track title",
  "negative_tags": "vocals, lyrics, rap, EDM, loud drums, abrupt ending"
}
```

For a lyric song, use `prompt` for complete lyrics and `tags` for style, and set `make_instrumental` to `false`. `gpt_description_prompt` and `prompt` are alternative modes; do not mix them without a demonstrated API requirement.

The service returns two `task_ids`. Save both together with the title and prompt in the project's source manifest.

### 2. Poll each task

Use `GET $SUNO_API_BASE/api/v2/music/task?id=<task_id>` with the same `Authorization` header. Poll every 5–10 seconds until each task reports `completed` or `failed`; never treat `processing` as an error and never resubmit merely because the first query is incomplete.

On failure, summarize the API error and stop. Do not retry paid requests automatically.

On success, the completed response contains `data.result.fileInfo`, including `mp3Url`, `duration`, and filename metadata. Audio URLs may be short-lived, so download approved results promptly.

### 3. Download and verify

Download the selected `mp3Url` into the project's `music/` directory with a stable, readable filename. Write to a temporary file and rename atomically when implementing a reusable script. Then verify the file is nonempty and inspect duration with:

```zsh
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 music/track.mp3
```

Record the final filename, duration, byte count, selected model, source (`MXAPI Suno V6`), and prompt in a machine-readable manifest. Do not record API keys, task URLs, or signed download URLs.

### 4. Extensions and covers

- Extension: set `task` to `extend`, provide `continue_clip_id` and `continue_at` (seconds), then poll as a new task.
- Cover: set `task` to `cover`, provide `cover_clip_id` and target `tags`.
- Use `metadata` only when useful: `vocal_gender` (`m`/`f`) for vocal tracks, `control_sliders.style_weight` for style adherence, `control_sliders.weirdness_constraint` for variation, and `audio_weight` only for reference-audio workflows.

## Delivery

- For BGM, generate candidates first, listen/review them, and download only the user-selected track unless the user explicitly asks to retain all variants.
- State how many requests were submitted, how many candidates completed, selected filenames, durations, and any points/cost information returned by the provider.
- Keep generated music separate from source prompts and preserve existing approved tracks unless the user requests replacement.
- Do not claim copyright ownership or commercial clearance. For commercial game use, direct the user to verify the provider's terms and its right to sublicense outputs.
