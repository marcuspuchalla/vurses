/**
 * Color parsing and SGR (ANSI escape) generation.
 *
 * Accepted color values:
 *  - named ANSI colors: `red`, `brightRed` / `redBright`, `gray`, `white`, ...
 *  - hex: `#rgb`, `#rrggbb`
 *  - `rgb(r, g, b)`
 *  - `ansi256(n)`
 *  - theme tokens (`primary`, `accent`, `muted`, ...) resolved through the active theme
 */

export type Color =
  | { kind: 'ansi'; code: number }
  | { kind: 'rgb'; r: number; g: number; b: number }
  | { kind: '256'; n: number }

export type ColorDepth = 16 | 256 | 'truecolor'

const ANSI_NAMES: Record<string, number> = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  gray: 8,
  grey: 8,
  brightblack: 8,
  brightred: 9,
  brightgreen: 10,
  brightyellow: 11,
  brightblue: 12,
  brightmagenta: 13,
  brightcyan: 14,
  brightwhite: 15,
}

const ANSI_RGB: [number, number, number][] = [
  [0, 0, 0], [205, 49, 49], [13, 188, 121], [229, 229, 16],
  [36, 114, 200], [188, 63, 188], [17, 168, 205], [229, 229, 229],
  [102, 102, 102], [241, 76, 76], [35, 209, 139], [245, 245, 67],
  [59, 142, 234], [214, 112, 214], [41, 184, 219], [255, 255, 255],
]

const cache = new Map<string, Color | null>()

export function parseColor(input: string): Color | null {
  const key = input
  if (cache.has(key)) return cache.get(key)!
  const value = parseColorUncached(input.trim())
  cache.set(key, value)
  return value
}

function parseColorUncached(v: string): Color | null {
  if (!v) return null
  if (v[0] === '#') {
    let hex = v.slice(1)
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null
    return {
      kind: 'rgb',
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }
  let m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(v)
  if (m) return { kind: 'rgb', r: clamp(+m[1]), g: clamp(+m[2]), b: clamp(+m[3]) }
  m = /^ansi256\(\s*(\d+)\s*\)$/i.exec(v)
  if (m) return { kind: '256', n: Math.min(255, +m[1]) }
  let name = v.toLowerCase().replace(/[-_\s]/g, '')
  if (name.endsWith('bright') && name !== 'bright') name = 'bright' + name.slice(0, -6)
  if (name in ANSI_NAMES) return { kind: 'ansi', code: ANSI_NAMES[name] }
  return null
}

function clamp(n: number) {
  return Math.max(0, Math.min(255, n | 0))
}

export function colorToRgb(c: Color): [number, number, number] {
  if (c.kind === 'rgb') return [c.r, c.g, c.b]
  if (c.kind === 'ansi') return ANSI_RGB[c.code]
  const n = c.n
  if (n < 16) return ANSI_RGB[n]
  if (n >= 232) {
    const g = 8 + (n - 232) * 10
    return [g, g, g]
  }
  const i = n - 16
  const steps = [0, 95, 135, 175, 215, 255]
  return [steps[Math.floor(i / 36)], steps[Math.floor(i / 6) % 6], steps[i % 6]]
}

function rgbTo256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16
    if (r > 248) return 231
    return Math.round(((r - 8) / 247) * 24) + 232
  }
  const q = (x: number) => (x < 48 ? 0 : x < 115 ? 1 : Math.floor((x - 35) / 40))
  return 16 + 36 * q(r) + 6 * q(g) + q(b)
}

function rgbTo16(r: number, g: number, b: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < 16; i++) {
    const [R, G, B] = ANSI_RGB[i]
    const d = (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Returns the SGR parameter list (without ESC[ and m) for a color. */
export function colorSgr(c: Color, layer: 'fg' | 'bg', depth: ColorDepth): string {
  if (c.kind === 'ansi') return ansiSgr(c.code, layer)
  if (c.kind === '256') {
    if (depth === 16) {
      const [r, g, b] = colorToRgb(c)
      return ansiSgr(rgbTo16(r, g, b), layer)
    }
    return `${layer === 'fg' ? 38 : 48};5;${c.n}`
  }
  if (depth === 'truecolor') return `${layer === 'fg' ? 38 : 48};2;${c.r};${c.g};${c.b}`
  if (depth === 256) return `${layer === 'fg' ? 38 : 48};5;${rgbTo256(c.r, c.g, c.b)}`
  return ansiSgr(rgbTo16(c.r, c.g, c.b), layer)
}

function ansiSgr(code: number, layer: 'fg' | 'bg') {
  const base = layer === 'fg' ? 30 : 40
  return code < 8 ? String(base + code) : String(base + 60 + code - 8)
}

/** Mix two colors (t = 0 → a, t = 1 → b). Returns a hex string. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return a
  const [r1, g1, b1] = colorToRgb(ca)
  const [r2, g2, b2] = colorToRgb(cb)
  const h = (x: number) => Math.round(x).toString(16).padStart(2, '0')
  return `#${h(r1 + (r2 - r1) * t)}${h(g1 + (g2 - g1) * t)}${h(b1 + (b2 - b1) * t)}`
}

export function detectColorDepth(env: NodeJS.ProcessEnv = process.env): ColorDepth {
  if (env.VUECLI_COLOR === '16') return 16
  if (env.VUECLI_COLOR === '256') return 256
  if (env.VUECLI_COLOR === 'truecolor') return 'truecolor'
  const ct = (env.COLORTERM || '').toLowerCase()
  if (ct === 'truecolor' || ct === '24bit') return 'truecolor'
  const term = (env.TERM || '').toLowerCase()
  if (term.includes('truecolor') || term.includes('direct') || env.TERM_PROGRAM === 'iTerm.app' || env.WT_SESSION) {
    return 'truecolor'
  }
  if (term.includes('256')) return 256
  return 256
}
