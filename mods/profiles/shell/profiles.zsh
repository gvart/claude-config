# Claude Code profiles: runs claude under the profile picked with /profile,
# relaunching it whenever a session asks to switch. Installed by /profile-setup.

claude() {
  local home=$HOME/.claude-profiles profile=default
  local next=$home/.next-$$
  local -a args=("$@")
  while true; do
    rm -f $next
    if [[ $profile == default ]]; then
      CLAUDE_PROFILE=default CLAUDE_PROFILE_NEXT=$next command claude "${args[@]}"
    else
      CLAUDE_PROFILE=$profile CLAUDE_PROFILE_NEXT=$next CLAUDE_CONFIG_DIR=$home/$profile \
        command claude --settings $home/$profile/profile-settings.json "${args[@]}"
    fi
    [[ -f $next ]] || break
    printf '\e[H\e[2J\e[3J'  # clear the screen and scrollback before the next profile starts
    profile=$(<$next)
    args=()
  done
  rm -f $next
}
