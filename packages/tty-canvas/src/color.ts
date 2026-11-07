/**
 * CSS color parsing (CSS Color 4 subset used by canvas): hex (#rgb, #rgba,
 * #rrggbb, #rrggbbaa), rgb()/rgba(), hsl()/hsla(), hwb(), named colors,
 * `transparent` and `currentcolor` (treated as black).
 */

/** Non-premultiplied RGBA; r/g/b in 0..255, a in 0..1. */
export type RGBA = [number, number, number, number]

const NAMED: Record<string, number> = {
  aliceblue: 0xf0f8ff, antiquewhite: 0xfaebd7, aqua: 0x00ffff, aquamarine: 0x7fffd4, azure: 0xf0ffff,
  beige: 0xf5f5dc, bisque: 0xffe4c4, black: 0x000000, blanchedalmond: 0xffebcd, blue: 0x0000ff,
  blueviolet: 0x8a2be2, brown: 0xa52a2a, burlywood: 0xdeb887, cadetblue: 0x5f9ea0, chartreuse: 0x7fff00,
  chocolate: 0xd2691e, coral: 0xff7f50, cornflowerblue: 0x6495ed, cornsilk: 0xfff8dc, crimson: 0xdc143c,
  cyan: 0x00ffff, darkblue: 0x00008b, darkcyan: 0x008b8b, darkgoldenrod: 0xb8860b, darkgray: 0xa9a9a9,
  darkgreen: 0x006400, darkgrey: 0xa9a9a9, darkkhaki: 0xbdb76b, darkmagenta: 0x8b008b, darkolivegreen: 0x556b2f,
  darkorange: 0xff8c00, darkorchid: 0x9932cc, darkred: 0x8b0000, darksalmon: 0xe9967a, darkseagreen: 0x8fbc8f,
  darkslateblue: 0x483d8b, darkslategray: 0x2f4f4f, darkslategrey: 0x2f4f4f, darkturquoise: 0x00ced1,
  darkviolet: 0x9400d3, deeppink: 0xff1493, deepskyblue: 0x00bfff, dimgray: 0x696969, dimgrey: 0x696969,
  dodgerblue: 0x1e90ff, firebrick: 0xb22222, floralwhite: 0xfffaf0, forestgreen: 0x228b22, fuchsia: 0xff00ff,
  gainsboro: 0xdcdcdc, ghostwhite: 0xf8f8ff, gold: 0xffd700, goldenrod: 0xdaa520, gray: 0x808080,
  green: 0x008000, greenyellow: 0xadff2f, grey: 0x808080, honeydew: 0xf0fff0, hotpink: 0xff69b4,
  indianred: 0xcd5c5c, indigo: 0x4b0082, ivory: 0xfffff0, khaki: 0xf0e68c, lavender: 0xe6e6fa,
  lavenderblush: 0xfff0f5, lawngreen: 0x7cfc00, lemonchiffon: 0xfffacd, lightblue: 0xadd8e6, lightcoral: 0xf08080,
  lightcyan: 0xe0ffff, lightgoldenrodyellow: 0xfafad2, lightgray: 0xd3d3d3, lightgreen: 0x90ee90, lightgrey: 0xd3d3d3,
  lightpink: 0xffb6c1, lightsalmon: 0xffa07a, lightseagreen: 0x20b2aa, lightskyblue: 0x87cefa, lightslategray: 0x778899,
  lightslategrey: 0x778899, lightsteelblue: 0xb0c4de, lightyellow: 0xffffe0, lime: 0x00ff00, limegreen: 0x32cd32,
  linen: 0xfaf0e6, magenta: 0xff00ff, maroon: 0x800000, mediumaquamarine: 0x66cdaa, mediumblue: 0x0000cd,
  mediumorchid: 0xba55d3, mediumpurple: 0x9370db, mediumseagreen: 0x3cb371, mediumslateblue: 0x7b68ee,
  mediumspringgreen: 0x00fa9a, mediumturquoise: 0x48d1cc, mediumvioletred: 0xc71585, midnightblue: 0x191970,
  mintcream: 0xf5fffa, mistyrose: 0xffe4e1, moccasin: 0xffe4b5, navajowhite: 0xffdead, navy: 0x000080,
  oldlace: 0xfdf5e6, olive: 0x808000, olivedrab: 0x6b8e23, orange: 0xffa500, orangered: 0xff4500,
  orchid: 0xda70d6, palegoldenrod: 0xeee8aa, palegreen: 0x98fb98, paleturquoise: 0xafeeee, palevioletred: 0xdb7093,
  papayawhip: 0xffefd5, peachpuff: 0xffdab9, peru: 0xcd853f, pink: 0xffc0cb, plum: 0xdda0dd,
  powderblue: 0xb0e0e6, purple: 0x800080, rebeccapurple: 0x663399, red: 0xff0000, rosybrown: 0xbc8f8f,
  royalblue: 0x4169e1, saddlebrown: 0x8b4513, salmon: 0xfa8072, sandybrown: 0xf4a460, seagreen: 0x2e8b57,
  seashell: 0xfff5ee, sienna: 0xa0522d, silver: 0xc0c0c0, skyblue: 0x87ceeb, slateblue: 0x6a5acd,
  slategray: 0x708090, slategrey: 0x708090, snow: 0xfffafa, springgreen: 0x00ff7f, steelblue: 0x4682b4,
  tan: 0xd2b48c, teal: 0x008080, thistle: 0xd8bfd8, tomato: 0xff6347, turquoise: 0x40e0d0,
  violet: 0xee82ee, wheat: 0xf5deb3, white: 0xffffff, whitesmoke: 0xf5f5f5, yellow: 0xffff00,
  yellowgreen: 0x9acd32,
}

const cache = new Map<string, RGBA | null>()

