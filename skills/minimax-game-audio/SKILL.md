---
name: minimax-game-audio
description: Generate MiniMax dialogue voices and create/import instrumental game music, then integrate audio and manifests into web-game builds. Defaults to the MiniMax China music-creation website for BGM and uses the API for voice work; do not use for ordinary local audio editing.
---

# MiniMax Game Audio

Create reliable, resumable game-audio pipelines around MiniMax. Preserve the project’s existing dialogue flow and public asset layout; generated audio is an implementation detail, not a reason to rewrite gameplay.

## Before generating

- Inspect the target project for existing dialogue data, audio playback code, manifests, generation scripts, and `.env.example` before adding anything.
- Treat API keys as secrets. For API-based voice work, read `MINIMAX_API_KEY` only from the shell environment or a project-local ignored `.env`; never put it in browser code, manifests, ZIPs, logs, or chat. Music created in the China web studio does not require exposing a key to the project.
- Default to **MiniMax China** when the user has not selected a region. Use `https://www.minimax.cn/audio/music` for BGM creation, `https://platform.minimax.cn/console/access` for China API-key management, and `https://api.minimaxi.com` for China voice API requests. The web studio and console URLs are not API request endpoints.
- Use the overseas/global console and API (`https://platform.minimax.io` / `https://api.minimax.io`) only when the user explicitly says they have chosen an overseas/global MiniMax account or supplies that API base. Do not redirect a China-console user to the overseas site.
- Keep the voice-request base overridable through `MINIMAX_API_BASE`, but set the China API base explicitly in examples so the selected region is unambiguous.
- A generation call may consume account quota or incur cost. Obtain the user’s explicit confirmation immediately before calls that generate paid voice or music, unless the current user request explicitly directs generation.
- First produce a dry-run: list dialogue lines, speakers, target files, model, estimated character count, and the music prompts/tracks. Resolve missing speaker-to-voice mappings before generating.

## Shared Shell key for multiple projects

When the same MiniMax account is used across several games, prefer a global `zsh` environment variable. Never ask the user to paste the key into chat or print it in a command result.

On macOS, for a MiniMax China account, ask the user to add these lines manually to `~/.zshrc`:

```zsh
export MINIMAX_API_KEY='their-key'
export MINIMAX_API_BASE='https://api.minimaxi.com'
```

In `nano`, save with `Control + O`, press `Enter` to accept the filename, then exit with `Control + X`. The user must then run:

```zsh
source ~/.zshrc
```

For a safe non-disclosing check, run an interactive `zsh` and report only whether the value exists and its length:

```zsh
zsh -ic 'if [[ -n "$MINIMAX_API_KEY" ]]; then print "MINIMAX_API_KEY 已加载（长度 ${#MINIMAX_API_KEY}）"; else print "MINIMAX_API_KEY 未加载"; fi'
```

Do not assume a terminal that was open before the edit has the new value; source the file or open a new terminal. A project-local `.env` remains useful for a project that intentionally uses another account; the current shell variable takes precedence when both exist. Because an API key alone does not reliably reveal its service region, preserve an explicitly configured `MINIMAX_API_BASE` instead of silently switching endpoints.

To verify credentials and the selected API base without generating paid assets, request the provider’s voice list (for example, `POST /v1/get_voice` with `{"voice_type":"all"}`). This is a read-only account/API check; state that no voice or music is being generated before making the request, and summarize the successful result instead of dumping an unnecessarily long voice list.

## China music creation website (default)

For game BGM, use the logged-in China web studio at `https://www.minimax.cn/audio/music`, not the legacy music API. This is the confirmed workflow for the existing Lost Land tracks: the account's Works list shows the generated titles and their full style prompts.

1. Choose **音乐创作** and a current model (the studio currently offers Music-3.0).
2. Select **纯音乐**; do not enter lyrics for dialogue-safe game BGM.
3. Enter a concise title and a style prompt that specifies instrumental only, narrative mood, key instruments, low dialogue-safe intensity, no vocals, and gentle beginning/end for looping.
4. Generate one candidate first. State the displayed credit cost and obtain confirmation immediately before clicking **创作**, because that click spends the user's sound credits.
5. Review duration and style in the Works list. Only download a chosen result after the user approves it, then copy it into the game's public `music/` directory and update the manifest.

Do not treat the China `POST /v1/music_generation` endpoint as the default. In this project it returned HTTP 410 with `base_resp.status_code: 2153`, indicating that the Music API was no longer available to new users while existing paying customers could continue. If that response occurs, stop rather than retrying and route the task to the China web studio. Use the API only when the user has confirmed their account retains that entitlement and has explicitly requested API automation.

## Voice workflow

1. Extract the source-of-truth dialogue into entries containing `sequence`, `line index`, `speaker`, and `text`. Do not manually maintain a second dialogue list if the game script can be parsed safely.
2. Store voice choices in a human-editable JSON configuration. Map every speaking role to a stable filename slug and include `voice_id`, `speed`, `vol`, and `pitch`.
3. Generate one MP3 per dialogue line into a public game directory such as `dist/audio/<sequence>/`. Use deterministic names such as `00_character-slug.mp3`.
4. Make the process resumable: keep valid existing files unless `--force` is explicitly selected, write each response through a temporary file then rename it atomically, and update the manifest after every completed line.
5. Write both a machine-readable manifest and the small browser manifest consumed by the game. The runtime should start a line’s audio when it displays that line, stop it when advancing, and respect the game-wide sound toggle.
6. Generate a small sample first (for example a few lines or one sequence), listen to it, then generate the rest only after the user accepts the voice direction.

## Music workflow

- Generate separate tracks for distinct narrative moods rather than one generic loop. Prompts should state: instrumental only, no vocals or spoken words, low dialogue-safe intensity, and no abrupt intro or ending.
- Keep each web-studio title and final style prompt in the project’s music source list so a chosen track can be found again in MiniMax Works. Use stable game keys such as `lab`, `tomb`, and `divine`; write approved MP3 files under a public `music/` directory and expose only file paths and display titles in the browser manifest.
- Default to preserving existing tracks. Regenerate a track only when `--force` or an equivalent explicit option is selected.
- Runtime BGM should loop, use a conservative default volume, and provide a BGM-only volume control separate from dialogue volume.

## Verification and delivery

- Verify every manifest path exists and every generated file is nonempty before binding it to the game.
- Test at least one dialogue transition: correct speaker voice begins, advancing stops it, and toggling sound behaves correctly. Test BGM changes across at least two scene states.
- Keep source credentials and local `.env` outside the distributable package. Package only public game files and generated audio assets.
- If the target is an HTML AVG game, use the project-specific layout and command examples in [the web AVG reference](references/web-avg-pipeline.md).
