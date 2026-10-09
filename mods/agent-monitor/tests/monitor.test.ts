import { expect, mock, test } from 'claude-code/testing'
import { dueForClear } from '../hooks/register'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PROGRESS = 'mcp__agent-monitor__report_progress'
const PANE = { plugin: 'agent-monitor', component: 'Pane', requestId: 'agent-monitor' } as const
const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock' } as never

// The engine beneath the plugin: spawns hand out ids, tools answer, sleeps are instant.
const bottom = (on: On, seen: { prompt?: string; ran?: number } = {}) => {
  const clock = mock.clock(on)
  let n = 0
  on('agent.spawn', ($, e) => ((seen.prompt = e.prompt), { model: 'claude-sonnet-5-5', agentId: `a${++n}` }))
  on('tool.call', () => ((seen.ran = (seen.ran ?? 0) + 1), { result: 'ok' }))
  on('process.run', async () => (await clock.sleep(1000), { value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return clock
}

const spawn = ($: Engine, extra: Record<string, unknown> = {}) =>
  $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'Do the thing.',
    description: 'Fix tests',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
    ...extra,
  } as never)

const call = ($: Engine, agentId: string, tool = 'Read', input: Record<string, unknown> = { file_path: '/x' }) =>
  $.tool.call({ tool, tool_use_id: `t${Math.random()}`, agentId, ...input } as never)

const pane = ($: Engine, surface: 'terminal' | 'desktop') => $.ui.mount({ ...PANE, surface, props: PANE_PROPS })

test('a spawned agent shows up with its self-reported progress', async ($, on) => {
  const seen: { prompt?: string } = {}
  const clock = bottom(on, seen)
  const { agentId } = await spawn($)
  expect(seen.prompt).toContain(PROGRESS)

  await call($, agentId!, PROGRESS, { percent: 40, step: 'running tests' })
  await clock.advance(1_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: /Fix tests/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /40%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /running tests/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pause holds the next tool call until resume', async ($, on) => {
  const seen: { ran?: number } = {}
  const clock = bottom(on, seen)
  const { agentId } = await spawn($)
  const ui = await pane($, 'desktop')

  await ui.press({ key: `pause-${agentId}` })
  let isDone = false
  const held = call($, agentId!).then(() => (isDone = true))
  await clock.advance(5_000)
  expect(isDone).toBe(false)
  expect(seen.ran ?? 0).toBe(0)

  await ui.press({ key: `resume-${agentId}` })
  await clock.advance(1_000)
  await held
  expect(seen.ran).toBe(1)
  await ui.unmount()
})

test('stop denies further tool calls and the row ends as stopped', async ($, on) => {
  bottom(on)
  const { agentId } = await spawn($)
  const ui = await pane($, 'terminal')
  await ui.press({ key: `stop-${agentId}` })

  const denied = await call($, agentId!)
  expect(denied.deny).toContain('Stopped by the user')

  await $.turn.complete({ answer: 'partial', durationMs: 10, isAborted: false, turnId: 'x', agentId, reason: 'answer' } as never)
  expect(await ui.find({ type: 'Text', text: /Stopped/ })).toBeDefined()
  expect(await ui.find({ key: `stop-${agentId}` })).toBeUndefined()
  expect(await ui.find({ key: `pause-${agentId}` })).toBeUndefined()
  expect(await ui.find({ key: `message-${agentId}` })).toBeDefined()
  expect(await ui.find({ key: `info-${agentId}` })).toBeDefined()
  expect(await ui.find({ key: 'stop-all' })).toBeUndefined()
  expect(await ui.find({ key: 'clear' })).toBeDefined()
  await ui.unmount()
})

test('five silent tool calls earn a nudge, a report resets the count', async ($, on) => {
  bottom(on)
  const { agentId } = await spawn($)
  const contexts: (readonly string[] | undefined)[] = []
  for (let i = 0; i < 5; i++) contexts.push((await call($, agentId!)).context)
  expect(contexts.slice(0, 4).every(c => c === undefined)).toBe(true)
  expect(contexts[4]?.[0]).toContain('not reported progress')

  await call($, agentId!, PROGRESS, { percent: 10 })
  for (let i = 0; i < 4; i++) expect((await call($, agentId!)).context).toBeUndefined()
})

test('workflow agents are briefed on their first tool call and grouped by run', async ($, on) => {
  bottom(on)
  const { agentId } = await spawn($, { workflow: { runId: 'wf_abc', agentIndex: 1 } })
  const first = await call($, agentId!)
  expect(first.context?.[0]).toContain(PROGRESS)

  const ui = await pane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /Workflow wf_abc/ })).toBeDefined()
  await ui.press({ key: 'pause-run-wf_abc' })
  expect(await ui.find({ key: 'resume-run-wf_abc' })).toBeDefined()
  await ui.unmount()
})

