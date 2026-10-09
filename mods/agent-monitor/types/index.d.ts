export type AgentRunStatus = 'running' | 'pausing' | 'paused' | 'stopping' | 'waiting' | 'done' | 'failed' | 'stopped'

export type AgentRole = 'viking' | 'explorer' | 'seer' | 'smith' | 'shieldmaiden' | 'skald' | 'runecarver'

export type ChatLine = { from: 'you' | 'agent'; text: string; at: number }

export type AgentRow = {
  id: string
  name: string
  type?: string
  role: AgentRole
  runId?: string
  status: AgentRunStatus
  percent?: number
  prevPercent?: number
  percentAt?: number
  step?: string
  lastTool?: string
  startedAt: number
  endedAt?: number
  tokens: number
  toolCalls?: number
  lastActivityAt?: number
  activeTool?: string
  isStuckNotified?: boolean
  chat?: ChatLine[]
  isAwaitingReply?: boolean
  silentCalls: number
  nudges: number
  isBriefed: boolean
}

export type UsageLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type UsageSnapshot = { usd?: number; limits: UsageLimit[] }

declare module 'claude-code' {
  interface PluginState {
    'agent-monitor': { agents: AgentRow[]; now: number; expanded: string[]; usage: UsageSnapshot; autoClear: boolean }
  }
}
