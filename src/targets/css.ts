/**
 * SGR (ANSI) cell styles -> CSS, shared by the browser console target, the DOM
 * view and the frame player. Browser-safe and dependency-free on purpose (the
 * player bundles this file).
 */

/** Flags bitmask, same values as `Flag` in src/render/buffer.ts. */
export const BOLD = 1
export const DIM = 2
export const ITALIC = 4
export const UNDERLINE = 8
export const INVERSE = 16
export const STRIKE = 32

export interface Palette {
  /** Color of cells with the terminal default foreground (`fg === ''`). */
  fg: string
  /** Color of cells with the terminal default background (`bg === ''`). */
  bg: string
  /** The 16 ANSI colors (index 0..15). */
  ansi: string[]
}

/** VS Code-like dark palette (matches the RGB table in src/style/colors.ts). */
export const defaultPalette: Palette = {
  fg: '#d4d4d4',
  bg: '#1e1e1e',
  ansi: [
    '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
    '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff',
  ],
}

const hex2 = (n: number) => (n < 16 ? '0' : '') + n.toString(16)
const rgbHex = (r: number, g: number, b: number) => '#' + hex2(r) + hex2(g) + hex2(b)

function xterm256(n: number, p: Palette): string {
  if (n < 16) return p.ansi[n]
  if (n >= 232) {
    const g = 8 + (n - 232) * 10
    return rgbHex(g, g, g)
  }
  const i = n - 16
  const s = [0, 95, 135, 175, 215, 255]
  return rgbHex(s[Math.floor(i / 36)], s[Math.floor(i / 6) % 6], s[i % 6])
}

/**
 * Resolves an SGR color parameter string (`31`, `97`, `38;5;208`,
 * `48;2;10;20;30`, ...) to a `#rrggbb` color. Returns null for the default color.
 */
export function sgrColor(sgr: string, p: Palette = defaultPalette): string | null {
  if (!sgr) return null
  const parts = sgr.split(';')
  const a = +parts[0]
  if (a === 38 || a === 48) {
    if (parts[1] === '5') return xterm256(+parts[2] | 0, p)
    if (parts[1] === '2') return rgbHex(+parts[2] & 255, +parts[3] & 255, +parts[4] & 255)
    return null
  }
  if (a >= 30 && a <= 37) return p.ansi[a - 30]
  if (a >= 40 && a <= 47) return p.ansi[a - 40]
  if (a >= 90 && a <= 97) return p.ansi[a - 90 + 8]
  if (a >= 100 && a <= 107) return p.ansi[a - 100 + 8]
  return null
}

function mixHex(a: string, b: string, t: number): string {
  const ch = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16)
  const m = (i: number) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t)
  return rgbHex(m(0), m(1), m(2))
}

export interface ResolvedStyle {
  color: string
  background: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
}

/** Resolves a cell's style to concrete colors (inverse and dim applied). */
export function resolveStyle(fg: string, bg: string, flags: number, p: Palette = defaultPalette): ResolvedStyle {
  let color = sgrColor(fg, p) ?? p.fg
  let background = sgrColor(bg, p) ?? p.bg
  if (flags & INVERSE) [color, background] = [background, color]
  if (flags & DIM) color = mixHex(color, background, 0.5)
  return {
    color,
    background,
    bold: !!(flags & BOLD),
    italic: !!(flags & ITALIC),
    underline: !!(flags & UNDERLINE),
    strike: !!(flags & STRIKE),
  }
}

/**
 * CSS declarations for a cell style, e.g. `color:#e5e5e5;background:#1e1e1e;font-weight:bold`.
 * Only properties that the devtools console honours for `%c` are used.
 */
export function styleCss(fg: string, bg: string, flags: number, p: Palette = defaultPalette): string {
  const s = resolveStyle(fg, bg, flags, p)
  let css = `color:${s.color};background:${s.background}`
  if (s.bold) css += ';font-weight:bold'
  if (s.italic) css += ';font-style:italic'
  if (s.underline || s.strike) css += `;text-decoration:${[s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ')}`
  return css
}
