/**
 * Parses raw terminal input (stdin in raw mode) into key, paste and mouse events.
 */

export interface KeyEvent {
  type: 'key'
  /** Normalized key name: 'a', 'A', 'enter', 'escape', 'up', 'f1', 'space', ... */
  name: string
  /** Printable text produced by the key ('' for control keys). For paste events: the pasted text. */
  char: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  /** True when the event is a bracketed paste. */
  paste: boolean
  /** Raw escape sequence. */
  sequence: string
  stopPropagation(): void
  preventDefault(): void
  readonly propagationStopped: boolean
  readonly defaultPrevented: boolean
}

export type MouseButton = 'left' | 'middle' | 'right' | 'none'
export interface MouseEvent {
  type: 'mouse'
  action: 'down' | 'up' | 'move' | 'drag' | 'wheel'
  button: MouseButton
  /** For wheel events. */
  direction?: 'up' | 'down' | 'left' | 'right'
  /** 0-based cell coordinates. */
  x: number
  y: number
  ctrl: boolean
  meta: boolean
  shift: boolean
  sequence: string
}

export type InputEvent = KeyEvent | MouseEvent

function key(
  name: string,
  sequence: string,
  mods: Partial<Pick<KeyEvent, 'ctrl' | 'meta' | 'shift' | 'char' | 'paste'>> = {},
): KeyEvent {
  let stopped = false
  let prevented = false
  return {
    type: 'key',
    name,
    char: mods.char ?? '',
    ctrl: !!mods.ctrl,
    meta: !!mods.meta,
    shift: !!mods.shift,
    paste: !!mods.paste,
    sequence,
    stopPropagation() {
      stopped = true
    },
    preventDefault() {
      prevented = true
    },
    get propagationStopped() {
      return stopped
    },
    get defaultPrevented() {
      return prevented
    },
  }
}

export function createKeyEvent(
  name: string,
  mods: Partial<Pick<KeyEvent, 'ctrl' | 'meta' | 'shift' | 'char' | 'paste'>> = {},
): KeyEvent {
  return key(name, '', mods)
}

const CSI_TILDE: Record<string, string> = {
  '1': 'home', '2': 'insert', '3': 'delete', '4': 'end', '5': 'pageup', '6': 'pagedown',
  '7': 'home', '8': 'end', '11': 'f1', '12': 'f2', '13': 'f3', '14': 'f4', '15': 'f5',
  '17': 'f6', '18': 'f7', '19': 'f8', '20': 'f9', '21': 'f10', '23': 'f11', '24': 'f12',
}
const CSI_LETTER: Record<string, string> = {
  A: 'up', B: 'down', C: 'right', D: 'left', E: 'clear', F: 'end', H: 'home',
  P: 'f1', Q: 'f2', R: 'f3', S: 'f4', Z: 'tab',
}
const SS3: Record<string, string> = {
  A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', P: 'f1', Q: 'f2', R: 'f3', S: 'f4',
  M: 'enter',
}

function modsFrom(param: number | undefined) {
  const m = (param ?? 1) - 1
  return { shift: !!(m & 1), meta: !!(m & 2) || !!(m & 8), ctrl: !!(m & 4) }
}

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

export class InputParser {
  private pending = ''
  private pasteBuffer: string | null = null

  /** Feed raw input; returns parsed events. */
  feed(data: string): InputEvent[] {
    const events: InputEvent[] = []
    let s = this.pending + data
    this.pending = ''
    let i = 0
    while (i < s.length) {
      if (this.pasteBuffer !== null) {
        const end = s.indexOf(PASTE_END, i)
        if (end < 0) {
          this.pasteBuffer += s.slice(i)
          return events
        }
        this.pasteBuffer += s.slice(i, end)
        events.push(key('paste', this.pasteBuffer, { char: this.pasteBuffer.replace(/\r\n?/g, '\n'), paste: true }))
        this.pasteBuffer = null
        i = end + PASTE_END.length
        continue
      }
      if (s.startsWith(PASTE_START, i)) {
        this.pasteBuffer = ''
        i += PASTE_START.length
        continue
      }
      const ch = s[i]
      if (ch === '\x1b') {
        const consumed = this.parseEscape(s, i, events)
        if (consumed < 0) {
          // incomplete sequence: wait for more data
          this.pending = s.slice(i)
          return events
        }
        i += consumed
        continue
      }
      i += this.parseChar(s, i, events, false)
    }
    return events
  }

  /** Flush a dangling ESC (call after a short timeout with no further input). */
  flush(): InputEvent[] {
    if (!this.pending) return []
    const p = this.pending
    this.pending = ''
    if (p === '\x1b') return [key('escape', p)]
    return this.feed(p.replace(/^\x1b/, '')).map((e) => (e.type === 'key' ? { ...e, meta: true } : e))
  }

  get hasPending() {
    return this.pending.length > 0
  }

  private parseChar(s: string, i: number, events: InputEvent[], meta: boolean): number {
    const code = s.codePointAt(i)!
    const ch = String.fromCodePoint(code)
    const len = ch.length
    if (ch === '\r' || ch === '\n') events.push(key('enter', ch, { meta }))
    else if (ch === '\t') events.push(key('tab', ch, { meta }))
    else if (ch === '\x7f' || ch === '\b') events.push(key('backspace', ch, { meta, ctrl: ch === '\b' }))
    else if (ch === ' ') events.push(key('space', ch, { meta, char: meta ? '' : ' ' }))
    else if (code === 0) events.push(key('space', ch, { ctrl: true, meta }))
    else if (code < 27) events.push(key(String.fromCharCode(code + 96), ch, { ctrl: true, meta }))
    else if (code >= 28 && code < 32) events.push(key(['\\', ']', '^', '_'][code - 28], ch, { ctrl: true, meta }))
    else {
      const upper = ch !== ch.toLowerCase() && ch === ch.toUpperCase()
      events.push(key(ch, ch, { char: meta ? '' : ch, shift: upper, meta }))
    }
    return len
  }

