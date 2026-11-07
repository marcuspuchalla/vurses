import stringWidth from 'string-width'
import type { Ink } from '../style/style.js'

export interface Glyph {
  /** A single grapheme cluster. */
  ch: string
  /** Display width in cells (0, 1 or 2). */
  w: number
  /** Ink (own styles of the text element / nested spans). */
  ink: Ink
}

export type Line = Glyph[]
export type WrapMode = 'wrap' | 'truncate' | 'truncate-start' | 'truncate-middle' | 'none'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const widthCache = new Map<string, number>()

export function graphemeWidth(g: string): number {
  if (g.length === 1) {
    const c = g.charCodeAt(0)
    if (c >= 0x20 && c < 0x7f) return 1
    if (c < 0x20 || c === 0x7f) return 0
  }
  let w = widthCache.get(g)
  if (w === undefined) {
    w = Math.min(2, stringWidth(g))
    widthCache.set(g, w)
  }
  return w
}

export function textWidth(s: string): number {
  let w = 0
  for (const { segment } of segmenter.segment(s)) w += graphemeWidth(segment)
  return w
}

export function toGlyphs(text: string, ink: Ink, out: Glyph[] = []): Glyph[] {
  // fast path for ASCII
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e\n]*$/.test(text)) {
    for (let i = 0; i < text.length; i++) out.push({ ch: text[i], w: text[i] === '\n' ? 0 : 1, ink })
    return out
  }
  for (const { segment } of segmenter.segment(text)) {
    if (segment === '\t') {
      for (let i = 0; i < 2; i++) out.push({ ch: ' ', w: 1, ink })
      continue
    }
    if (segment === '\r\n' || segment === '\n') {
      out.push({ ch: '\n', w: 0, ink })
      continue
    }
    const w = graphemeWidth(segment)
    if (w === 0 && segment !== '\n') continue
    out.push({ ch: segment, w, ink })
  }
  return out
}

export function lineWidth(line: Line): number {
  let w = 0
  for (const g of line) w += g.w
  return w
}

function splitParagraphs(glyphs: Glyph[]): Line[] {
  const paras: Line[] = [[]]
  for (const g of glyphs) {
    if (g.ch === '\n') paras.push([])
    else paras[paras.length - 1].push(g)
  }
  return paras
}

const ELLIPSIS = '…'

function truncate(line: Line, max: number, mode: WrapMode): Line {
  const total = lineWidth(line)
  if (total <= max) return line
  if (max <= 0) return []
  const ink = line[line.length - 1]?.ink ?? {}
  const ell: Glyph = { ch: ELLIPSIS, w: 1, ink }
  if (max === 1) return [ell]
  if (mode === 'truncate-start') {
    const out: Glyph[] = []
    let w = 0
    for (let i = line.length - 1; i >= 0; i--) {
      if (w + line[i].w > max - 1) break
      w += line[i].w
      out.unshift(line[i])
    }
    return [{ ...ell, ink: line[0].ink }, ...out]
  }
  if (mode === 'truncate-middle') {
    const left = Math.ceil((max - 1) / 2)
    const right = max - 1 - left
    const head = takeWidth(line, left)
    const tail: Glyph[] = []
    let w = 0
    for (let i = line.length - 1; i >= 0 && w + line[i].w <= right; i--) {
      w += line[i].w
      tail.unshift(line[i])
    }
    return [...head, ell, ...tail]
  }
  return [...takeWidth(line, max - 1), ell]
}

function takeWidth(line: Line, max: number): Line {
  const out: Glyph[] = []
  let w = 0
  for (const g of line) {
    if (w + g.w > max) break
    w += g.w
    out.push(g)
  }
  return out
}

function wrapParagraph(para: Line, max: number, out: Line[]) {
  if (para.length === 0) {
    out.push([])
    return
  }
  const startLen = out.length
  let line: Glyph[] = []
  let lineW = 0
  let i = 0
  while (i < para.length) {
    // collect a token: run of spaces or run of non-spaces
    const isSpace = para[i].ch === ' '
    let j = i
    let tokW = 0
    while (j < para.length && (para[j].ch === ' ') === isSpace) {
      tokW += para[j].w
      j++
    }
    if (isSpace) {
      if (lineW + tokW <= max) {
        if (lineW > 0 || out.length === startLen) {
          for (let k = i; k < j; k++) line.push(para[k])
          lineW += tokW
        }
      } else if (lineW > 0) {
        out.push(line)
        line = []
        lineW = 0
      }
      i = j
      continue
    }
    if (lineW + tokW <= max) {
      for (let k = i; k < j; k++) line.push(para[k])
      lineW += tokW
      i = j
      continue
    }
    if (lineW > 0) {
      trimEnd(line)
      out.push(line)
      line = []
      lineW = 0
      if (tokW <= max) continue
    }
    // word longer than line: hard break
    for (let k = i; k < j; k++) {
      const g = para[k]
      if (lineW + g.w > max && lineW > 0) {
        out.push(line)
        line = []
        lineW = 0
      }
      line.push(g)
      lineW += g.w
    }
    i = j
  }
  // keep trailing spaces of the paragraph (they are intentional in terminal UIs)
  out.push(line)
}

function trimEnd(line: Glyph[]) {
  while (line.length && line[line.length - 1].ch === ' ') line.pop()
}

export function wrapGlyphs(glyphs: Glyph[], maxWidth: number, mode: WrapMode = 'wrap'): Line[] {
  const paras = splitParagraphs(glyphs)
  const max = Math.max(1, Math.floor(maxWidth))
  if (!Number.isFinite(maxWidth) || mode === 'none') return paras
  if (mode !== 'wrap') return paras.map((p) => truncate(p, max, mode))
  const out: Line[] = []
  for (const p of paras) wrapParagraph(p, max, out)
  return out
}

export function measureGlyphs(glyphs: Glyph[], maxWidth: number, mode: WrapMode = 'wrap') {
  if (glyphs.length === 0) return { width: 0, height: 0, lines: [] as Line[] }
  const lines = wrapGlyphs(glyphs, maxWidth, mode)
  let width = 0
  for (const l of lines) width = Math.max(width, lineWidth(l))
  return { width, height: lines.length, lines }
}
