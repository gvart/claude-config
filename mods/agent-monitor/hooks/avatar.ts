import type { AgentRole } from '../types'

// 8x8 Nordic folk sprites, one per role. Letters are palette slots:
// . empty, s skin, e eye, h hair/beard, H hood/cap, m metal, w horn, k accent.
const SPRITES: Record<AgentRole, readonly string[]> = {
  viking: ['w.mmmm.w', 'wmmmmmmw', '.mmkkmm.', '.sekkes.', '.ssssss.', '.hhsshh.', '.hhhhhh.', '..hhhh..'],
  explorer: ['..HHHH..', '.HHHHHH.', 'HHssssHH', 'HHesseHH', 'HHssssHH', 'HhhsshhH', '.hhhhhh.', '..hhhh..'],
  seer: ['...kk...', '..HHHH..', '.HHHHHH.', '.HesseH.', '.HssssH.', '.hHssHh.', '.h.HH.h.', '.h....h.'],
  smith: ['..HHHH..', '.HHHHHH.', '.kkkkkk.', '.sesses.', '.ssssss.', '.hssssh.', '.hhhhhh.', 'hhhhhhhh'],
  shieldmaiden: ['..mmmm..', '.mmmmmm.', 'hssssssh', 'hsessesh', 'hssssssh', 'h.ssss.h', 'h.kkkk.h', 'h......h'],
  skald: ['.....k..', '..HHHHk.', '.HHHHHH.', '.sesses.', '.ssssss.', '.shhhhs.', '..ssss..', '.kkkkkk.'],
  runecarver: ['..HHHH..', '.HHHHHH.', 'HHssssHH', 'HsessesH', 'HssssssH', '.hhhhhh.', '.hhhhhh.', '..hhhh..'],
}

// Muted Scandinavian palette: wool, birch, fjord, pine, lingonberry, mustard.
const ROLE_COLORS: Record<AgentRole, { H: string; k: string }> = {
  viking: { H: '#5B6770', k: '#9AA5B1' },
  explorer: { H: '#7A5C3E', k: '#C9A66B' },
  seer: { H: '#3E5C76', k: '#E8C872' },
  smith: { H: '#4A3B30', k: '#B23A48' },
  shieldmaiden: { H: '#9AA5B1', k: '#4F6F52' },
  skald: { H: '#B23A48', k: '#EDE6D6' },
  runecarver: { H: '#4F6F52', k: '#D9A441' },
}
const HAIR = ['#E8C872', '#B5562E', '#6B4A2E', '#D9D4C7']
const SKIN = ['#F2D1B3', '#E0B48F', '#C68E64']
const FIXED: Record<string, string> = { m: '#9AA5B1', w: '#EDE6D6', e: '#2B2B2B' }

export const ROLE_LABEL: Record<AgentRole, string> = {
  viking: 'Viking',
  explorer: 'Explorer',
  seer: 'Seer',
  smith: 'Smith',
  shieldmaiden: 'Shield-maiden',
  skald: 'Skald',
  runecarver: 'Rune-carver',
}

export const ROLE_BLURB: Record<AgentRole, string> = {
  viking: 'general hand, takes on any task',
  explorer: 'searches and maps the code',
  seer: 'plans and designs the approach',
  smith: 'builds, fixes and refactors',
  shieldmaiden: 'runs and guards the tests',
  skald: 'reviews and audits work',
  runecarver: 'writes docs and summaries',
}

export const roleOf = (type: string, text: string): AgentRole => {
  const t = `${type} ${text}`.toLowerCase()
  if (/\bexplore|search|find|locate|scan|look up|lookup/.test(t)) return 'explorer'
  if (/\bplan|design|architect|strategy/.test(t)) return 'seer'
  if (/\btests?\b|spec|\bqa\b|verify/.test(t)) return 'shieldmaiden'
  if (/review|audit|security|quality|lint/.test(t)) return 'skald'
  if (/\bdocs?\b|readme|write-?up|explain|summar/.test(t)) return 'runecarver'
  if (/build|implement|fix|code|refactor|create|migrat/.test(t)) return 'smith'

  return 'viking'
}

const seed = (id: string) => [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)

const colorAt = (role: AgentRole, id: string, slot: string) => {
  const n = seed(id)
  if (slot === 's') return SKIN[n % SKIN.length]!
  if (slot === 'h') return HAIR[(n >> 3) % HAIR.length]!
  if (slot === 'H' || slot === 'k') return (ROLE_COLORS[role] ?? ROLE_COLORS.viking)[slot]

  return FIXED[slot]
}

export type AvatarMood = 'working' | 'held' | 'ended'

// Desktop: a static SVG (an animated one would flash on every pane redraw).
// An ended avatar is faded.
export const avatarSvg = (role: AgentRole, id: string, mood: AvatarMood) => {
  const sprite = SPRITES[role] ?? SPRITES.viking
  const rects = sprite.flatMap((line, y) =>
    [...line].flatMap((slot, x) => {
      const fill = slot === '.' ? undefined : colorAt(role, id, slot)
      return fill ? [`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`] : []
    }),
  )

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 10 10" width="40" height="40" shape-rendering="crispEdges">` +
    `<rect x="-1" y="-1" width="10" height="10" rx="2" fill="#EDE6D6"/>` +
    `<g opacity="${mood === 'ended' ? 0.45 : 1}">${rects.join('')}</g></svg>`
  )
}

const hex = (c: string | undefined) => (c === undefined ? 0x01000000 : parseInt(c.slice(1), 16))

// Terminal: 8 columns x 4 rows, each cell an upper half block whose foreground
// is the top pixel and background the bottom one.
export const avatarCells = (role: AgentRole, id: string) => {
  const sprite = SPRITES[role] ?? SPRITES.viking
  const pixel = (slot: string) => hex(slot === '.' ? undefined : colorAt(role, id, slot))
  const words: number[] = []
  for (let row = 0; row < 4; row++) {
    for (let x = 0; x < 8; x++) {
      words.push(0x2580, pixel(sprite[row * 2]![x]!), pixel(sprite[row * 2 + 1]![x]!))
    }
  }

  return base64(new Uint8Array(Uint32Array.from(words).buffer))
}


const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const base64 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }

  return out
}