test('main-loop tool calls pass through untouched', async ($, on) => {
  bottom(on)
  const ran = await $.tool.call({ tool: 'Read', tool_use_id: 'm1', file_path: '/x' } as never)
  expect(ran.context).toBeUndefined()
})

test('stopping a paused agent releases the held call as a denial', async ($, on) => {
  const clock = bottom(on)
  const { agentId } = await spawn($)
  const ui = await pane($, 'terminal')
  await ui.press({ key: `pause-${agentId}` })
  const held = call($, agentId!)
  await clock.advance(3_000)

  await ui.press({ key: `stop-${agentId}` })
  await clock.advance(1_000)
  expect((await held).deny).toContain('Stopped by the user')
  await ui.unmount()
})

test('pressing pause shows pausing until the agent is actually held', async ($, on) => {
  const clock = bottom(on)
  const { agentId } = await spawn($)
  const ui = await pane($, 'desktop')
  await ui.press({ key: `pause-${agentId}` })
  expect(await ui.find({ type: 'Text', text: /Pausing…/ })).toBeDefined()
  expect(await ui.find({ key: `resume-${agentId}` })).toBeDefined()

  const held = call($, agentId!)
  await clock.advance(2_000)
  expect(await ui.find({ type: 'Text', text: /Paused, waiting for you/ })).toBeDefined()

  await ui.press({ key: `resume-${agentId}` })
  await clock.advance(1_000)
  await held
  expect(await ui.find({ type: 'Text', text: /Working/ })).toBeDefined()
  await ui.unmount()
})

test('agents get a role avatar on both surfaces', async ($, on) => {
  bottom(on)
  await spawn($, { subagentType: 'Explore', description: 'Find auth code' })
  const desk = await pane($, 'desktop')
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /Explorer/ })).toBeDefined()
  await desk.unmount()
  const term = await pane($, 'terminal')
  expect(await term.find({ type: 'Raster' })).toBeDefined()
  await term.unmount()
})

test('rows saved by an older version still draw', async ($, on) => {
  bottom(on)
  const legacy = { id: 'old1', name: 'Slow demo task', status: 'done', startedAt: 0, endedAt: 1000, tokens: 5, silentCalls: 0, nudges: 0, isBriefed: true }
  on('state.get', ($, e, next) =>
    (e as { key?: string }).key === 'agents' ? ({ value: { value: [legacy], version: 1 } } as never) : next(e),
  )
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: /Slow demo task/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Viking/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a working agent with no activity for two minutes is flagged as stuck', async ($, on) => {
  const clock = bottom(on)
  const { agentId } = await spawn($)
  // A mounted pane redraws on the mod's own tick, which a test does not run: mount afresh to read it.
  const look = async (text: RegExp) => {
    const ui = await pane($, 'desktop')
    const found = await ui.find({ type: 'Text', text })
    await ui.unmount()
    return found
  }
  await clock.advance(60_000)
  expect(await look(/Stuck\?/)).toBeUndefined()

  await clock.advance(61_000)
  expect(await look(/Stuck\? no activity for 2m01s, waiting on the model/)).toBeDefined()
  expect(await look(/1 stuck/)).toBeDefined()

  await call($, agentId!, PROGRESS, { percent: 50 })
  expect(await look(/Stuck\?/)).toBeUndefined()
})

