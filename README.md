# Personal Codex skills and extensions

This repository backs up reusable Codex skills for Chinese murder-mystery
production, especially workflows for 百变大侦探 and 我是谜.

## Browser extensions

- [`woshimi-admin-helper`](extensions/woshimi-admin-helper/): 我是谜后台辅助工具。源码、安装包与逐版本更新记录统一保存在该目录。

## Skill catalog

### Script parsing and platform import

- `baibian-character-story-import`: build validated 百变大侦探 character-story JSON and proof documents.
- `woshimi-story-import`: extract 我是谜 stories, votes, and stage recaps into separate import bundles.
- `import-character-stories`: enter character stories through the platform UI after confirmation.
- `woshimi-script-materials`: prepare rounds, votes, clue workbooks, investigation points, scenes, and portraits.
- `woshimi-clue-workbook`: extract script clues into the standard six-column workbook.
- `format-clue-workbook`: normalize existing clue workbooks and verify investigation-point IDs.

### Visual production

- `murder-mystery-materials`: produce character, scene, button, music-prompt, and promotional materials.
- `murder-mystery-clue-cards`: build editable multi-clue PSD card packages with embedded artwork.
- `private-chat-scene-cards`: create vertical private-chat locations, overview mockups, and transparent cards.
- `murder-mystery-location-assets`: map existing scenes and portraits to ordered location assets.
- `murder-mystery-promo-page`: design mobile promotional pages for mystery games.
- `baibian-map-redraw`: redraw 百变大侦探 maps from scripts and existing location structure.
- `mockup-to-game-ui`: turn visual mockups into layered runtime game UI assets.
- `transparent-zoom-animation`: create uncropped looping GIF and WebP animations from transparent PNGs.
- `gpt-tasteskill`: design motion-rich editorial websites and interfaces.

### Audio and media generation

- `doubao-character-voice`: generate Chinese character voices and dialogue scenes.
- `minimax-game-audio`: create voice and instrumental game audio with MiniMax workflows.
- `suno-music-mxapi`: generate and organize Suno V6 music through MXAPI.
- `zenmux-media-generation`: generate or edit images, transparent assets, and videos through ZenMux.

### Operations

- `baibian-activity-planning`: plan and validate six-week 百变大侦探 promotion schedules.

## Layout

Each skill lives in `skills/<skill-name>/` and has a `SKILL.md` file. Built-in
skills and plugin-cache skills are deliberately excluded.

## Updating the backup

Copy an updated skill directory from `~/.codex/skills/` into `skills/`, then
review and commit the changes:

```sh
git status
git add skills
git commit -m "Update personal Codex skills"
```

Keep credentials and API keys out of this repository.

## Browser extensions

- `extensions/baibian-admin-helper`: 百变大侦探后台辅助工具。源码、使用说明、
  版本记录和当前发布包均保存在该目录；发布流程见目录内的 `RELEASING.md`。
