/**
 * FIGlet font (.flf) parser and renderer.
 *
 * Implements the FIGfont 2 standard: header parsing (hardblank, height,
 * baseline, old/full layout, print direction, code-tagged characters) and
 * horizontal layout — full width, fitting (kerning), universal smushing and
 * controlled smushing rules 1–6 (equal character, underscore, hierarchy,
 * opposite pair, big X, hardblank), following the reference `figlet.c`.
 */

export const SM_EQUAL = 1
export const SM_LOWLINE = 2
export const SM_HIERARCHY = 4
export const SM_PAIR = 8
export const SM_BIGX = 16
export const SM_HARDBLANK = 32
export const SM_KERN = 64
export const SM_SMUSH = 128

export type FigletLayout = 'default' | 'full' | 'fitted' | 'smushed' | 'universal'

export interface FigletFont {
  /** Font name (when registered / given). */
  name?: string
  hardblank: string
  height: number
  baseline: number
  maxLength: number
  /** Horizontal smush mode bits (SM_* flags) from the header. */
  smushMode: number
  /** 0 = left-to-right, 1 = right-to-left. */
  printDirection: number
  /** Header comment lines (credits / license). */
  comment: string
  /** Character code → rows (hardblanks not yet replaced). */
  chars: Map<number, string[]>
}

const DEUTSCH = [196, 214, 220, 228, 246, 252, 223]

function parseCode(s: string): number | null {
  const m = /^(-?)(0x[0-9a-f]+|0[0-7]*|[1-9][0-9]*)$/i.exec(s)
  if (!m) return null
  const body = m[2]
  let n: number
  if (/^0x/i.test(body)) n = parseInt(body.slice(2), 16)
  else if (body.length > 1 && body[0] === '0') n = parseInt(body.slice(1), 8)
  else n = parseInt(body, 10)
  return m[1] ? -n : n
}

/** Strips the trailing endmark(s) of a font line (figlet.c `readfontchar`). */
function stripEndmarks(line: string): string {
  let k = line.length - 1
  while (k >= 0 && /\s/.test(line[k])) k--
  if (k < 0) return ''
  const end = line[k]
  while (k >= 0 && line[k] === end) k--
  return line.slice(0, k + 1)
}

/** Parses the contents of a `.flf` file. Throws on an invalid header. */
export function loadFigletFont(text: string, name?: string): FigletFont {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const header = lines[0] ?? ''
  const m = /^flf2a(.)\s+(.*)$/.exec(header)
  if (!m) throw new Error(`[vurses] invalid FIGlet font${name ? ` "${name}"` : ''}: missing "flf2a" signature`)
  const hardblank = m[1]
  const nums = m[2].trim().split(/\s+/).map((x) => parseInt(x, 10))
  const [height, baseline, maxLength, oldLayout, commentLines] = nums
  if (!(height > 0) || !Number.isFinite(oldLayout) || !Number.isFinite(commentLines)) {
    throw new Error(`[vurses] invalid FIGlet font${name ? ` "${name}"` : ''}: bad header "${header}"`)
  }
  const printDirection = Number.isFinite(nums[5]) ? nums[5] : 0
  const fullLayout = Number.isFinite(nums[6]) ? nums[6] : undefined

  let smushMode: number
  if (fullLayout === undefined) {
    if (oldLayout === 0) smushMode = SM_KERN
    else if (oldLayout < 0) smushMode = 0
    else smushMode = (oldLayout & 31) | SM_SMUSH
  } else {
    // horizontal part only: rules (bits 0-5), fitting (64), smushing (128)
    smushMode = fullLayout & (63 | SM_KERN | SM_SMUSH)
  }

  const comment = lines.slice(1, 1 + commentLines).join('\n')
  const chars = new Map<number, string[]>()
  let i = 1 + commentLines
  const readChar = (): string[] | null => {
    if (i + height > lines.length) return null
    const rows: string[] = []
    for (let r = 0; r < height; r++) rows.push(stripEndmarks(lines[i + r]))
    i += height
    return rows
  }
  for (let code = 32; code <= 126; code++) {
    const rows = readChar()
    if (!rows) break
    chars.set(code, rows)
  }
  for (const code of DEUTSCH) {
    if (i + height > lines.length) break
    const rows = readChar()
    if (!rows) break
    chars.set(code, rows)
  }
  // code-tagged characters
  while (i < lines.length) {
    const tag = lines[i].trim()
    if (!tag) {
      i++
      continue
    }
    const code = parseCode(tag.split(/\s+/)[0])
    i++
    const rows = readChar()
    if (!rows) break
    if (code !== null && code !== -1) chars.set(code, rows)
  }
  return { name, hardblank, height, baseline, maxLength, smushMode, printDirection, comment, chars }
}

export interface FigletRenderOptions {
  /** Override the font's horizontal layout. */
  layout?: FigletLayout
  /** Keep hardblanks instead of replacing them with spaces (debugging). */
  keepHardblanks?: boolean
  /** Trim trailing whitespace on every row. Default false (rows have equal width). */
  trimEnd?: boolean
}

