import { atom, read } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { AgentRow, AgentRunStatus, ChatLine, UsageLimit, UsageSnapshot } from '../types'
import { ROLE_BLURB, ROLE_LABEL, avatarCells, avatarSvg, roleOf } from './avatar'
import type { AvatarMood } from './avatar'

const PANE = 'agent-monitor'
const TITLE = 'Agents'
const TOOL = 'report_progress'
const TOOL_ID = 'mcp__agent-monitor__report_progress'
const NUDGE_AFTER = 5
const MAX_NUDGES = 3
const TICK_MS = 400
// Each redraw rebuilds the pane, and a click landing mid-redraw can be lost: redraw
// at the tick only while a bar eases, otherwise every SLOW_MS.
const SLOW_MS = 2_000
const EASE_MS = 900
// With auto-clear on, a finished or stopped agent leaves this long after it ends;
// a failed one stays until dismissed, so it is not missed.
const AUTO_CLEAR_MS = 60_000
const AUTO_CLEAR_STORE = 'autoClear'
let isAutoClear = false
const FRESH_REPLY_MS = 30_000
const CHAT_KEEP = 6
const STUCK_MS = 120_000
const FLASH = ['#E8833A', '#E8C872']

const AGENTS = { plugin: 'agent-monitor', key: 'agents' } as const
const NOW = { plugin: 'agent-monitor', key: 'now' } as const
const EXPANDED = { plugin: 'agent-monitor', key: 'expanded' } as const
const USAGE = { plugin: 'agent-monitor', key: 'usage' } as const
const AUTO_CLEAR = { plugin: 'agent-monitor', key: 'autoClear' } as const
const agents = atom(AGENTS, [])
const now = atom(NOW, 0)
const expanded = atom(EXPANDED, [])
const usage = atom(USAGE, { limits: [] } as UsageSnapshot)
const autoClear = atom(AUTO_CLEAR, false)

const BRIEF =
  `Progress reporting: call the ${TOOL_ID} tool with { percent, step } ` +
  'at the start, after each meaningful milestone, and before you finish. ' +
  '`percent` is your honest estimate (0-100) of how much of the whole task is done; ' +
  '`step` is a few words on what you are doing now. ' +
  'When the user sends you a message, answer it by calling the tool with `reply` set to your short answer ' +
  '(the user reads it on your card), then carry on with your task.'
const NUDGE = `You have not reported progress for a while. Call ${TOOL_ID} with your current percent and step.`
const STOP =
  'Stopped by the user from the agent monitor. Do not start any more work. ' +
  'Hand back your report now (your hand-back call is allowed): a short summary of what you completed and what is left.'

// How a subagent delivers its report: never held by a pause nor refused by a stop,
// or the stopped agent could not report at all.
const HANDBACK = new Set(['SubagentHandback'])

const LIVE: AgentRunStatus[] = ['running', 'pausing', 'paused', 'stopping', 'waiting']
const isLive = (s: AgentRunStatus) => LIVE.includes(s)
const isHeld = (s: AgentRunStatus | undefined) => s === 'pausing' || s === 'paused'

/** How long a working agent has shown no sign of life, when that is long enough to call it stuck. */
export const stuckFor = (row: AgentRow, at: number) => {
  if (row.status !== 'running') return undefined
  const quiet = at - (row.lastActivityAt ?? row.startedAt)

  return quiet >= STUCK_MS ? quiet : undefined
}

// Muted Nordic palette: fjord, mustard, lingonberry, pine, slate.
const TONE: Record<AgentRunStatus, string> = {
  running: '#3E5C76',
  pausing: '#D9A441',
  paused: '#D9A441',
  stopping: '#B23A48',
  waiting: '#6B8BA4',
  done: '#4F6F52',
  failed: '#B23A48',
  stopped: '#8A8F98',
}

const LABEL: Record<AgentRunStatus, string> = {
  running: 'Working',
  pausing: 'Pausing… holds before its next step',
  paused: 'Paused, waiting for you',
  stopping: 'Stopping… asking it to wrap up',
  waiting: 'Waiting on its background work',
  done: 'Finished',
  failed: 'Failed',
  stopped: 'Stopped',
}

const EXPLAIN: Record<AgentRunStatus, string> = {
  running: 'Running its task; it reports progress as it goes.',
  pausing: 'Finishing its current step; it will be held at its next tool call.',
  paused: 'Held at a tool call. Nothing runs until you resume or stop it.',
  stopping: 'Its next tool call is refused and it is told to summarise and finish.',
  waiting: 'Its turn ended but it has not reported back: it resumes when its own background command finishes.',
  done: 'Completed its task and handed back its report.',
  failed: 'Ended on an error (an API error or a refusal).',
  stopped: 'Ended early by you; its partial report went back to the parent.',
}

const GLYPH: Partial<Record<AgentRunStatus, string>> = { paused: '⏸', waiting: '⏳', done: '✓', failed: '✕', stopped: '■' }
const ICON = {
  pause: { glyph: 'Pause', color: '#D9A441' },
  resume: { glyph: 'Resume', color: '#4F6F52' },
  stop: { glyph: 'Stop', color: '#B23A48' },
  message: { glyph: 'Message', color: '#3E5C76' },
  info: { glyph: 'Info', color: '#3E5C76' },
  hide: { glyph: 'Hide info', color: '#3E5C76' },
  clear: { glyph: 'Clear ended', color: '#8A8F98' },
  dismiss: { glyph: 'Dismiss', color: '#8A8F98' },
  auto: { glyph: 'Auto-clear finished', color: '#4F6F52' },
} as const

