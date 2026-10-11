# claude-config

My Claude Code setup, so a new machine is one command away.

## What's inside

| Path | What it is |
| --- | --- |
| `mods/agent-monitor` | **Agent monitor**, a sidebar pane for subagents and workflow agents (details below) |
| `plugins/core` | **gvart-skills**: my skills `design-ship`, `orchestrate` and `smart-build`, and the agents `ui-ux-designer` and `frontend-component-builder` |
| `claude/CLAUDE.md` | My global instructions: semantic commits, no AI co-author, think before coding, keep changes small |
| `install.sh` | Installs all of the above, plus [Matt Pocock's skills](https://github.com/mattpocock/skills) from upstream |

### Agent monitor

A pane in the Code tab of the Claude desktop app and in the terminal. Open it with `/agent-monitor`.

- **One card per agent**: a pixel avatar for its role (Explorer, Seer, Smith, Shield-maiden, Skald, Rune-carver, Viking), its type, status, a progress bar, the current step, elapsed time, tokens and tool calls
- **Controls on each card**: Pause/Resume, Stop, Message (your next prompt goes to that agent) and Info (full details)
- **Top bar**: Pause all, Stop all, overall progress, session spend, and the time left in your plan's 5-hour and weekly windows, with their reset times
- **Stuck detection**: a card's border flashes when its agent has shown no activity for 2 minutes
- **Conversation box**: shows the messages you sent an agent and its replies, with new replies highlighted
- **Cleanup**: Dismiss on each card, Clear ended, or Auto-clear, which removes finished agents after a minute

Agents report their progress themselves through a `report_progress` tool the mod adds. Pause takes effect at the agent's next tool call. Stop refuses further tool calls and asks the agent to hand back its report.

## Install

```bash
git clone https://github.com/gvart/claude-config.git ~/claude-config
~/claude-config/install.sh
```

The script adds this repo as a plugin marketplace and installs `agent-monitor`, `gvart-skills` and `mattpocock-skills`. It then links `~/.claude/CLAUDE.md` to the copy in the repo, first backing up any existing file.

To install only the agent monitor, run this in a Claude Code terminal session:

```
/plugin install agent-monitor --marketplace gvart/claude-config
```

## Developing the mod

```bash
claude plugin validate mods/agent-monitor
claude plugin test mods/agent-monitor
claude --plugin-dir mods/agent-monitor   # run it from this folder
```

## License

MIT. Matt Pocock's skills aren't included in this repo; the install script fetches them from his repository, which has its own MIT license.