/** Parses a CSS color string. Returns null when it is not a valid color. */
export function parseColor(input: string): RGBA | null {
  if (typeof input !== 'string') return null
  const hit = cache.get(input)
  if (hit !== undefined) return hit ? (hit.slice() as RGBA) : null
  const v = parseUncached(input.trim().toLowerCase())
  if (cache.size > 512) cache.clear()
  cache.set(input, v)
  return v ? (v.slice() as RGBA) : null
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

function parseUncached(v: string): RGBA | null {
  if (!v) return null
  if (v[0] === '#') return parseHex(v.slice(1))
  if (v === 'transparent') return [0, 0, 0, 0]
  if (v === 'currentcolor') return [0, 0, 0, 1]
  const named = NAMED[v]
  if (named !== undefined) return [(named >> 16) & 255, (named >> 8) & 255, named & 255, 1]
  const m = /^(rgba?|hsla?|hwb)\((.*)\)$/.exec(v)
  if (!m) return null
  const fn = m[1]
  const args = splitArgs(m[2])
  if (!args) return null
  const [parts, alphaPart] = args
  if (parts.length !== 3) return null
  const alpha = alphaPart === undefined ? 1 : parseAlpha(alphaPart)
  if (alpha === null) return null
  if (fn === 'rgb' || fn === 'rgba') {
    const ch = parts.map((p) => parseChannel(p))
    if (ch.some((c) => c === null)) return null
    return [Math.round(ch[0]!), Math.round(ch[1]!), Math.round(ch[2]!), alpha]
  }
  const h = parseHue(parts[0])
  const p1 = parsePercent(parts[1])
  const p2 = parsePercent(parts[2])
  if (h === null || p1 === null || p2 === null) return null
  const [r, g, b] = fn === 'hwb' ? hwbToRgb(h, p1, p2) : hslToRgb(h, p1, p2)
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), alpha]
}

function parseHex(h: string): RGBA | null {
  if (!/^[0-9a-f]+$/.test(h)) return null
  const n = (s: string) => parseInt(s, 16)
  if (h.length === 3 || h.length === 4) {
    const a = h.length === 4 ? n(h[3] + h[3]) / 255 : 1
    return [n(h[0] + h[0]), n(h[1] + h[1]), n(h[2] + h[2]), a]
  }
  if (h.length === 6 || h.length === 8) {
    const a = h.length === 8 ? n(h.slice(6, 8)) / 255 : 1
    return [n(h.slice(0, 2)), n(h.slice(2, 4)), n(h.slice(4, 6)), a]
  }
  return null
}

/** Splits "1, 2, 3, 0.5" / "1 2 3 / 50%" into channel parts and optional alpha. */
function splitArgs(s: string): [string[], string | undefined] | null {
  s = s.trim()
  if (s.includes(',')) {
    const p = s.split(',').map((x) => x.trim())
    if (p.length === 4) return [p.slice(0, 3), p[3]]
    if (p.length === 3) return [p, undefined]
    return null
  }
  const [main, alpha] = s.split('/').map((x) => x.trim())
  const p = main.split(/\s+/).filter(Boolean)
  if (p.length === 4 && alpha === undefined) return [p.slice(0, 3), p[3]]
  return [p, alpha]
}

function num(s: string): number | null {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(s)) return null
  return parseFloat(s)
}

function parseChannel(s: string): number | null {
  if (s === 'none') return 0
  if (s.endsWith('%')) {
    const n = num(s.slice(0, -1))
    return n === null ? null : clamp((n / 100) * 255, 0, 255)
  }
  const n = num(s)
  return n === null ? null : clamp(n, 0, 255)
}

function parseAlpha(s: string): number | null {
  if (s === 'none') return 0
  if (s.endsWith('%')) {
    const n = num(s.slice(0, -1))
    return n === null ? null : clamp(n / 100, 0, 1)
  }
  const n = num(s)
  return n === null ? null : clamp(n, 0, 1)
}

function parsePercent(s: string): number | null {
  if (s === 'none') return 0
  const n = num(s.endsWith('%') ? s.slice(0, -1) : s)
  return n === null ? null : clamp(n / 100, 0, 1)
}

function parseHue(s: string): number | null {
  if (s === 'none') return 0
  const m = /^(.*?)(deg|rad|grad|turn)?$/.exec(s)!
  const n = num(m[1])
  if (n === null) return null
  const deg = m[2] === 'rad' ? (n * 180) / Math.PI : m[2] === 'grad' ? n * 0.9 : m[2] === 'turn' ? n * 360 : n
  return ((deg % 360) + 360) % 360
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

function hwbToRgb(h: number, w: number, b: number): [number, number, number] {
  if (w + b >= 1) {
    const g = w / (w + b)
    return [g, g, g]
  }
  const rgb = hslToRgb(h, 1, 0.5)
  return rgb.map((c) => c * (1 - w - b) + w) as [number, number, number]
}

/** Serializes like browsers do for fillStyle/strokeStyle: `#rrggbb` or `rgba(r, g, b, a)`. */
export function serializeColor(c: RGBA): string {
  if (c[3] >= 1) return '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)
  const a = Math.round(c[3] * 1000) / 1000
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a === 0 ? 0 : a})`
}

/** 0xRRGGBB → [r, g, b]. */
export function unpackRgb(n: number): [number, number, number] {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Parses a CSS color (or 0xRRGGBB number) into a 0xRRGGBB number (alpha ignored); null if invalid / transparent. */
export function toRgbNumber(c: string | number | null | undefined): number | null {
  if (c === null || c === undefined) return null
  if (typeof c === 'number') return c & 0xffffff
  const p = parseColor(c)
  if (!p || p[3] === 0) return null
  return (p[0] << 16) | (p[1] << 8) | p[2]
}