const BUSY: Partial<Record<AgentRunStatus, string>> = { running: '●', pausing: '◔', stopping: '◌' }
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// The rows live here, in the module: every `$.state.get` of one dispatch reads
// one moment, so a tool call held for minutes would never see a Resume there.
// `$.state` mirrors the map for the pane to draw from and to survive a reload.
type PaneRender = RenderInput<'Pane'>

const rows = new Map<string, AgentRow>()
const open = new Set<string>()

// Rows saved by an older version of the mod may lack newer fields.
const normalize = (row: AgentRow): AgentRow => ({
  ...row,
  role: row.role in ROLE_LABEL ? row.role : roleOf('', row.name ?? ''),
  status: row.status in TONE ? row.status : 'stopped',
  tokens: row.tokens ?? 0,
})

const commit = ($: EngineInterface) => $.state.set(AGENTS, [...rows.values()])

const patch = ($: EngineInterface, id: string, fn: (row: AgentRow) => AgentRow) => {
  const row = rows.get(id)
  if (row === undefined) return
  rows.set(id, fn(row))

  return commit($)
}

const setStatus = ($: EngineInterface, match: (row: AgentRow) => boolean, from: AgentRunStatus[], to: AgentRunStatus) => {
  const changed: AgentRow[] = []
  for (const row of rows.values()) {
    if (match(row) && from.includes(row.status)) {
      rows.set(row.id, { ...row, status: to })
      changed.push(row)
    }
  }
  if (changed.length === 0) return false

  const who = changed.length === 1 ? changed[0]!.name : `${changed.length} agents`
  const say: Partial<Record<AgentRunStatus, string>> = {
    pausing: `Pausing ${who}: it holds before its next step`,
    running: `Resuming ${who}`,
    stopping: `Stopping ${who}: asking it to wrap up`,
  }
  if (say[to]) $.ui.toast(say[to]!)
  void commit($)

  return true
}

// A control that does not apply right now still answers, saying why.
const act = ($: EngineInterface, match: (row: AgentRow) => boolean, from: AgentRunStatus[], to: AgentRunStatus, why: string) => () => {
  if (!setStatus($, match, from, to)) $.ui.toast(why)
}

const dismiss = ($: EngineInterface, id: string) => {
  rows.delete(id)
  open.delete(id)

  return commit($)
}

const toggleAutoClear = async ($: EngineInterface) => {
  isAutoClear = !isAutoClear
  await $.store.set(AUTO_CLEAR_STORE, isAutoClear).catch(() => undefined)
  await $.state.set(AUTO_CLEAR, isAutoClear)
  $.ui.toast(isAutoClear ? 'Auto-clear on: finished agents leave a minute after they end' : 'Auto-clear off')
}

/** The ended agents auto-clear removes now: finished or stopped a minute ago or more. */
export const dueForClear = (list: AgentRow[], at: number) =>
  list.filter(row => (row.status === 'done' || row.status === 'stopped') && row.endedAt !== undefined && at - row.endedAt >= AUTO_CLEAR_MS)

const toggleInfo = ($: EngineInterface, id: string) => {
  if (open.has(id)) open.delete(id)
  else open.add(id)

  return $.state.set(EXPANDED, [...open])
}

let hasHinted = false

// The overall bar eases between the averages of the agents' latest reports,
// not their animated values, so its drawing changes only when a report lands.
const overall = { value: undefined as number | undefined, prev: undefined as number | undefined, at: 0 }

// The 💬 button prefills `✉ <name>: ` and remembers who; a prompt sent with that
// prefix goes to the agent instead of the main conversation.
const MAIL = '✉ '
let mailTo: string | undefined

const prefixOf = (row: AgentRow) => `${MAIL}${row.name}: `

const startMessage = async ($: EngineInterface, row: AgentRow) => {
  mailTo = row.id
  const prefix = prefixOf(row)
  const filled = await $.prompt.fill({ text: prefix, decorations: [{ start: 0, end: prefix.length - 1, bold: true }] as never })
  $.ui.toast(filled.isFilled ? `Type your message to ${row.name} and press Enter` : `Could not reach the prompt box; type "${prefix}…" yourself`)
}

/** The agent a prompt is addressed to and the message, when it starts with a mail prefix. */
export const addressed = (text: string, list: AgentRow[], preferred?: string) => {
  if (!text.startsWith(MAIL)) return undefined
  const matches = list.filter(row => text.startsWith(prefixOf(row))).sort((a, b) => b.name.length - a.name.length)
  const row = matches.find(one => one.id === preferred) ?? matches[0]

  return row === undefined ? undefined : { row, message: text.slice(prefixOf(row).length).trim() }
}

const find = (id: string | undefined) => (id === undefined ? undefined : rows.get(id))

const say = (row: AgentRow, line: ChatLine): Partial<AgentRow> => ({ chat: [...(row.chat ?? []), line].slice(-CHAT_KEEP) })

/** A reply an agent gave: the `reply` field, or the "· answer: …" a step line ends with. */
export const replyOf = (input: { reply?: unknown; step?: unknown }) => {
  if (typeof input.reply === 'string' && input.reply.trim()) return { reply: input.reply.trim().slice(0, 500), step: input.step }
  if (typeof input.step === 'string') {
    const m = /^(.*?)\s*·\s*answer:\s*(.+)$/is.exec(input.step)
    if (m) return { reply: m[2]!.trim().slice(0, 500), step: m[1]!.trim() || undefined }
  }

  return { reply: undefined, step: input.step }
}