const has = (set: string, ch: string) => ch.length === 1 && set.includes(ch)

/**
 * Renders text with a FIGlet font. Returns one string per output row; `\n`
 * in the text starts a new block of rows.
 */
export function renderFiglet(text: string, font: FigletFont, options: FigletRenderOptions = {}): string[] {
  let mode = font.smushMode
  switch (options.layout) {
    case 'full':
      mode = 0
      break
    case 'fitted':
      mode = SM_KERN
      break
    case 'smushed':
      mode = (font.smushMode & 63) | SM_SMUSH
      break
    case 'universal':
      mode = SM_SMUSH
      break
  }
  const hb = font.hardblank
  const rtl = font.printDirection === 1
  const out: string[] = []
  for (const para of text.split('\n')) {
    let codes = Array.from(para, (c) => c.codePointAt(0)!)
    if (rtl) codes = codes.reverse()
    const rows = renderLine(codes, font, mode)
    for (let r of rows) {
      if (!options.keepHardblanks) r = r.split(hb).join(' ')
      if (options.trimEnd) r = r.replace(/\s+$/, '')
      out.push(r)
    }
  }
  return out
}

function renderLine(codes: number[], font: FigletFont, mode: number): string[] {
  const height = font.height
  const hb = font.hardblank
  let output: string[] = Array.from({ length: height }, () => '')
  let prevWidth = 0

  const smushem = (lch: string, rch: string, curWidth: number): string => {
    if (lch === ' ') return rch
    if (rch === ' ') return lch
    if (prevWidth < 2 || curWidth < 2) return ''
    if ((mode & SM_SMUSH) === 0) return '' // fitting only
    if ((mode & 63) === 0) {
      // universal smushing
      if (lch === hb) return rch
      if (rch === hb) return lch
      return rch
    }
    if (mode & SM_HARDBLANK && lch === hb && rch === hb) return lch
    if (lch === hb || rch === hb) return ''
    if (mode & SM_EQUAL && lch === rch) return lch
    if (mode & SM_LOWLINE) {
      if (lch === '_' && has('|/\\[]{}()<>', rch)) return rch
      if (rch === '_' && has('|/\\[]{}()<>', lch)) return lch
    }
    if (mode & SM_HIERARCHY) {
      const classes = ['|', '/\\', '[]', '{}', '()', '<>']
      for (let c = 0; c < classes.length; c++) {
        const higher = classes.slice(c + 1).join('')
        if (has(classes[c], lch) && has(higher, rch)) return rch
        if (has(classes[c], rch) && has(higher, lch)) return lch
      }
    }
    if (mode & SM_PAIR) {
      const pair = lch + rch
      if (pair === '[]' || pair === '][' || pair === '{}' || pair === '}{' || pair === '()' || pair === ')(') return '|'
    }
    if (mode & SM_BIGX) {
      if (lch === '/' && rch === '\\') return '|'
      if (lch === '\\' && rch === '/') return 'Y'
      if (lch === '>' && rch === '<') return 'X'
    }
    return ''
  }

  const smushAmount = (cur: string[], curWidth: number): number => {
    if ((mode & (SM_SMUSH | SM_KERN)) === 0) return 0
    let max = curWidth
    const outLen = output[0].length
    for (let row = 0; row < height; row++) {
      const line = output[row]
      let lb = line.length
      let ch1 = line[lb] ?? ''
      while (lb > 0 && (ch1 === '' || ch1 === ' ')) ch1 = line[--lb] ?? ''
      const cr = cur[row]
      let cb = 0
      while (cr[cb] === ' ') cb++
      const ch2 = cr[cb] ?? ''
      let amt = cb + outLen - 1 - lb
      if (ch1 === '' || ch1 === ' ') amt++
      else if (ch2 !== '' && smushem(ch1, ch2, curWidth) !== '') amt++
      if (amt < max) max = amt
    }
    return max
  }

  for (const code of codes) {
    const cur = font.chars.get(code) ?? font.chars.get(0)
    if (!cur) continue
    const curWidth = cur[0].length
    // pad rows of ragged characters to the char's width
    const rows = cur.map((r) => (r.length < curWidth ? r + ' '.repeat(curWidth - r.length) : r))
    const amount = Math.max(0, smushAmount(rows, curWidth))
    const outLen = output[0].length
    const next: string[] = []
    for (let row = 0; row < height; row++) {
      const chars = output[row].split('')
      for (let k = 0; k < amount; k++) {
        const pos = outLen - amount + k
        if (pos < 0) continue
        const lch = chars[pos] ?? ' '
        const rch = rows[row][k] ?? ' '
        chars[pos] = smushem(lch, rch, curWidth) || rch
      }
      next.push(chars.join('') + rows[row].slice(amount))
    }
    output = next
    prevWidth = curWidth
  }
  return output
}