  /** Returns consumed length, or -1 when more input is needed. */
  private parseEscape(s: string, i: number, events: InputEvent[]): number {
    if (i + 1 >= s.length) return -1
    const next = s[i + 1]
    if (next === '[') {
      // SGR mouse: ESC [ < b ; x ; y (M|m)
      if (s[i + 2] === '<') {
        const m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(s.slice(i))
        if (!m) return /^\x1b\[<[\d;]*$/.test(s.slice(i)) ? -1 : 3
        events.push(parseMouse(+m[1], +m[2] - 1, +m[3] - 1, m[4] === 'M', m[0]))
        return m[0].length
      }
      const m = /^\x1b\[([\d;:]*)([A-Za-z~$^])/.exec(s.slice(i))
      if (!m) {
        if (/^\x1b\[[\d;:]*$/.test(s.slice(i))) return -1
        events.push(key('escape', '\x1b'))
        return 1
      }
      const [seq, params, final] = m
      const parts = params.split(';').map((p) => (p === '' ? undefined : parseInt(p, 10)))
      if (final === 'I' || final === 'O') return seq.length // focus in/out
      if (final === '~') {
        const name = CSI_TILDE[String(parts[0])]
        if (name) events.push(key(name, seq, modsFrom(parts[1])))
        return seq.length
      }
      if (final === 'u') {
        // CSI u (fixterms / kitty): codepoint;modifiers u
        const cp = parts[0] ?? 0
        const mods = modsFrom(parts[1])
        const named: Record<number, string> = { 13: 'enter', 9: 'tab', 27: 'escape', 127: 'backspace', 32: 'space' }
        const name = named[cp] ?? String.fromCodePoint(cp)
        events.push(key(name, seq, { ...mods, char: !mods.ctrl && !mods.meta && !named[cp] ? name : '' }))
        return seq.length
      }
      const name = CSI_LETTER[final]
      if (name) {
        const mods = modsFrom(parts.length > 1 ? parts[1] : undefined)
        if (final === 'Z') mods.shift = true
        events.push(key(name, seq, mods))
      }
      return seq.length
    }
    if (next === 'O') {
      if (i + 2 >= s.length) return -1
      const name = SS3[s[i + 2]]
      if (name) events.push(key(name, s.slice(i, i + 3)))
      return 3
    }
    if (next === '\x1b') {
      events.push(key('escape', '\x1b', { meta: true }))
      return 2
    }
    // Alt/Meta + key
    return 1 + this.parseChar(s, i + 1, events, true)
  }
}

function parseMouse(b: number, x: number, y: number, press: boolean, seq: string): MouseEvent {
  const shift = !!(b & 4)
  const meta = !!(b & 8)
  const ctrl = !!(b & 16)
  const motion = !!(b & 32)
  const wheel = !!(b & 64)
  const low = b & 3
  const base = { type: 'mouse' as const, x, y, shift, meta, ctrl, sequence: seq }
  if (wheel) {
    const direction = (['up', 'down', 'left', 'right'] as const)[low]
    return { ...base, action: 'wheel', button: 'none', direction }
  }
  const button: MouseButton = low === 0 ? 'left' : low === 1 ? 'middle' : low === 2 ? 'right' : 'none'
  if (motion) return { ...base, action: button === 'none' ? 'move' : 'drag', button }
  return { ...base, action: press ? 'down' : 'up', button }
}

/**
 * Tests a key event against a combo string such as `'ctrl+s'`, `'shift+tab'`,
 * `'q'`, `'escape'`, `'up|k'` (alternatives separated by `|`).
 */
export function matchKey(e: KeyEvent, combo: string): boolean {
  for (const alt of combo.split('|')) {
    const parts = alt.trim().toLowerCase().split('+')
    let name = parts.pop()!
    if (name === '' && alt.endsWith('+')) name = '+'
    const want = { ctrl: false, meta: false, shift: false }
    for (const p of parts) {
      if (p === 'ctrl' || p === 'control') want.ctrl = true
      else if (p === 'alt' || p === 'meta' || p === 'option' || p === 'cmd') want.meta = true
      else if (p === 'shift') want.shift = true
    }
    const aliases: Record<string, string> = { esc: 'escape', return: 'enter', ' ': 'space', del: 'delete', pgup: 'pageup', pgdn: 'pagedown' }
    name = aliases[name] ?? name
    const evName = e.name.length === 1 ? e.name.toLowerCase() : e.name
    if (evName !== name) continue
    if (e.ctrl !== want.ctrl || e.meta !== want.meta) continue
    // shift is only enforced for non-printable keys or when explicitly requested
    if (want.shift && !e.shift) continue
    if (!want.shift && e.shift && e.name.length > 1) continue
    return true
  }
  return false
}

/** Human readable label for a combo, e.g. 'ctrl+s' → '^S'. */
export function formatKey(combo: string): string {
  return combo
    .split('|')[0]
    .split('+')
    .map((p) => {
      const l = p.toLowerCase()
      const map: Record<string, string> = {
        ctrl: '^', shift: '⇧', alt: '⌥', meta: '⌥', enter: '↵', escape: 'esc', esc: 'esc', up: '↑', down: '↓',
        left: '←', right: '→', tab: 'tab', space: 'space', backspace: '⌫', pageup: 'PgUp', pagedown: 'PgDn',
      }
      return map[l] ?? (p.length === 1 ? p : p)
    })
    .join('')
    .replace(/^\^(.)$/, (_, c: string) => '^' + c.toUpperCase())
}
