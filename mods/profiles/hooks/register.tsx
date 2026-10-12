import type { EngineInterface as $, Register } from 'claude-code'

const DEFAULT = 'default'
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
// What every profile links to from ~/.claude; everything else (login, history) stays its own
const SHARED = ['CLAUDE.md', 'settings.json', 'keybindings.json', 'skills', 'agents', 'commands', 'plugins', 'dev-mods']

const home = async ($: $) => (await $.env.get('HOME')) ?? ''
const profilesDir = async ($: $) => `${await home($)}/.claude-profiles`

const current = async ($: $) => {
  const named = await $.env.get('CLAUDE_PROFILE')
  if (named) return named
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  return dir ? dir.replace(/\/+$/, '').split('/').pop() ?? DEFAULT : DEFAULT
}

const profiles = async ($: $) => {
  const entries = await $.fs.list(await profilesDir($)).catch(() => [])
  const names = entries
    .filter(one => (one.kind === 'dir' || one.isLink) && !one.name.startsWith('.'))
    .map(one => one.name)
    .sort()
  return [DEFAULT, ...names]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'profile',
      description: 'List Claude profiles, or relaunch under one',
      argumentHint: '[name]',
    })
    await $.command.register({
      name: 'profile-new',
      description: 'Create a profile with its own login that shares this setup',
      argumentHint: '<name> [ENV=value ...]',
    })
    await $.command.register({
      name: 'profile-setup',
      description: 'Add the shell helper /profile needs to relaunch claude to ~/.zshrc',
    })

    return next(e)
  })

  on('command.run', { command: 'profile' }, async ($, e) => {
    const target = e.args.trim()
    const now = await current($)
    const all = await profiles($)

    if (target === '') {
      const rows = all.map(name => (name === now ? `● ${name} (current)` : `  ${name}`))
      return { text: `Profiles:\n${rows.join('\n')}\n\nSwitch: /profile <name> · New: /profile-new <name>` }
    }
    if (target === now) return { text: `Already on profile "${now}".` }
    if (!all.includes(target)) return { text: `No profile "${target}". Profiles: ${all.join(', ')}` }

    const nextFile = await $.env.get('CLAUDE_PROFILE_NEXT')
    if (!nextFile) {
      return { text: 'This claude was not started by the profile helper. Run /profile-setup, open a new shell, then start claude again.' }
    }

    await $.fs.write(nextFile, target)
    // A command hook can't run another command itself; exit from a timer once it has answered
    $.clock.after(300, () => $.command.run({ command: 'exit' }))

    return { text: `Switching to profile "${target}"…` }
  })

  on('command.run', { command: 'profile-new' }, async ($, e) => {
    const [name, ...pairs] = e.args.trim().split(/\s+/).filter(Boolean)
    if (!name || !NAME.test(name) || name === DEFAULT) {
      return { text: 'Usage: /profile-new <name> [ENV=value ...]  (name: letters, digits, - or _)' }
    }

    const dir = `${await profilesDir($)}/${name}`
    if (await $.fs.exists(dir)) return { text: `Profile "${name}" already exists: ${dir}` }

    const env: Record<string, string> = {}
    for (const pair of pairs) {
      const at = pair.indexOf('=')
      if (at < 1) return { text: `Not ENV=value: "${pair}"` }
      env[pair.slice(0, at)] = pair.slice(at + 1)
    }
    await $.fs.write(`${dir}/profile-settings.json`, `${JSON.stringify({ env }, null, 2)}\n`)

    const base = `${await home($)}/.claude`
    const linked: string[] = []
    for (const item of SHARED) {
      if (!(await $.fs.exists(`${base}/${item}`))) continue
      const { exitCode, stderr } = await $.process.run(['ln', '-s', `${base}/${item}`, `${dir}/${item}`])
      if (exitCode !== 0) return { text: `Could not link ${item}: ${stderr.trim()}` }
      linked.push(item)
    }

    return {
      text: [
        `Created profile "${name}" in ${dir}`,
        `Shared from ~/.claude: ${linked.join(', ')}`,
        `Own settings: ${dir}/profile-settings.json${pairs.length ? ` (env: ${Object.keys(env).join(', ')})` : ''}`,
        `Run /profile ${name} to switch; its first launch asks you to log in.`,
      ].join('\n'),
    }
  })

  on('command.run', { command: 'profile-setup' }, async ($) => {
    // Copied out of the plugin, whose folder moves with each update
    const helper = `${await profilesDir($)}/profiles.zsh`
    await $.fs.write(helper, await $.fs.read(`${$.plugin.root}/shell/profiles.zsh`))

    const rc = `${await home($)}/.zshrc`
    const line = 'source "$HOME/.claude-profiles/profiles.zsh"'
    const text = await $.fs.read(rc).catch(() => '')
    if (text.includes(line)) return { text: 'The profile helper is already in ~/.zshrc (refreshed it). Open a new shell to use it.' }

    await $.fs.write(rc, `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}\n# Claude Code profiles (/profile)\n${line}\n`)

    return { text: `Added to ~/.zshrc:\n  ${line}\nOpen a new shell (or run: source ~/.zshrc), then start claude.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text dimColor>● profile: {await current($)}</Text>
        {below}
      </Box>
    )
  })
}