const touch = async ($: EngineInterface, id: string, extra: Partial<AgentRow> = {}) => {
  const at = await $.clock.now()

  return patch($, id, one => ({ ...one, lastActivityAt: at, isStuckNotified: false, ...extra }))
}

// A hook's own time is capped, but time inside a `$` call is free: hold the
// agent by sleeping in a host process until the row leaves `pausing`/`paused`.
const holdWhilePaused = async ($: EngineInterface, id: string, signal: AbortSignal) => {
  if (find(id)?.status === 'pausing') await patch($, id, one => ({ ...one, status: 'paused' }))
  while (!signal.aborted && isHeld(find(id)?.status)) {
    const slept = await $.process.run(['sleep', '1'], { timeoutMs: 5_000 }).then(() => true, () => false)
    if (!slept) {
      $.ui.toast('agent-monitor: could not hold the agent (sleep failed), resuming it')
      await patch($, id, one => (isHeld(one.status) ? { ...one, status: 'running' } : one))
    }
  }
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))

/** The percent to draw now: eased from the previous report to the latest one. */
export const shownPercent = (row: Pick<AgentRow, 'percent' | 'prevPercent' | 'percentAt'>, at: number) => {
  if (row.percent === undefined) return undefined
  const from = row.prevPercent ?? 0
  const t = row.percentAt === undefined ? 1 : Math.max(0, Math.min(1, (at - row.percentAt) / EASE_MS))
  const eased = 1 - (1 - t) ** 3

  return clamp(from + (row.percent - from) * eased)
}

/** A text bar with eighth-block resolution, so it fills smoothly. */
export const bar = (percent: number | undefined, width = 10) => {
  if (percent === undefined) return '░'.repeat(width)
  const eighths = Math.round((clamp(percent) / 100) * width * 8)
  const full = Math.floor(eighths / 8)
  const part = EIGHTHS[eighths % 8]!

  return '█'.repeat(full) + part + '░'.repeat(Math.max(0, width - full - (part ? 1 : 0)))
}

export const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

export const tokens = (n: number) => (n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(2)}M`)

const clock = (ms: number) => {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}

// Desktop draws every Svg as a static image: an animated (interactive) one runs in
// a frame of its own, and a pane redraw reloads every such frame at once, which
// flashes all of them. Motion comes from the mod's own tick instead: a bar's
// source changes only while it eases to a new report, an avatar's only on a blink.
const barSvg = (percent: number | undefined, color: string, W = 220, H = 8) => {
  const track = `<rect x="0" y="0" width="${W}" height="${H}" rx="${H / 2}" fill="#E4DED2"/>`
  if (percent === undefined) {
    const dashes = Array.from({ length: Math.floor(W / 12) }, (_, i) => `<rect x="${i * 12 + 2}" y="${H / 2 - 1}" width="6" height="2" rx="1" fill="${color}" opacity="0.35"/>`).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${track}${dashes}</svg>`
  }
  const w = Math.max(H, Math.round((clamp(percent) / 100) * W))

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${track}<rect x="0" y="0" width="${w}" height="${H}" rx="${H / 2}" fill="${color}"/></svg>`
}

// --- spend and plan limits ---------------------------------------------------
const USAGE_EVERY = 25 // ticks: about every ten seconds
let lastUsage = ''

const refreshUsage = async ($: EngineInterface) => {
  const timeout = $.clock.sleep(3_000).then(() => { throw new Error('session.usage timed out after 3s') })
  const u = await Promise.race([$.session.usage(), timeout]).catch(() => undefined)
  if (u === undefined) return
  const snap: UsageSnapshot = {
    usd: u.cost?.usd,
    limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
  }
  const json = JSON.stringify(snap)
  if (json === lastUsage) return
  lastUsage = json
  await $.state.set(USAGE, snap)
}

const LIMIT_NAME: Record<string, string> = { five_hour: 'Session (5h)', seven_day: 'This week', spend_limit: 'Spend limit' }

/** When a window resets: relative within a day, else weekday and time. */
export const resetText = (iso: string | undefined, at: number) => {
  if (iso === undefined) return undefined
  const when = Date.parse(iso)
  if (Number.isNaN(when)) return undefined
  const ms = when - at
  if (ms <= 0) return 'resetting now'
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    return `resets in ${h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`}`
  }
  const d = new Date(when)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]

  return `resets ${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** One readable line per limit window: name, % left, colour, reset. */
export const limitLines = (limits: UsageLimit[], at: number) =>
  limits.map(l => {
    const left = Math.max(0, Math.round((100 - l.percentUsed) * 10) / 10)
    const tone = left > 50 ? '#4F6F52' : left > 20 ? '#D9A441' : '#B23A48'

    return { kind: l.kind, name: LIMIT_NAME[l.kind] ?? l.kind, left, tone, reset: resetText(l.resetsAt, at) }
  })

export const money = (usd: number) => (usd < 10 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(1)}`)

