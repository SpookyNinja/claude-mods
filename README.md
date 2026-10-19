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

## Troubleshooting: installing on Windows with the Claude desktop app

The install commands above need a `claude` CLI. The Claude desktop app does **not** put one on your PATH, so in a normal terminal you get:

> claude : The term 'claude' is not recognized as the name of a cmdlet, function, script file, or executable program.

The app does ship its own CLI, but it sits in the app's virtualized (Store/MSIX) AppData folder. A regular terminal can't see that folder (`Test-Path` returns `False`, and `%APPDATA%\Claude` doesn't exist there). The same path works from inside the app.

### Fix

Run the install from the desktop app's Code tab, where the bundled CLI is reachable. Ask Claude to run the three install commands above.

Or call the bundled binary directly. Find it first with:

```powershell
Get-ChildItem "$env:APPDATA\Claude\claude-code" -Recurse -Filter claude.exe
```

The version folder changes with each app update. Then run it with the call operator `&`:

```powershell
& "<path-to>\claude.exe" plugin marketplace add SpookyNinja/claude-mods
```

Plugins installed this way go into the desktop app's plugin store. A separately installed CLI keeps its own plugin set and will not see them.

### PowerShell pitfalls

- A quoted path must be prefixed with `&`. Without it you get `Unexpected token 'plugin' in expression or statement`.
- Use PowerShell syntax, not bash (`&&` doesn't work in Windows PowerShell 5.1).

### Verify

```
claude plugin list
```

Both mods should show as `enabled` at user scope (AutoModell 0.5.0, usage-dashboard 0.1.0). Then run `/reload-plugins` in a session.

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
