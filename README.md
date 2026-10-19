# claude-mods

Private Claude Code mods (marketplace `andre-mods`).

- **AutoModell** – picks the best model and effort level for every prompt, includes PromptEngineer
- **usage-dashboard** – pane with token/model/cache/session/cost stats from local Claude logs

## Install on a new machine

Needs `gh auth login` (or git credentials) with access to this private repo.

```
claude plugin marketplace add SpookyNinja/claude-mods
claude plugin install AutoModell@andre-mods --scope user
claude plugin install usage-dashboard@andre-mods --scope user
```

Installed at user scope, the mods load in every session. Do not use `~/.claude/dev-mods/` for permanent mods: that folder is hot-reloaded for a single session only. Develop in the clone instead.

## Update across machines

On the machine where you changed something: bump `version` in the mod's `.claude-plugin/plugin.json`, then commit and push.

On every other machine:

```
claude plugin marketplace update andre-mods
claude plugin update AutoModell@andre-mods
claude plugin update usage-dashboard@andre-mods
```

Then `/reload-plugins` in a running session.

## Edit on any machine (auto-sync)

Clone once and register the clone itself as the marketplace, so edits apply live and are pushed from the same folder:

```
git clone https://github.com/SpookyNinja/claude-mods ~/Projects/claude-mods
claude plugin marketplace add ~/Projects/claude-mods
```

After a change run `./publish.sh "message"`; on other machines `git pull` and `/reload-plugins`.
`CLAUDE.md` and a note in each mod's `register.tsx` tell Claude to do this automatically.
