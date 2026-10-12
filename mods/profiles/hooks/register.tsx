import type { EngineInterface as $, Register } from 'claude-code'

const DEFAULT = 'default'
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const SECRET = /KEY|TOKEN|SECRET|PASSWORD|AUTH/i
// What every profile links to from ~/.claude; everything else (login, history) stays its own
const SHARED = ['CLAUDE.md', 'settings.json', 'keybindings.json', 'skills', 'agents', 'commands', 'plugins', 'dev-mods']
// Label colors, picked by name unless a profile sets its own with /profile-edit <name> --color=<color>
const PALETTE = ['magenta', 'green', 'yellow', 'cyan', 'red']

const home = async ($: $) => (await $.env.get('HOME')) ?? ''
const profilesDir = async ($: $) => `${await home($)}/.claude-profiles`
const dirOf = async ($: $, name: string) => `${await profilesDir($)}/${name}`
const settingsOf = (dir: string) => `${dir}/profile-settings.json`
const colorsOf = async ($: $) => `${await profilesDir($)}/colors.json`

type ProfileSettings = { env?: Record<string, string> } & Record<string, unknown>

const current = async ($: $) => {
  const named = await $.env.get('CLAUDE_PROFILE')
  if (named) return named
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR'))?.replace(/\/+$/, '')
  if (!dir) return DEFAULT
  const base = await profilesDir($)
  return dir.startsWith(`${base}/`) ? dir.slice(base.length + 1) : dir.replace(await home($), '~')
}

const profiles = async ($: $) => {
  const entries = await $.fs.list(await profilesDir($)).catch(() => [])
  const names = entries
    .filter(one => (one.kind === 'dir' || one.isLink) && !one.name.startsWith('.') && one.name !== DEFAULT)
    .map(one => one.name)
    .sort()
  return [DEFAULT, ...names]
}

// The profile's own settings, or an Error when its file isn't valid JSON
const readSettings = async ($: $, dir: string): Promise<ProfileSettings | Error> => {
  const text = await $.fs.read(settingsOf(dir)).catch(() => '{}')
  try {
    return JSON.parse(text)
  } catch {
    return new Error(`${settingsOf(dir)} is not valid JSON; fix it by hand.`)
  }
}

// `KEY=value` pairs; an empty value (`KEY=`) means remove
const parsePairs = (pairs: string[]) => {
  const env: Record<string, string> = {}
  for (const pair of pairs) {
    const at = pair.indexOf('=')
    const key = pair.slice(0, at)
    if (at < 1 || !ENV_NAME.test(key)) return `Not ENV=value: "${pair}"`
    env[key] = pair.slice(at + 1)
  }
  return env
}

const mask = (key: string, value: string) => {
  if (!SECRET.test(key)) return value
  return value.length > 8 ? `${value.slice(0, 3)}…${value.slice(-3)}` : '•••'
}

const describeEnv = (env: Record<string, string> = {}) => {
  const keys = Object.keys(env)
  return keys.length ? keys.map(key => `${key}=${mask(key, env[key]!)}`).join('\n    ') : '(none)'
}

const readColors = async ($: $): Promise<Record<string, string>> => {
  try {
    return JSON.parse(await $.fs.read(await colorsOf($)))
  } catch {
    return {}
  }
}

const colorFor = async ($: $, name: string) => {
  const own = (await readColors($))[name]
  if (own) return own
  if (name === DEFAULT) return 'blue'
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return PALETTE[hash % PALETTE.length]!
}

// Registers the commands with the current profile names in their hints
const registerCommands = async ($: $) => {
  const all = await profiles($)
  const others = all.filter(name => name !== DEFAULT).join('|') || 'name'
  await $.command.register({ name: 'profile', description: 'Pick a Claude profile to switch to, or name one', argumentHint: `[${all.join('|')}]` })
  await $.command.register({
    name: 'profile-new',
    description: 'Create a profile with its own login that shares this setup',
    argumentHint: '<name> [ENV=value ...]',
  })
  await $.command.register({
    name: 'profile-edit',
    description: "Show a profile's own env, set (KEY=value) or remove (KEY=) entries, or --color=<color>",
    argumentHint: `<${others}> [ENV=value ...]`,
  })
  await $.command.register({
    name: 'profile-delete',
    description: 'Delete a profile with its login and history (the shared setup stays)',
    argumentHint: `<${others}>`,
  })
  await $.command.register({ name: 'profile-setup', description: 'Add the shell helper /profile needs to relaunch claude to ~/.zshrc' })
}

const listText = async ($: $) => {
  const now = await current($)
  const rows = await Promise.all((await profiles($)).map(async name => {
    const mark = name === now ? `● ${name} (current)` : `  ${name}`
    if (name === DEFAULT) return `${mark}  ~/.claude`
    const settings = await readSettings($, await dirOf($, name))
    if (settings instanceof Error) return `${mark}  (profile-settings.json is not valid JSON)`
    const keys = Object.keys(settings.env ?? {})
    return keys.length ? `${mark}  env: ${keys.join(', ')}` : mark
  }))
  return `Profiles:\n${rows.join('\n')}\n\nSwitch: /profile <name> · New: /profile-new · Edit: /profile-edit · Delete: /profile-delete`
}

