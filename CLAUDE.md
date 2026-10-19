# claude-mods – rules for Claude

This repo is the single source of truth for Andre's Claude Code mods (marketplace `andre-mods`), shared across machines.

- Whenever you create or modify a mod, make the change inside this repo (`mods/<name>/`), not in `~/.claude/dev-mods` or the plugin cache. If a mod was edited elsewhere, copy it back here.
- After the change: bump `version` in `mods/<name>/.claude-plugin/plugin.json`, add new mods to `.claude-plugin/marketplace.json`, then run `./publish.sh "<message>"`. This pulls, commits and pushes, so other machines get the change.
- Never commit secrets or `.claude-plugin/types/`.
