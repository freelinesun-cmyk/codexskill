# Personal Codex skills

This repository backs up the personal Codex skills installed on this computer.

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
