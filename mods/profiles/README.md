# Profiles

Use several Claude accounts on one machine, such as personal, work and another subscription, with one shared setup. Every profile sees the same `CLAUDE.md`, settings, skills, agents, plugins and mods. Each one keeps its own login, conversation history and, optionally, its own environment variables (a proxy URL, say).

```
❯ /profile
  Switch profile? (now: default)
  ❯ 1. work
    2. personal-max
```

The current profile is shown under the input line, just above the status line, in its own color: blue for `default`, and a color picked from the name for the others.

## Install

In a Claude Code terminal session:

```
/plugin install profiles --marketplace gvart/claude-config
```

Restart Claude. Creating, editing, deleting and listing profiles work right away. Switching needs the one-time setup below; until then the label under the prompt says *switching off*.

### Enable switching (one time)

Switching profiles means restarting Claude with a different config folder, which a plugin can't do by itself. A small shell helper does it:

```
/profile-setup
```

This copies the helper to `~/.claude-profiles/profiles.zsh` and adds one line to `~/.zshrc`:

```zsh
source "$HOME/.claude-profiles/profiles.zsh"
```

Then quit Claude, open a new terminal tab and start `claude` as usual. Terminals that were already open keep the old `claude` until you open a new one or run `source ~/.zshrc`. To check that the helper is active, run `type claude`. It should say `claude is a shell function from …/profiles.zsh`.

If you'd rather edit `~/.zshrc` yourself, add that line by hand instead. The helper file is created by `/profile-setup`, and the plugin keeps it up to date after that.

## Quick start

```
/profile-new work                  # a profile with its own login
/profile                           # pick "work": Claude restarts as "work" and asks you to log in
/profile default                   # or switch by name
```

After a switch the terminal is cleared and a toast confirms the profile you're on.

A profile that goes through a proxy or gateway instead of a login:

```
/profile-new work ANTHROPIC_BASE_URL=http://localhost:36253 ANTHROPIC_AUTH_TOKEN=token DISABLE_TELEMETRY=1
```

## Commands

| Command | What it does |
| --- | --- |
| `/profile` | Opens a picker with the other profiles. With more than four, pick *List all* or type a name under *Other*. Dismiss it to get the full list with each profile's env keys. |
| `/profile <name>` | Closes Claude, clears the terminal and reopens Claude under `<name>`. Needs the shell helper. |
| `/profile-new <name> [ENV=value ...]` | Creates a profile. Names use letters, digits, `-` and `_`. |
| `/profile-edit <name>` | Shows the profile's own env, with tokens and keys masked (`sk-…890`), and where its settings file is |
| `/profile-edit <name> A=1 B=` | Sets `A`, removes `B`. Other keys in the file, such as `model`, are kept. |
| `/profile-edit <name> --color=green` | Sets the label color; `--color=` goes back to automatic. Works for `default` too. |
| `/profile-delete <name>` | Asks Delete or Cancel, then deletes. `--yes` skips the question (for scripts and `claude -p`). |
| `/profile-setup` | Installs the shell helper (see above) |

The hint after each command lists your actual profile names, e.g. `/profile [default|work]`. Changes made with `/profile-edit` take effect the next time that profile starts.

## How it works

```
~/.claude/                     the "default" profile, and the source of everything shared
~/.claude-profiles/
├── profiles.zsh               the shell helper, kept up to date by the plugin
├── colors.json                label colors set with --color (optional)
└── work/                      one folder per profile, used as CLAUDE_CONFIG_DIR
    ├── CLAUDE.md      -> ~/.claude/CLAUDE.md
    ├── settings.json  -> ~/.claude/settings.json
    ├── skills/        -> ~/.claude/skills/
    ├── agents/  commands/  plugins/  dev-mods/  keybindings.json   (links, where they exist)
    ├── profile-settings.json  this profile's own settings, loaded on top of the shared ones
    └── .claude.json, history, sessions, …   this profile's own, created by Claude
```

- **Shared:** everything linked. Edit a skill or a setting in any profile and every profile sees it. Items you add to `~/.claude` later, such as a new `commands/` folder, are linked into each profile the next time it starts.
- **Separate:** the login, conversation history, sessions and per-project state. Claude Code keeps the login per config folder, so profiles never see each other's account.
- **Own settings:** `profile-settings.json` is passed with `--settings`, so its values override the shared `settings.json`. Besides `env` you can add any setting, for example `"model": "claude-opus-5-5"`. Values are stored as plain text, like any Claude settings file, so treat tokens in it accordingly.

When you run `/profile work`, the mod writes `work` to a small handoff file and exits Claude. The `claude` shell function sees the file, clears the screen and starts Claude again with `CLAUDE_CONFIG_DIR=~/.claude-profiles/work`. Quitting Claude normally ends the loop. If the exit fails for some reason, the mod empties the handoff file and tells you, so a later normal quit doesn't switch by surprise.

## Limitations

- Every launch starts on `default`; switch from there.
- Switching only works for Claude started from a zsh terminal through the helper. The desktop app, IDE extensions and scripts that call the binary directly can't switch profiles, though `/profile`, `/profile-new`, `/profile-edit` and `/profile-delete` still work.
- Conversations don't carry across profiles. Each has its own history, so a switch starts a new conversation.
- Settings are shared in full. Anything in `~/.claude/settings.json` (hooks, permissions, status line) applies to every profile unless that profile's `profile-settings.json` overrides it.
- `ENV=value` pairs can't contain spaces. Edit `profile-settings.json` directly for those.

## Troubleshooting

**"This claude was not started by the profile helper"**: the session was started before the helper was loaded in that terminal, or not from zsh at all. Quit, open a new terminal tab and run `claude` again. `type claude` should name the helper.

**A new profile asks me to log in**: expected on its first launch. Each profile has its own login.

**The label says "switching off"**: same cause as above; Claude wasn't started through the helper.

**`/profile` prints a list instead of a picker**: the picker was dismissed, or Claude runs non-interactively (`claude -p`). Use `/profile <name>`.

**"profile-settings.json is not valid JSON"**: the file was edited by hand and has a syntax error. Fix it; the mod won't overwrite a file it can't read.

**The label under the prompt is missing**: check that the plugin is enabled with `claude plugin list`, then restart Claude.

## Uninstall

1. Remove the `source "$HOME/.claude-profiles/profiles.zsh"` line from `~/.zshrc`.
2. Delete any profiles you no longer need with `/profile-delete <name> --yes`, or remove `~/.claude-profiles/` entirely. Your `~/.claude` is never changed by this plugin.
3. Run `/plugin uninstall profiles@gvart`.

## Developing

```bash
claude plugin validate mods/profiles
claude plugin test mods/profiles
claude --plugin-dir mods/profiles
```