test('every card has the same controls, play/pause toggles, info opens details', async ($, on) => {
  bottom(on)
  const { agentId } = await spawn($, { subagentType: 'Explore', description: 'Find auth code' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, surface)
    for (const k of ['pause', 'stop', 'message', 'info']) expect(await ui.find({ key: `${k}-${agentId}` })).toBeDefined()
    expect(await ui.find({ key: `resume-${agentId}` })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /searches and maps the code · Explore/ })).toBeDefined()

    await ui.press({ key: `pause-${agentId}` })
    expect(await ui.find({ key: `pause-${agentId}` })).toBeUndefined()
    expect((await ui.find({ key: `resume-${agentId}` }))?.props.label).toBe('Resume')
    await ui.press({ key: `resume-${agentId}` })
    expect((await ui.find({ key: `pause-${agentId}` }))?.props.label).toBe('Pause')

    await ui.press({ key: `info-${agentId}` })
    expect(await ui.find({ type: 'Text', text: /Explorer: searches/ })).toBeDefined()
    expect(await ui.find({ key: `info-${agentId}` }).then(b => b?.props.label)).toBe('Hide info')
    await ui.press({ key: `info-${agentId}` })
    await ui.unmount()
  }
})

test('the message button routes the next prompt to that agent', async ($, on) => {
  bottom(on)
  const sent: { to?: unknown; text?: string } = {}
  let filled = ''
  on('prompt.fill', ($, e) => ((filled = e.text), { isFilled: true, box: { text: e.text, cursor: e.text.length } }) as never)
  on('session.send', ($, e) => ((sent.to = e.to), (sent.text = e.text), { isDelivered: true }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  const { agentId } = await spawn($)
  const ui = await pane($, 'desktop')
  await ui.press({ key: `message-${agentId}` })
  expect(filled).toBe('✉ Fix tests: ')

  const r = await $.prompt.submit({ text: `${filled}skip the slow suite`, wait: false } as never)
  expect((r as { drop?: string }).drop).toContain('Sent to Fix tests')
  expect(JSON.stringify(sent.to)).toContain(agentId!)
  expect(sent.text).toBe('skip the slow suite')

  const plain = await $.prompt.submit({ text: 'hello main session', wait: false } as never)
  expect((plain as { text?: string }).text).toBe('hello main session')
  await ui.unmount()
})

test('the player bar controls every agent at once', async ($, on) => {
  bottom(on)
  const a = (await spawn($)).agentId!
  const b = (await spawn($)).agentId!
  const ui = await pane($, 'desktop')
  await ui.press({ key: 'pause-all' })
  expect(await ui.find({ key: `resume-${a}` })).toBeDefined()
  expect(await ui.find({ key: `resume-${b}` })).toBeDefined()
  expect(await ui.find({ key: 'resume-all' })).toBeDefined()
  await ui.press({ key: 'stop-all' })
  expect((await call($, a)).deny).toContain('Stopped by the user')
  await ui.unmount()
})

test('the header shows session spend and plan limits with resets', async ($, on) => {
  const clock = bottom(on)
  const at = clock.now()
  const usage = {
    usd: 1.234,
    limits: [
      { kind: 'five_hour', percentUsed: 30, resetsAt: new Date(at + 2 * 3_600_000 + 13 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 85.5, resetsAt: new Date(at + 3 * 86_400_000).toISOString() },
    ],
  }
  on('state.get', ($, e, next) => ((e as { key?: string }).key === 'usage' ? ({ value: { value: usage, version: 1 } } as never) : next(e)))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: /💰 \$1\.23/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /at API prices/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Session \(5h\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^70% left$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /resets in 2h13m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^14\.5% left$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /resets (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a refused direct send is handed to the main session as a request', async ($, on) => {
  bottom(on)
  let filled = ''
  on('prompt.fill', ($, e) => ((filled = e.text), { isFilled: true, box: { text: e.text, cursor: e.text.length } }) as never)
  on('session.send', () => ({ isDelivered: false, reason: 'classifier gave no verdict' }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  const { agentId } = await spawn($)
  const ui = await pane($, 'desktop')
  await ui.press({ key: `message-${agentId}` })

  const r = (await $.prompt.submit({ text: `${filled}what are you doing?`, wait: false } as never)) as { text?: string; drop?: string }
  expect(r.drop).toBeUndefined()
  expect(r.text).toContain(`with SendMessage`)
  expect(r.text).toContain(agentId!)
  expect(r.text).toContain('what are you doing?')
  await ui.unmount()
})

test('a stopped or paused agent can still hand back its report', async ($, on) => {
  const clock = bottom(on)
  const { agentId } = await spawn($)
  const ui = await pane($, 'desktop')
  await ui.press({ key: `stop-${agentId}` })
  expect((await call($, agentId!)).deny).toContain('Hand back your report now')
  expect((await call($, agentId!, 'SubagentHandback', { message: 'did 7 of 8' })).deny).toBeUndefined()

  const other = (await spawn($)).agentId!
  await ui.press({ key: `pause-${other}` })
  let isDone = false
  const handed = call($, other, 'SubagentHandback', { message: 'done' }).then(() => (isDone = true))
  await clock.advance(2_000)
  expect(isDone).toBe(true)
  await handed
  await ui.unmount()
})

test('a reply shows in a highlighted conversation box', async ($, on) => {
  const clock = bottom(on)
  on('session.send', () => ({ isDelivered: true }) as never)
  const { agentId } = await spawn($)
  await $.session.send({ to: agentId!, text: 'what are you doing?', origin: { kind: 'model' } } as never)

  const look = async (q: Parameters<Awaited<ReturnType<typeof pane>>['find']>[0]) => {
    const ui = await pane($, 'desktop')
    const found = await ui.find(q)
    await ui.unmount()
    return found
  }
  expect(await look({ type: 'Text', text: /what are you doing\?/ })).toBeDefined()
  expect(await look({ type: 'Text', text: /waiting for its answer/ })).toBeDefined()

  await call($, agentId!, PROGRESS, { percent: 50, step: 'Scouting area 4 of 8 · answer: scouting area 4' })
  expect(await look({ type: 'Text', text: /^scouting area 4$/ })).toBeDefined()
  expect(await look({ type: 'Text', text: /New reply/ })).toBeDefined()
  expect(await look({ type: 'Text', text: /^Scouting area 4 of 8$/ })).toBeDefined()
  expect(await look({ type: 'Text', text: /waiting for its answer/ })).toBeUndefined()

  await clock.advance(31_000)
  expect(await look({ type: 'Text', text: /New reply/ })).toBeUndefined()
  expect(await look({ type: 'Text', text: /^scouting area 4$/ })).toBeDefined()
})

test('no drawing on desktop is an animated frame', async ($, on) => {
  bottom(on)
  const { agentId } = await spawn($)
  await call($, agentId!, PROGRESS, { percent: 30 })
  const ui = await pane($, 'desktop')
  const svgs = await ui.find({ type: 'Svg' })
  expect(svgs).toBeDefined()
  expect(svgs?.props.isInteractive).toBeUndefined()
  await ui.unmount()
})

test('a finished card can be dismissed on its own, and auto-clear can be toggled', async ($, on) => {
  bottom(on)
  mock.store(on)
  const { agentId } = await spawn($)
  const keep = (await spawn($)).agentId!
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'x', agentId, reason: 'answer' } as never)
  const ui = await pane($, 'desktop')
  expect(await ui.find({ key: `dismiss-${keep}` })).toBeUndefined()
  await ui.press({ key: `dismiss-${agentId}` })
  expect(await ui.find({ key: `row-${agentId}` })).toBeUndefined()
  expect(await ui.find({ key: `row-${keep}` })).toBeDefined()

  expect((await ui.find({ key: 'auto-clear' }))?.props.label).toBe('Auto-clear finished ☐')
  await ui.press({ key: 'auto-clear' })
  expect((await ui.find({ key: 'auto-clear' }))?.props.label).toBe('Auto-clear finished ☑')
  await ui.unmount()
})

test('auto-clear takes finished and stopped agents after a minute, never failed ones', () => {
  const row = (id: string, status: string, endedAt?: number) =>
    ({ id, name: id, role: 'viking', status, startedAt: 0, endedAt, tokens: 0, silentCalls: 0, nudges: 0, isBriefed: true }) as never
  const list = [row('a', 'done', 0), row('b', 'stopped', 30_000), row('c', 'failed', 0), row('d', 'running'), row('e', 'done', 50_000)]
  expect(dueForClear(list, 90_000).map((r: { id: string }) => r.id)).toEqual(['a', 'b'])
})
