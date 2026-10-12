# Profiles

Several Claude accounts on one machine (personal, work, another subscription), all sharing your `CLAUDE.md`, settings, skills, agents, plugins and mods. Each profile keeps its own login and history.

![Creating a profile, switching with the picker and by name, and deleting a profile](demo.gif)

## Install

```
/plugin install profiles --marketplace gvart/claude-config
/profile-setup
```

`/profile-setup` adds `source "$HOME/.claude-profiles/profiles.zsh"` to `~/.zshrc`; switching needs it, since a plugin can't restart Claude. Open a new terminal tab afterwards.

## Commands

| Command | |
| --- | --- |
| `/profile` | Pick a profile to switch to; Claude restarts under it |
| `/profile <name>` | Switch by name |
| `/profile-new <name> [ENV=value ...]` | Create a profile; it asks you to log in on first launch |
| `/profile-edit <name> [ENV=value \| ENV=] [--color=<color>]` | Show or change its own env (secrets masked) and label color |
| `/profile-delete <name>` | Delete it after a confirmation |

## How it works

- `~/.claude` is the `default` profile. Others live in `~/.claude-profiles/<name>/`, which links to everything shared in `~/.claude` and keeps its own login and history.
- A profile's own settings, such as env or `model`, go in its `profile-settings.json`, loaded on top of the shared ones.
- On a switch the shell helper restarts Claude with `CLAUDE_CONFIG_DIR` set to the profile's folder: the [documented way](https://code.claude.com/docs/en/authentication.md) to stay signed in to several accounts.

## Limitations

- Switching only works for Claude started from zsh through the helper, not from the desktop app or an IDE extension. Every launch starts on `default`.
- Conversations don't carry across profiles.
- Deleting a profile may leave its saved login in the macOS Keychain. Run `/logout` in that profile first to remove it.
- A Console sign-in without an API key is stored outside the config folder, so profiles don't keep those apart.
- Env values in `profile-settings.json` are plain text.

## Uninstall

Remove the `source` line from `~/.zshrc`, delete `~/.claude-profiles/`, then `/plugin uninstall profiles@gvart`. `~/.claude` is left as it was.
