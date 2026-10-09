#!/usr/bin/env bash
# Sets up this Claude Code configuration on a new machine.
# Needs the `claude` CLI on PATH. Safe to run again.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"

echo "→ Adding the gvart marketplace"
claude plugin marketplace add gvart/claude-config || true

echo "→ Installing plugins"
claude plugin install agent-monitor@gvart
claude plugin install gvart-skills@gvart

echo "→ Installing Matt Pocock's skills from upstream"
claude plugin install mattpocock-skills@claude-plugins-official

echo "→ Linking CLAUDE.md"
mkdir -p "$HOME/.claude"
TARGET="$HOME/.claude/CLAUDE.md"
if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  BACKUP="$TARGET.backup-$(date +%Y%m%d%H%M%S)"
  mv "$TARGET" "$BACKUP"
  echo "  existing CLAUDE.md moved to $BACKUP"
fi
ln -sfn "$REPO/claude/CLAUDE.md" "$TARGET"

echo "✓ Done. Restart Claude Code, then type /agent-monitor to open the agent pane."
