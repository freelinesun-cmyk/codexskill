# Web AVG integration reference

Use this reference when the target is a static HTML/CSS/JavaScript AVG game.

## Recommended project layout

```text
game/
  .env                         # local only; ignored by version control and packages
  voice-config.json            # speaker to MiniMax voice mapping
  tools/
    generate_minimax_voice.py
    generate_minimax_music.py
  dist/
    audio/<sequence>/<line>_<speaker>.mp3
    music/<track>.mp3
    voice-manifest.js
    music-manifest.js
```

`.env` is needed for API voice generation (and only for music when an already-entitled account explicitly uses the legacy API):

```text
MINIMAX_API_KEY=...
# MiniMax China API base (matching https://platform.minimax.cn/console/access):
MINIMAX_API_BASE=https://api.minimaxi.com
# Only when the user explicitly uses an overseas/global MiniMax account:
# MINIMAX_API_BASE=https://api.minimax.io
```

## MiniMax service region

Use `https://www.minimax.cn/audio/music` as the default China music workflow. It is a logged-in web studio, not an API endpoint: create a pure-instrumental track there, review it in Works, then download the approved MP3 into `dist/music/`.

Use the MiniMax China console, `https://platform.minimax.cn/console/access`, to sign in and obtain or manage a China-region key for voice API work. Requests from the game-generation voice script go to the China API base, `https://api.minimaxi.com`; do not send API requests to the console URL.

The overseas/global console is `https://platform.minimax.io` and its API base is `https://api.minimax.io`. Select that pair only when the user explicitly identifies their account as overseas/global. A key stored in `MINIMAX_API_KEY` does not itself encode the region, so make the intended endpoint explicit with `MINIMAX_API_BASE` whenever there is any uncertainty.

## Voice request shape

For MiniMax-compatible T2A, send `POST /v1/t2a_v2` with a bearer key. Typical fields are:

```json
{
  "model": "speech-2.8-hd",
  "text": "line text",
  "stream": false,
  "language_boost": "Chinese",
  "output_format": "hex",
  "voice_setting": {
    "voice_id": "configured voice id",
    "speed": 1,
    "vol": 1,
    "pitch": 0
  },
  "audio_setting": {
    "sample_rate": 44100,
    "bitrate": 128000,
    "format": "mp3"
  }
}
```

Decode `data.audio` from hex only after checking `base_resp.status_code` is zero. Record `extra_info.audio_length` when returned.

To inspect account voices before configuration, call `POST /v1/get_voice` with `{"voice_type":"all"}` and present the available voice IDs for user approval.

## Music creation and import

In the China web studio, select **纯音乐**, enter a title and a style prompt, then generate one candidate after the user confirms the shown credit cost. A good prompt includes: instrumental/no vocals, scene and emotional direction, selected instruments, low intensity under dialogue, and a natural start/end for looping.

After the user chooses a result, download it and name it using the stable game key, for example `dist/music/ancient-tomb.mp3`. Update `music-manifest.js` with the public relative path and confirm the file exists before testing the scene BGM.

The bundled `generate_minimax_music.py` script is retained only for accounts known to have legacy Music API access. Do not use it as the first attempt for a new account: an HTTP 410 with status 2153 means stop and use the China web studio instead.

## Browser manifests

Keep generated manifests data-only. For example:

```js
window.VOICE_MANIFEST={
  "prologue:0":{"file":"audio/prologue/00_arno.mp3","speaker":"Arno","duration_ms":7800}
};
window.MUSIC_MANIFEST={
  "lab":{"file":"music/neve-lab.mp3","title":"Laboratory"}
};
```

Do not expose the API key, raw provider responses, or internal prompts in public browser files.

## Existing Lost Land implementation

The current project’s voice and legacy-music scripts live under `game/tools/`; use the voice dry-run modes before rebuilding that part of the pipeline:

```bash
cd game
python3 tools/generate_minimax_voice.py --dry-run
python3 tools/generate_minimax_voice.py --list-voices
```

After explicit approval to make API calls, first create a short sample:

```bash
python3 tools/generate_minimax_voice.py --generate --limit 4
```

For BGM, create and approve the track at `https://www.minimax.cn/audio/music`, then import it into `dist/music/` and update the manifest. Run `generate_minimax_music.py` only if the user explicitly confirms that their account has legacy API access. The existing scripts resume completed assets by default; use `--force` only for an explicitly requested regeneration.