const switchTo = async ($: $, target: string) => {
  const now = await current($)
  const all = await profiles($)
  if (target === now) return `Already on profile "${now}".`
  if (!all.includes(target)) return `No profile "${target}". Profiles: ${all.join(', ')}`

  const nextFile = await $.env.get('CLAUDE_PROFILE_NEXT')
  if (!nextFile) {
    return 'This Claude session was not started by the profile helper, so it cannot switch. Quit, open a new terminal tab, and run claude again (run /profile-setup first if you never did).'
  }

  await $.fs.write(nextFile, target)
  // A command hook can't run another command itself; exit from a timer once it has answered.
  // If the exit fails, empty the handoff file so a later normal quit doesn't switch by surprise.
  $.clock.after(300, () =>
    $.command.run({ command: 'exit' }).catch(async () => {
      await $.fs.write(nextFile, '')
      $.ui.toast(`Could not switch to "${target}"; quit and run claude again.`)
    }),
  )

  return `Switching to profile "${target}"…`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await registerCommands($)

    // Keep an installed helper in step with this version of the plugin
    const helper = `${await profilesDir($)}/profiles.zsh`
    if (await $.fs.exists(helper)) {
      const shipped = await $.fs.read(`${$.plugin.root}/shell/profiles.zsh`)
      if ((await $.fs.read(helper)) !== shipped) await $.fs.write(helper, shipped)
    }

    // Link shared items added to ~/.claude after this profile was created
    const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
    if (configDir?.startsWith(`${await profilesDir($)}/`)) {
      const base = `${await home($)}/.claude`
      for (const item of SHARED) {
        const has = await $.fs.stat(`${configDir}/${item}`).then(() => true, () => false)
        if (!has && (await $.fs.exists(`${base}/${item}`))) {
          await $.process.run(['ln', '-s', `${base}/${item}`, `${configDir}/${item}`])
        }
      }
    }

    if (await $.env.get('CLAUDE_PROFILE_SWITCHED')) $.ui.toast(`Now on profile "${await current($)}"`)

    return next(e)
  })

  on('command.run', { command: 'profile' }, async ($, e) => {
    const target = e.args.trim()
    if (target !== '') return { text: await switchTo($, target) }

    const now = await current($)
    const others = (await profiles($)).filter(name => name !== now)
    if (others.length === 0) return { text: `${await listText($)}\n\nNo other profiles yet: create one with /profile-new <name>.` }

    // Up to four choices fit the dialog; any other name can be typed under "Other"
    const choices = others.length > 4 ? [...others.slice(0, 3), 'List all'] : others.length === 1 ? [...others, 'Cancel'] : others
    const picked = await $.ui
      .ask(`Switch profile? (now: ${now})`, { options: choices, header: 'Profile' })
      .catch(() => undefined)
    if (picked === undefined || picked === 'List all' || picked === 'Cancel') return { text: await listText($) }

    return { text: await switchTo($, picked.trim()) }
  })

  on('command.run', { command: 'profile-new' }, async ($, e) => {
    const [name, ...pairs] = e.args.trim().split(/\s+/).filter(Boolean)
    if (!name || !NAME.test(name) || name === DEFAULT) {
      return { text: 'Usage: /profile-new <name> [ENV=value ...]  (name: letters, digits, - or _)' }
    }

    const dir = await dirOf($, name)
    if (await $.fs.exists(dir)) return { text: `Profile "${name}" already exists: ${dir}` }

    const env = parsePairs(pairs)
    if (typeof env === 'string') return { text: env }
    await $.fs.write(settingsOf(dir), `${JSON.stringify({ env }, null, 2)}\n`)

    const base = `${await home($)}/.claude`
    const linked: string[] = []
    for (const item of SHARED) {
      if (!(await $.fs.exists(`${base}/${item}`))) continue
      const { exitCode, stderr } = await $.process.run(['ln', '-s', `${base}/${item}`, `${dir}/${item}`])
      if (exitCode !== 0) {
        await $.process.run(['rm', '-rf', dir])
        return { text: `Could not link ${item}: ${stderr.trim()}. Nothing was created.` }
      }
      linked.push(item)
    }
    await registerCommands($)

    return {
      text: [
        `Created profile "${name}" in ${dir}`,
        `Shared from ~/.claude: ${linked.join(', ')}`,
        `Own settings: ${settingsOf(dir)}${pairs.length ? ` (env: ${Object.keys(env).join(', ')})` : ''}`,
        `Run /profile ${name} to switch; its first launch asks you to log in.`,
      ].join('\n'),
    }
  })

  on('command.run', { command: 'profile-edit' }, async ($, e) => {
    const [name, ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const colorArg = rest.find(one => one.startsWith('--color='))
    const pairs = rest.filter(one => one !== colorArg)
    if (!name || (!NAME.test(name) && name !== DEFAULT)) {
      return { text: 'Usage: /profile-edit <name> [ENV=value ...] [--color=<color>]  (ENV= removes it)' }
    }
    if (name !== DEFAULT && !(await $.fs.exists(await dirOf($, name)))) return { text: `No profile "${name}".` }

    const notes: string[] = []
    if (colorArg !== undefined) {
      const colors = await readColors($)
      const color = colorArg.slice('--color='.length)
      if (color === '') delete colors[name]
      else colors[name] = color
      await $.fs.write(await colorsOf($), `${JSON.stringify(colors, null, 2)}\n`)
      notes.push(`Label color: ${color || 'automatic'}`)
    }

    if (name === DEFAULT) {
      if (pairs.length) return { text: 'The default profile has no own env; edit ~/.claude/settings.json (shared by every profile).' }
      return { text: notes.join('\n') || 'The default profile is ~/.claude; only its label color can be set here (--color=<color>).' }
    }

    const dir = await dirOf($, name)
    const settings = await readSettings($, dir)
    if (settings instanceof Error) return { text: settings.message }

    if (pairs.length === 0) {
      return { text: [...notes, `Profile "${name}" env:\n    ${describeEnv(settings.env)}`, `File: ${settingsOf(dir)}`].join('\n') }
    }

    const changes = parsePairs(pairs)
    if (typeof changes === 'string') return { text: changes }
    const env = { ...settings.env }
    for (const [key, value] of Object.entries(changes)) {
      if (value === '') delete env[key]
      else env[key] = value
    }
    await $.fs.write(settingsOf(dir), `${JSON.stringify({ ...settings, env }, null, 2)}\n`)

    const isCurrent = name === (await current($))
    return {
      text: [
        ...notes,
        `Profile "${name}" env:\n    ${describeEnv(env)}`,
        ...(isCurrent ? ['Takes effect the next time this profile starts.'] : []),
      ].join('\n'),
    }
  })

  on('command.run', { command: 'profile-delete' }, async ($, e) => {
    const [name, flag] = e.args.trim().split(/\s+/).filter(Boolean)
    if (name === DEFAULT) return { text: 'The default profile is ~/.claude itself and cannot be deleted.' }
    if (!name || !NAME.test(name)) return { text: 'Usage: /profile-delete <name>' }
    if (name === (await current($))) return { text: `"${name}" is the current profile; switch to another one first.` }

    const dir = await dirOf($, name)
    if (!(await $.fs.exists(dir))) return { text: `No profile "${name}".` }

    const warning = `This deletes ${dir}: the profile's login, conversation history and own settings. The shared setup in ~/.claude is untouched.`
    if (flag !== '--yes') {
      const answer = await $.ui
        .ask(`Delete profile "${name}"? Its login and history are deleted too.`, { options: ['Delete', 'Cancel'], header: 'Delete' })
        .catch(() => undefined)
      if (answer === undefined) return { text: `${warning}\nRun /profile-delete ${name} --yes to confirm.` }
      if (answer !== 'Delete') return { text: `Kept profile "${name}".` }
    }

    // rm -r removes the links into ~/.claude, never what they point to
    const { exitCode, stderr } = await $.process.run(['rm', '-rf', dir])
    if (exitCode !== 0) return { text: `Could not delete ${dir}: ${stderr.trim()}` }
    await registerCommands($)

    return { text: `Deleted profile "${name}".` }
  })

  on('command.run', { command: 'profile-setup' }, async ($) => {
    // Copied out of the plugin, whose folder moves with each update
    const helper = `${await profilesDir($)}/profiles.zsh`
    await $.fs.write(helper, await $.fs.read(`${$.plugin.root}/shell/profiles.zsh`))

    const rc = `${await home($)}/.zshrc`
    const line = 'source "$HOME/.claude-profiles/profiles.zsh"'
    const text = await $.fs.read(rc).catch(() => '')
    if (text.includes(line)) {
      return { text: 'The profile helper is already in ~/.zshrc. If /profile still cannot switch, this Claude session predates it: quit, open a new terminal tab and run claude.' }
    }

    await $.fs.write(rc, `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}\n# Claude Code profiles (/profile)\n${line}\n`)

    return { text: `Added to ~/.zshrc:\n  ${line}\nQuit Claude, open a new terminal tab, then start claude.` }
  })

  // The profile, in its color, on its own row under the hint line, just above the status line
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const line = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const name = await current($)
    const canSwitch = Boolean(await $.env.get('CLAUDE_PROFILE_NEXT'))

    return (
      <Box flexDirection="column">
        {line}
        <Text>
          <Text color={await colorFor($, name)} bold>● {name}</Text>
          {!canSwitch && <Text dimColor> · switching off (start claude from a terminal with the helper)</Text>}
        </Text>
      </Box>
    )
  })
}