const meterSvg = (left: number, tone: string, W = 120, H = 6) => {
  const w = Math.max(left > 0 ? H : 0, Math.round((Math.max(0, Math.min(100, left)) / 100) * W))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="${H / 2}" fill="#E4DED2"/><rect width="${w}" height="${H}" rx="${H / 2}" fill="${tone}"/></svg>`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    for (const row of await read($, agents)) rows.set(row.id, normalize(row))
    for (const id of await read($, expanded)) open.add(id)
    isAutoClear = (await $.store.get(AUTO_CLEAR_STORE).catch(() => false)) === true
    await $.state.set(AUTO_CLEAR, isAutoClear)
    void refreshUsage($)
    let ticks = 0
    let lastDraw = 0
    $.clock.every(TICK_MS, async () => {
      if (++ticks % USAGE_EVERY === 0) void refreshUsage($)
      if (isAutoClear && ticks % 5 === 0) {
        const due = dueForClear([...rows.values()], await $.clock.now())
        if (due.length > 0) {
          for (const row of due) {
            rows.delete(row.id)
            open.delete(row.id)
          }
          void commit($)
        }
      }
      const isCounting = isAutoClear && [...rows.values()].some(row => row.status === 'done' || row.status === 'stopped')
      if (!isCounting && ![...rows.values()].some(row => isLive(row.status))) return
      const at = await $.clock.now()
      for (const row of rows.values()) {
        const quiet = stuckFor(row, at)
        if (quiet !== undefined && !row.isStuckNotified) {
          rows.set(row.id, { ...row, isStuckNotified: true })
          $.ui.toast(`${row.name} may be stuck: no activity for ${elapsed(quiet)}${row.activeTool ? ` (in ${row.activeTool})` : ''}`)
          void commit($)
        }
      }
      if (Math.floor(at / TICK_MS) % 6 === 0 && [...rows.values()].some(row => row.status === 'waiting')) {
        const listed = await $.agent.list().catch(() => [])
        for (const row of rows.values()) {
          if (row.status !== 'waiting') continue
          const engine = listed.find(one => one.id === row.id)?.status
          if (engine === undefined || engine === 'completed') rows.set(row.id, { ...row, status: 'done', endedAt: at, prevPercent: shownPercent(row, at) ?? 0, percentAt: at, percent: 100 })
          else if (engine === 'failed') rows.set(row.id, { ...row, status: 'failed', endedAt: at })
          else if (engine === 'killed') rows.set(row.id, { ...row, status: 'stopped', endedAt: at })
          else if (engine === 'running') rows.set(row.id, { ...row, status: 'running', lastActivityAt: at })
        }
        void commit($)
      }
      const isEasing = [...rows.values()].some(row => row.percentAt !== undefined && at - row.percentAt < EASE_MS)
      if (isEasing || at - lastDraw >= SLOW_MS) {
        lastDraw = at
        await $.state.set(NOW, at)
      }
    })

    try {
      await $.tool.register({
      name: TOOL,
      description:
        'Report your progress on the task you were given to the person watching the agent monitor. ' +
        'Subagents call this; the main conversation does not need to.',
      inputSchema: {
        type: 'object',
        properties: {
          percent: { type: 'number', minimum: 0, maximum: 100, description: 'Estimated % of the whole task done' },
          step: { type: 'string', description: 'A few words on the current step' },
          reply: { type: 'string', description: "Your short answer to the user's latest message, when they sent you one" },
        },
        required: ['percent'],
      },
      isDeferred: false,
    })
    } catch (err) {
      $.ui.log(`agent-monitor: could not register its progress tool: ${String(err)}`, { to: 'debug' })
    }
    try {
      await $.command.register({ name: 'agent-monitor', description: 'Open the agent monitor pane' })
    } catch (err) {
      $.ui.log(`agent-monitor: could not register /agent-monitor: ${String(err)}`, { to: 'debug' })
    }
    return started
  })

  on('command.run', { command: 'agent-monitor' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Agent monitor opened.' }
  })

  on('session.send', async ($, e, next) => {
    const sent = await next(e)
    if (!sent.isDelivered || e.agentId !== undefined) return sent
    const row = rows.get(e.to) ?? [...rows.values()].find(one => one.name === e.to)
    if (row !== undefined) {
      const at = await $.clock.now()
      await patch($, row.id, one => ({ ...one, ...say(one, { from: 'you', text: e.text.slice(0, 500), at }), isAwaitingReply: true }))
    }

    return sent
  })

  on('prompt.submit', async ($, e, next) => {
    const to = addressed(e.text, [...rows.values()], mailTo)
    if (to === undefined) return next(e)
    if (to.message === '') return { drop: `Type a message after "${prefixOf(to.row)}"` }

    const sent = await $.session.send({ to: { agentId: to.row.id }, text: to.message }).catch((err: unknown) => ({
      isDelivered: false as const,
      reason: String(err),
    }))
    if (!sent.isDelivered) {
      // A permission check (auto mode's classifier among them) judges a send by
      // what the person asked the main session; this prompt never reached it.
      // Hand it over as a request the main session carries out itself.
      mailTo = undefined
      return next({
        ...e,
        text:
          `Send this message to the subagent "${to.row.name}" (agent id ${to.row.id}) with SendMessage, ` +
          `exactly as written, and reply with one short line once it is delivered:\n\n${to.message}`,
      })
    }

    mailTo = undefined
    const at = await $.clock.now()
    const wasEnded = !isLive(to.row.status)
    await patch($, to.row.id, one => ({
      ...one,
      ...say(one, { from: 'you', text: to.message, at }),
      isAwaitingReply: true,
      lastActivityAt: at,
      isStuckNotified: false,
      ...(wasEnded ? { status: 'running' as const, endedAt: undefined } : {}),
    }))
    const note = isHeld(to.row.status) ? ' It reads it when you resume it.' : wasEnded ? ' It wakes up to answer.' : ''

    return { drop: `✉ Sent to ${to.row.name}.${note}` }
  })

  on('agent.spawn', async ($, e, next) => {
    const isWorkflow = e.workflow !== undefined
    const spawned = await next(isWorkflow ? e : { ...e, prompt: `${e.prompt}\n\n${BRIEF}` })
    if (spawned.deny !== undefined || spawned.agentId === undefined) return spawned

    const startedAt = await $.clock.now()
    const row: AgentRow = {
      id: spawned.agentId,
      name: e.name ?? (e.description || e.subagentType),
      type: e.subagentType,
      role: roleOf(e.subagentType, `${e.description} ${e.prompt.slice(0, 300)}`),
      runId: e.workflow?.runId,
      status: 'running',
      startedAt,
      lastActivityAt: startedAt,
      tokens: 0,
      toolCalls: 0,
      silentCalls: 0,
      nudges: 0,
      isBriefed: !isWorkflow,
    }
    rows.set(row.id, row)
    await commit($)
    await $.state.set(NOW, startedAt)
    void $.ui.open({ id: PANE, title: TITLE }).then(opened => {
      if (!opened.isPlaced && !hasHinted) {
        hasHinted = true
        $.ui.toast('Agent monitor: type /agent-monitor to open the pane')
      }
    })

    return spawned
  })

  on('tool.call', async ($, e, next) => {
    const row = find(e.agentId)
    if (row === undefined) {
      return String(e.tool) === TOOL_ID ? { result: 'Noted.' } : next(e)
    }
    const id = row.id

    if (String(e.tool) === TOOL_ID) {
      const raw = e as unknown as { percent?: number; step?: string; reply?: string }
      const { reply, step } = replyOf(raw)
      const input = { percent: raw.percent, step }
      const at = await $.clock.now()
      if (reply !== undefined) {
        await patch($, id, one => ({ ...one, ...say(one, { from: 'agent', text: reply, at }), isAwaitingReply: false }))
        $.ui.toast(`${row.name} replied: ${reply.slice(0, 120)}`)
      }
      await patch($, id, one => {
        const percent = typeof input.percent === 'number' ? clamp(input.percent) : one.percent
        const isNew = percent !== one.percent

        return {
          ...one,
          prevPercent: isNew ? (shownPercent(one, at) ?? 0) : one.prevPercent,
          percentAt: isNew ? at : one.percentAt,
          percent,
          step: typeof input.step === 'string' ? input.step.slice(0, 200) : one.step,
          silentCalls: 0,
          lastActivityAt: at,
          isStuckNotified: false,
        }
      })

      return { result: 'Progress recorded.' }
    }

    if (HANDBACK.has(String(e.tool))) return next(e)
    if (row.status === 'waiting') await patch($, id, one => ({ ...one, status: 'running' }))
    await holdWhilePaused($, id, next.signal)
    const current = find(id)
    if (current?.status === 'stopping' || current?.status === 'stopped') return { deny: STOP }

    const tool = String(e.tool).replace(/^mcp__[^_]+__/, '')
    await touch($, id, { lastTool: tool, activeTool: tool, silentCalls: (find(id)?.silentCalls ?? 0) + 1, toolCalls: (find(id)?.toolCalls ?? 0) + 1 })
    const ran = await next(e).finally(() => touch($, id, { activeTool: undefined }))
    if (ran.deny !== undefined) return ran

    const after = find(id)
    if (after === undefined) return ran
    const notes: string[] = []
    if (!after.isBriefed) notes.push(BRIEF)
    const shouldNudge = after.isBriefed && after.silentCalls >= NUDGE_AFTER && after.nudges < MAX_NUDGES
    if (shouldNudge) notes.push(NUDGE)
    if (notes.length === 0) return ran

    await patch($, id, one => ({
      ...one,
      isBriefed: true,
      silentCalls: shouldNudge ? 0 : one.silentCalls,
      nudges: shouldNudge ? one.nudges + 1 : one.nudges,
    }))

    return { ...ran, context: [...(ran.context ?? []), ...notes] }
  })

  on('turn.step', async function* ($, e, next) {
    const stepped = yield* next(e)
    if (e.agentId !== undefined && stepped.usage) {
      const u = stepped.usage
      const used = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      await touch($, e.agentId, { tokens: (find(e.agentId)?.tokens ?? 0) + used })
    }

    return stepped
  })

  on('turn.complete', async ($, e, next) => {
    const row = find(e.agentId)
    if (row !== undefined) {
      const listed = await $.agent.list().then(all => all.find(one => one.id === row.id), () => undefined)
      const status: AgentRunStatus =
        row.status === 'stopping' || e.isAborted
          ? 'stopped'
          : e.reason !== 'answer'
            ? 'failed'
            : listed?.status === 'waiting'
              ? 'waiting'
              : 'done'
      const endedAt = await $.clock.now()
      if (status === 'waiting') {
        await patch($, row.id, one => ({ ...one, status, lastActivityAt: endedAt }))
        $.ui.toast(`${row.name} is waiting on its background work`)

        return next(e)
      }
      await patch($, row.id, one => ({
        ...one,
        status,
        endedAt,
        ...(status === 'done' && one.percent !== 100
          ? { prevPercent: shownPercent(one, endedAt) ?? 0, percentAt: endedAt, percent: 100 }
          : {}),
      }))
      $.ui.toast(`${row.name}: ${status === 'done' ? 'finished' : status} after ${elapsed(endedAt - row.startedAt)}`)
      void refreshUsage($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    try {
      return await drawPane($, e)
    } catch (err) {
      const { Text } = $.ui.resolve(e)

      return <Text color="#B23A48">Agent monitor could not draw: {String(err)}</Text>
    }
  })
}

const drawPane = async ($: EngineInterface, e: PaneRender) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg
  const Raster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : undefined

  const list = (await read($, agents)).map(normalize)
  const spend = await read($, usage)
  const isAuto = await read($, autoClear)
  const infoOpen = new Set(await read($, expanded))
  // `now` (ticked while agents are live) makes the pane redraw; the clock read is the time itself.
  const at = Math.max(await read($, now), await $.clock.now())
  const live = list.filter(row => isLive(row.status))
  const count = (s: AgentRunStatus[]) => list.filter(row => s.includes(row.status)).length
  const flash = FLASH[Math.floor(at / SLOW_MS) % FLASH.length]!
  const stuckCount = list.filter(row => stuckFor(row, at) !== undefined).length

  // One control: a text button behind a bar in its action's colour, dimmed when
  // it does not apply (pressing it then says why). No `hover` style: that applies
  // while the enclosing keyed card is hovered and lit every button of the card.
  const control = (key: string, icon: keyof typeof ICON, applies: boolean, onPress: () => unknown, suffix = '') => (
    <Box key={`ctl-${key}`} alignItems="center">
      <Text color={ICON[icon].color} dimColor={!applies || undefined}>
        ▍
      </Text>
      <Button
        key={key}
        label={ICON[icon].glyph + suffix}
        dimColor={!applies || undefined}
        variant={applies && icon === 'resume' ? 'primary' : undefined}
        onPress={onPress}
      />
    </Box>
  )

  // --- the player bar -------------------------------------------------------
  const reported = live.map(row => row.percent).filter((p): p is number => p !== undefined)
  const target = reported.length === 0 ? undefined : Math.round(reported.reduce((a, b) => a + b, 0) / reported.length)
  if (target !== overall.value) {
    overall.prev = shownPercent({ percent: overall.value, prevPercent: overall.prev, percentAt: overall.at }, at)
    overall.value = target
    overall.at = at
  }
  const overallShown = shownPercent({ percent: overall.value, prevPercent: overall.prev, percentAt: overall.at }, at)
  const any = () => true
  const lines = limitLines(spend.limits, at)
  const isPlan = spend.limits.some(l => l.kind === 'five_hour' || l.kind === 'seven_day')
  const usageBox = (
    <Box key="usage" flexDirection="column" marginTop={1}>
      <Box gap={1}>
        <Text color="#D9A441" bold>
          {spend.usd === undefined ? '💰 —' : `💰 ${money(spend.usd)}`}
        </Text>
        <Text dimColor>{isPlan ? 'this session, at API prices (your plan covers it)' : 'spent this session'}</Text>
      </Box>
      {lines.map(l => (
        <Box key={`limit-${l.kind}`} gap={1} alignItems="center">
          <Text dimColor>{l.name.padEnd(12)}</Text>
          <Box key={`meter-${l.kind}`}>
            {Svg ? <Svg source={meterSvg(l.left, l.tone)} alt={`${l.name}: ${l.left}% left`} width={120} height={6} /> : <Text color={l.tone}>{bar(l.left, 12)}</Text>}
          </Box>
          <Text color={l.tone} bold>
            {l.left}% left
          </Text>
          {l.reset && <Text dimColor>· {l.reset}</Text>}
        </Box>
      ))}
      {lines.length === 0 && isPlan === false && spend.usd !== undefined && <Text dimColor italic>Plan limits show after the next model reply, when your account has them.</Text>}
    </Box>
  )

  const player = (
    <Box key="player" flexDirection="column" borderStyle="round" borderColor="#3E5C76" paddingX={1} marginBottom={1}>
      <Box gap={1} justifyContent="space-between">
        <Text bold color="#3E5C76">
          ᚨ Agents
        </Text>
        <Text dimColor>
          {[
            `${count(['running'])} working`,
            `${count(['pausing', 'paused'])} paused`,
            count(['stopping']) ? `${count(['stopping'])} stopping` : '',
            stuckCount ? `⚠ ${stuckCount} stuck` : '',
            `${list.length - live.length} ended`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Box>
      <Box gap={1} alignItems="center">
        <Box key="overall-bar">
          {Svg ? (
            <Svg
              source={barSvg(overallShown === undefined ? undefined : Math.round(overallShown), '#3E5C76', 260, 6)}
              alt={`overall progress ${overall.value === undefined ? 'unknown' : overall.value + '%'}`}
              width={260}
              height={6}
            />
          ) : (
            <Text color="#3E5C76">{bar(overallShown, 20)}</Text>
          )}
        </Box>
        <Text dimColor>{overall.value === undefined ? (live.length ? 'no reports yet' : 'idle') : `${overall.value}% overall`}</Text>
      </Box>
      {usageBox}
      <Box gap={1} marginTop={1} flexWrap="wrap">
        {/* Transport only while something is live: Pause all while anything works, else Resume all. */}
        {live.length > 0 &&
          (count(['running']) === 0 && count(['pausing', 'paused']) > 0
            ? control('resume-all', 'resume', true, act($, any, ['pausing', 'paused'], 'running', 'Nothing is paused'), ' all')
            : control('pause-all', 'pause', count(['running']) > 0, act($, any, ['running'], 'pausing', 'Nothing is working right now'), ' all'))}
        {live.length > 0 && control('stop-all', 'stop', true, act($, any, ['running', 'pausing', 'paused', 'waiting'], 'stopping', 'No agent is running'), ' all')}
        {list.length > live.length && control(
          'clear',
          'clear',
          true,
          () => {
            const ended = [...rows.values()].filter(row => !isLive(row.status))
            if (ended.length === 0) return $.ui.toast('No ended agents to clear')
            for (const row of ended) rows.delete(row.id)
            $.ui.toast(`Cleared ${ended.length} ended agent${ended.length === 1 ? '' : 's'}`)

            return commit($)
          },
        )}
        {control('auto-clear', 'auto', true, () => toggleAutoClear($), isAuto ? ' ☑' : ' ☐')}
      </Box>
    </Box>
  )

  // --- one agent ------------------------------------------------------------
  const mood = (row: AgentRow): AvatarMood => (!isLive(row.status) ? 'ended' : row.status === 'running' ? 'working' : 'held')

  const avatar = (row: AgentRow) => <Box key={`avatar-${row.id}`}>{avatarOf(row)}</Box>

  const avatarOf = (row: AgentRow) =>
    Svg ? (
      <Svg source={avatarSvg(row.role, row.id, mood(row))} alt={`${ROLE_LABEL[row.role]} avatar`} width={40} height={40} />
    ) : Raster ? (
      <Raster key={`av-${row.id}`} columns={8} rows={4} cells={avatarCells(row.role, row.id)} />
    ) : null

  const statusLine = (row: AgentRow) => {
    const quiet = stuckFor(row, at)
    if (quiet !== undefined) {
      return (
        <Box gap={1} alignItems="center">
          <Text color={flash} bold>
            ⚠ Stuck? no activity for {elapsed(quiet)}
            {row.activeTool ? `, still in ${row.activeTool}` : ', waiting on the model'}
          </Text>
        </Box>
      )
    }
    const tone = TONE[row.status]
    const isBusy = row.status === 'running' || row.status === 'pausing' || row.status === 'stopping'
    const icon = <Text color={tone}>{isBusy ? BUSY[row.status] : (GLYPH[row.status] ?? '•')}</Text>

    return (
      <Box gap={1} alignItems="center">
        {icon}
        <Text color={tone} bold>
          {LABEL[row.status]}
        </Text>
      </Box>
    )
  }

  const progress = (row: AgentRow) => {
    const tone = TONE[row.status]
    const shown = shownPercent(row, at)
    const pct = shown === undefined ? 'no report yet' : `${Math.round(shown)}%`

    return (
      <Box gap={1} alignItems="center">
        <Box key={`bar-${row.id}`}>
          {Svg ? (
            <Svg
              source={barSvg(shown === undefined ? undefined : Math.round(shown), tone)}
              alt={`progress ${pct}`}
              width={220}
              height={8}
            />
          ) : (
            <Text color={tone}>{bar(shown, 16)}</Text>
          )}
        </Box>
        <Text bold={shown !== undefined} dimColor={shown === undefined}>
          {pct}
        </Text>
      </Box>
    )
  }

  const controls = (row: AgentRow) => {
    const only = (one: AgentRow) => one.id === row.id
    const s = row.status
    const ended = `${row.name} has already ${s === 'done' ? 'finished' : s}`
    const isInfo = infoOpen.has(row.id)

    return (
      <Box gap={1} marginTop={1}>
        {/* One play/pause button: Resume while held, Pause otherwise; none once ended. */}
        {!isLive(s) ? null : isHeld(s)
          ? control(`resume-${row.id}`, 'resume', true, act($, only, ['pausing', 'paused'], 'running', `${row.name} is not paused`))
          : control(`pause-${row.id}`, 'pause', s === 'running', act($, only, ['running'], 'pausing', isLive(s) ? `${row.name} is ${LABEL[s].toLowerCase()}` : ended))}
        {isLive(s) && control(
          `stop-${row.id}`,
          'stop',
          s === 'running' || isHeld(s) || s === 'waiting',
          act($, only, ['running', 'pausing', 'paused', 'waiting'], 'stopping', s === 'stopping' ? `${row.name} is already stopping` : ended),
        )}
        {control(`message-${row.id}`, 'message', true, () => startMessage($, row))}
        {!isLive(s) && control(`dismiss-${row.id}`, 'dismiss', true, () => dismiss($, row.id))}
        {control(`info-${row.id}`, isInfo ? 'hide' : 'info', true, () => toggleInfo($, row.id))}
      </Box>
    )
  }

  const info = (row: AgentRow) => {
    const field = (label: string, value: string | undefined) =>
      value === undefined ? null : (
        <Box gap={1}>
          <Text dimColor>{label.padEnd(10)}</Text>
          <Text wrap="truncate-end">{value}</Text>
        </Box>
      )

    return (
      <Box key={`info-${row.id}`} flexDirection="column" borderStyle="single" borderColor="#C9C3B6" paddingX={1} marginTop={1}>
        <Text color={stuckFor(row, at) !== undefined ? '#E8833A' : TONE[row.status]}>
          {stuckFor(row, at) !== undefined
            ? `No tool call, model step or progress report for ${elapsed(stuckFor(row, at)!)}. Stop it, or wait if the step is known to be slow.`
            : EXPLAIN[row.status]}
        </Text>
        {field('Role', `${ROLE_LABEL[row.role]}: ${ROLE_BLURB[row.role]}`)}
        {field('Type', row.type ?? 'unknown')}
        {field('Agent id', row.id)}
        {field('Workflow', row.runId)}
        {field('Started', clock(row.startedAt))}
        {field(row.endedAt ? 'Took' : 'Running', elapsed((row.endedAt ?? at) - row.startedAt))}
        {field('Progress', row.percent === undefined ? 'no report yet' : `${Math.round(row.percent)}%${row.step ? `, ${row.step}` : ''}`)}
        {field('Tokens', tokens(row.tokens))}
        {field('Tool calls', String(row.toolCalls ?? 0))}
        {field('Last tool', row.lastTool)}
        {field('Active', isLive(row.status) ? `${elapsed(at - (row.lastActivityAt ?? row.startedAt))} since last activity${row.activeTool ? `, in ${row.activeTool}` : ''}` : undefined)}
        {field('Nudges', row.nudges ? `${row.nudges} reminder${row.nudges === 1 ? '' : 's'} to report progress` : undefined)}
      </Box>
    )
  }

  const chatBox = (row: AgentRow) => {
    const chat = row.chat ?? []
    if (chat.length === 0) return null
    const last = [...chat].reverse().find(line => line.from === 'agent')
    const isFresh = last !== undefined && at - last.at < FRESH_REPLY_MS
    const ago = (t: number) => (at - t < 5_000 ? 'just now' : `${elapsed(at - t)} ago`)

    return (
      <Box key={`chat-${row.id}`} flexDirection="column" borderStyle={isFresh ? 'bold' : 'round'} borderColor={isFresh ? '#D9A441' : '#6B8BA4'} paddingX={1} marginTop={1}>
        <Box gap={1}>
          <Text bold color="#3E5C76">
            Conversation
          </Text>
          {isFresh && (
            <Text bold color="#D9A441">
              ● New reply
            </Text>
          )}
        </Box>
        {chat.slice(-4).map((line, i) =>
          line.from === 'you' ? (
            <Box key={`chat-${row.id}-${i}`} gap={1}>
              <Text bold color="#6B8BA4">
                You
              </Text>
              <Text wrap="wrap">{line.text}</Text>
              <Text dimColor>· {ago(line.at)}</Text>
            </Box>
          ) : (
            <Box key={`chat-${row.id}-${i}`} gap={1}>
              <Text bold color="#4F6F52">
                ↳ {row.name}
              </Text>
              <Text wrap="wrap" bold={line === last && isFresh}>
                {line.text}
              </Text>
              <Text dimColor>· {ago(line.at)}</Text>
            </Box>
          ),
        )}
        {row.isAwaitingReply && isLive(row.status) && (
          <Text dimColor italic>
            {isHeld(row.status) ? 'It reads your message when you resume it.' : '… waiting for its answer'}
          </Text>
        )}
      </Box>
    )
  }

  const card = (row: AgentRow) => {
    const isEnded = !isLive(row.status)
    const isStuck = stuckFor(row, at) !== undefined
    const detail = row.step ?? (row.lastTool ? `last tool: ${row.lastTool}` : 'getting started')
    const meta = [elapsed((row.endedAt ?? at) - row.startedAt), `${tokens(row.tokens)} tokens`, `${row.toolCalls ?? 0} tool calls`].join(' · ')

    return (
      <Box
        key={`row-${row.id}`}
        flexDirection="column"
        borderStyle={isStuck ? 'bold' : 'round'}
        borderColor={isStuck ? flash : isEnded ? '#C9C3B6' : TONE[row.status]}
        paddingX={1}
        marginBottom={1}
      >
        <Box gap={2}>
          {avatar(row)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text bold dimColor={isEnded} wrap="truncate-end">
              {row.name}
            </Text>
            <Box gap={1}>
              <Text bold color={TONE[row.status]}>
                {ROLE_LABEL[row.role]}
              </Text>
              <Text dimColor wrap="truncate-end">
                {ROLE_BLURB[row.role]} · {row.type ?? 'agent'}
                {row.runId ? ' · workflow' : ''}
              </Text>
            </Box>
            {statusLine(row)}
            {progress(row)}
            <Text dimColor={isEnded} italic wrap="truncate-end">
              {detail}
            </Text>
            <Text dimColor>{meta}</Text>
            {isAuto && (row.status === 'done' || row.status === 'stopped') && row.endedAt !== undefined && (
              <Text dimColor italic>
                clears in {elapsed(Math.max(0, AUTO_CLEAR_MS - (at - row.endedAt)))}
              </Text>
            )}
          </Box>
        </Box>
        {chatBox(row)}
        {controls(row)}
        {infoOpen.has(row.id) && info(row)}
      </Box>
    )
  }

  const solo = list.filter(row => row.runId === undefined)
  const runs = [...new Set(list.flatMap(row => (row.runId === undefined ? [] : [row.runId])))]

  return (
    <Box flexDirection="column">
      {player}
      {list.length === 0 && (
        <Box flexDirection="column">
          <Text dimColor>Nobody out on the fjord yet.</Text>
          <Text dimColor italic>
            Subagents and workflow agents appear here with live progress, pause and stop.
          </Text>
        </Box>
      )}
      {solo.map(card)}
      {runs.map(runId => {
        const members = list.filter(row => row.runId === runId)
        const inRun = (row: AgentRow) => row.runId === runId

        return (
          <Box key={`run-${runId}`} flexDirection="column" borderStyle="single" borderColor="#C9C3B6" paddingX={1} marginBottom={1}>
            <Box gap={1}>
              <Text bold>ᛟ Workflow {runId.slice(0, 14)}</Text>
              <Text dimColor>· {members.length} agents</Text>
            </Box>
            <Box gap={1} marginY={1}>
              {!members.some(r => r.status === 'running') && members.some(r => isHeld(r.status))
                ? control(`resume-run-${runId}`, 'resume', true, act($, inRun, ['pausing', 'paused'], 'running', 'Nothing in this run is paused'), ' run')
                : control(`pause-run-${runId}`, 'pause', members.some(r => r.status === 'running'), act($, inRun, ['running'], 'pausing', 'Nothing in this run is working'), ' run')}
              {control(`stop-run-${runId}`, 'stop', members.some(r => r.status === 'running' || isHeld(r.status)), act($, inRun, ['running', 'pausing', 'paused'], 'stopping', 'Nothing in this run is running'), ' run')}
            </Box>
            {members.map(card)}
          </Box>
        )
      })}
    </Box>
  )
}
