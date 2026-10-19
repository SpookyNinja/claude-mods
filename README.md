# claude-mods

Private Claude Code mods (marketplace `andre-mods`).

- **AutoModell** – picks the best model and effort level for every prompt
- **usage-dashboard** – pane with token/model/cache/session/cost stats from local Claude logs

## Install on a new machine

Needs `gh auth login` (or git credentials) with access to this private repo.

```
claude plugin marketplace add SpookyNinja/claude-mods
claude plugin install AutoModell@andre-mods
claude plugin install usage-dashboard@andre-mods
```

## Update across machines

On the machine where you changed something: bump `version` in the mod's `.claude-plugin/plugin.json`, then commit and push.

On every other machine:

```
claude plugin marketplace update andre-mods
claude plugin update AutoModell@andre-mods
claude plugin update usage-dashboard@andre-mods
```

Then `/reload-plugins` in a running session.
