import { loadFigletFont, type FigletFont } from './figlet.js'
import standard from './standard.js'
import slant from './slant.js'
import small from './small.js'
import mini from './mini.js'

export * from './figlet.js'

/** Raw `.flf` sources of the bundled FIGlet fonts (New BSD License, see each file). */
const SOURCES: Record<string, string> = { standard, slant, small, mini }
const parsed = new Map<string, FigletFont>()

/** Names of the registered fonts (bundled + `registerFigletFont`). */
export function figletFontNames(): string[] {
  return [...new Set([...Object.keys(SOURCES), ...parsed.keys()])]
}

/** Registers a font (`.flf` source text or a parsed font) under a name. */
export function registerFigletFont(name: string, font: string | FigletFont) {
  const key = name.toLowerCase()
  if (typeof font === 'string') {
    SOURCES[key] = font
    parsed.delete(key)
  } else parsed.set(key, { ...font, name })
}

/** Returns a registered font by name (parsed lazily and cached), or null. */
export function getFigletFont(name: string): FigletFont | null {
  const key = name.toLowerCase().replace(/\.flf$/, '')
  let f = parsed.get(key)
  if (!f && SOURCES[key]) {
    f = loadFigletFont(SOURCES[key], key)
    parsed.set(key, f)
  }
  return f ?? null
}
