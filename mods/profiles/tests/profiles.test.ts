import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/me'

// The engine beneath the plugin: an in-memory home folder, its env and `ln -s`.
const bottom = (on: On, env: Record<string, string> = {}) => {
  const files = new Map<string, string>([[`${HOME}/.claude/CLAUDE.md`, '# mine'], [`${HOME}/.claude/settings.json`, '{}']])
  const dirs = new Set([`${HOME}/.claude/skills`])
  const vars: Record<string, string> = { HOME, ...env }
  const has = (path: string) => files.has(path) || dirs.has(path) || [...files.keys(), ...dirs].some(one => one.startsWith(`${path}/`))

  on('env.get', ($, e) => ({ value: vars[e.name] }) as never)
  on('fs.exists', ($, e) => ({ value: has(e.path) }) as never)
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }) as never)
  on('fs.read', ($, e) => (files.has(e.path) ? { value: files.get(e.path) } : { error: 'ENOENT' }) as never)
  on('fs.list', ($, e) => {
    const names = new Set([...files.keys(), ...dirs].filter(one => one.startsWith(`${e.path}/`)).map(one => one.slice(e.path.length + 1).split('/')[0]!))
    return { value: [...names].map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) } as never
  })
  on('process.run', ($, e) => {
    const [, , from, to] = e.argv
    files.set(to!, `-> ${from}`)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })

  return files
}

const run = async ($: Engine, command: string, args = '') => (await $.command.run({ command, args } as never)).text ?? ''

test('/profile lists the default profile as current', async ($, on) => {
  bottom(on)
  expect(await run($, 'profile')).toContain('● default (current)')
})

test('/profile-new links the shared setup and keeps its own env', async ($, on) => {
  const files = bottom(on)
  const text = await run($, 'profile-new', 'work ANTHROPIC_BASE_URL=http://localhost:1 DISABLE_TELEMETRY=1')

  expect(text).toContain('Created profile "work"')
  expect(files.get(`${HOME}/.claude-profiles/work/CLAUDE.md`)).toBe(`-> ${HOME}/.claude/CLAUDE.md`)
  expect(files.get(`${HOME}/.claude-profiles/work/skills`)).toBe(`-> ${HOME}/.claude/skills`)
  expect(JSON.parse(files.get(`${HOME}/.claude-profiles/work/profile-settings.json`)!)).toEqual({
    env: { ANTHROPIC_BASE_URL: 'http://localhost:1', DISABLE_TELEMETRY: '1' },
  })
  expect(await run($, 'profile')).toContain('  work')
})

test('/profile-new refuses a bad name or one that exists', async ($, on) => {
  bottom(on)
  expect(await run($, 'profile-new', 'default')).toContain('Usage')
  expect(await run($, 'profile-new', '../x')).toContain('Usage')
  await run($, 'profile-new', 'work')
  expect(await run($, 'profile-new', 'work')).toContain('already exists')
})

test('/profile <name> asks for the helper when claude was started without it', async ($, on) => {
  const files = bottom(on)
  await run($, 'profile-new', 'work')
  expect(await run($, 'profile', 'work')).toContain('/profile-setup')
  expect([...files.keys()].some(one => one.includes('.next'))).toBe(false)
})

test('/profile <name> records the choice for the helper', async ($, on) => {
  const files = bottom(on, { CLAUDE_PROFILE_NEXT: `${HOME}/.claude-profiles/.next-1` })
  await run($, 'profile-new', 'work')
  expect(await run($, 'profile', 'work')).toContain('Switching to profile "work"')
  expect(files.get(`${HOME}/.claude-profiles/.next-1`)).toBe('work')
})
