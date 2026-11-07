/**
 * Terminal input parser: legacy key sequences, the kitty keyboard protocol
 * (press / repeat / release events) and SGR mouse reports. Produces
 * browser-shaped key names (`KeyboardEvent.key` / `.code`).
 */
import { keyToCode } from '../dom.js'

export interface TermKey {
  type: 'key'
  /** KeyboardEvent.key, e.g. 'a', 'A', 'ArrowUp', 'Enter', ' ' */
  key: string
  code: string
  action: 'down' | 'repeat' | 'up'
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  /** True when the terminal reports key releases (kitty protocol). */
  reportsRelease: boolean
}

export interface TermMouse {
  type: 'mouse'
  action: 'down' | 'up' | 'move' | 'wheel'
  button: 'left' | 'middle' | 'right' | 'none'
  /** 0-based cell position. */
  x: number
  y: number
  wheel?: 'up' | 'down' | 'left' | 'right'
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export interface TermReport {
  type: 'report'
  /** Raw CSI report, e.g. cell size `6;20;10t`. */
  data: string
}

export type TermInput = TermKey | TermMouse | TermReport

const CSI_LETTER: Record<string, string> = { A: 'ArrowUp', B: 'ArrowDown', C: 'ArrowRight', D: 'ArrowLeft', H: 'Home', F: 'End', E: 'Clear', P: 'F1', Q: 'F2', R: 'F3', S: 'F4', Z: 'Tab' }
const CSI_TILDE: Record<number, string> = {
  1: 'Home', 2: 'Insert', 3: 'Delete', 4: 'End', 5: 'PageUp', 6: 'PageDown', 7: 'Home', 8: 'End',
  11: 'F1', 12: 'F2', 13: 'F3', 14: 'F4', 15: 'F5', 17: 'F6', 18: 'F7', 19: 'F8', 20: 'F9', 21: 'F10', 23: 'F11', 24: 'F12',
}
const KITTY_CODES: Record<number, [string, string]> = {
  9: ['Tab', 'Tab'], 13: ['Enter', 'Enter'], 27: ['Escape', 'Escape'], 127: ['Backspace', 'Backspace'], 32: [' ', 'Space'],
  57358: ['CapsLock', 'CapsLock'], 57359: ['ScrollLock', 'ScrollLock'], 57360: ['NumLock', 'NumLock'], 57361: ['PrintScreen', 'PrintScreen'],
  57362: ['Pause', 'Pause'], 57363: ['ContextMenu', 'ContextMenu'],
  57399: ['0', 'Numpad0'], 57400: ['1', 'Numpad1'], 57401: ['2', 'Numpad2'], 57402: ['3', 'Numpad3'], 57403: ['4', 'Numpad4'],
  57404: ['5', 'Numpad5'], 57405: ['6', 'Numpad6'], 57406: ['7', 'Numpad7'], 57407: ['8', 'Numpad8'], 57408: ['9', 'Numpad9'],
  57409: ['.', 'NumpadDecimal'], 57410: ['/', 'NumpadDivide'], 57411: ['*', 'NumpadMultiply'], 57412: ['-', 'NumpadSubtract'],
  57413: ['+', 'NumpadAdd'], 57414: ['Enter', 'NumpadEnter'], 57415: ['=', 'NumpadEqual'],
  57417: ['ArrowLeft', 'ArrowLeft'], 57418: ['ArrowRight', 'ArrowRight'], 57419: ['ArrowUp', 'ArrowUp'], 57420: ['ArrowDown', 'ArrowDown'],
  57421: ['PageUp', 'PageUp'], 57422: ['PageDown', 'PageDown'], 57423: ['Home', 'Home'], 57424: ['End', 'End'], 57425: ['Insert', 'Insert'], 57426: ['Delete', 'Delete'],
  57441: ['Shift', 'ShiftLeft'], 57442: ['Control', 'ControlLeft'], 57443: ['Alt', 'AltLeft'], 57444: ['Meta', 'MetaLeft'],
  57447: ['Shift', 'ShiftRight'], 57448: ['Control', 'ControlRight'], 57449: ['Alt', 'AltRight'], 57450: ['Meta', 'MetaRight'],
}

function codeFor(key: string) {
  return keyToCode(key) || key
}

function mods(m: number) {
  const b = Math.max(0, m - 1)
  return { shiftKey: !!(b & 1), altKey: !!(b & 2), ctrlKey: !!(b & 4), metaKey: !!(b & 8) || !!(b & 32) }
}

/** Incremental parser; feed() returns complete events, partial escape sequences are buffered. */
export class InputParser {
  private buf = ''
  /** Set once a kitty release/repeat event has been seen. */
  reportsRelease = false

  feed(data: string): TermInput[] {
    this.buf += data
    const out: TermInput[] = []
    let i = 0
    const s = this.buf
    while (i < s.length) {
      const c = s[i]
      if (c === '\x1b') {
        const rest = s.slice(i)
        if (rest.length === 1) break // lone ESC: wait for flush()
        // CSI
        if (rest[1] === '[') {
          const m = /^\x1b\[([<?>]?)([\d;:]*)([\x40-\x7e])/.exec(rest)
          if (!m) {
            if (/^\x1b\[[<?>]?[\d;:]*$/.test(rest)) break // incomplete
            i += 2
            continue
          }
          const ev = this.csi(m[1], m[2], m[3])
          if (ev) out.push(ev)
          i += m[0].length
          continue
        }
        if (rest[1] === 'O') {
          if (rest.length < 3) break
          const k = CSI_LETTER[rest[2]]
          if (k) out.push(this.key(k, codeFor(k), 1))
          i += 3
          continue
        }
        // alt + key
        const ch = rest[1]
        out.push(...this.plain(ch, true))
        i += 2
        continue
      }
      const cp = s.codePointAt(i)!
      const ch = String.fromCodePoint(cp)
      out.push(...this.plain(ch, false))
      i += ch.length
    }
    this.buf = s.slice(i)
    return out
  }

  /** Flushes a pending lone ESC as the Escape key. */
  flush(): TermInput[] {
    if (this.buf === '\x1b') {
      this.buf = ''
      return [this.key('Escape', 'Escape', 1)]
    }
    return []
  }

  get hasPending() {
    return this.buf.length > 0
  }

  private key(key: string, code: string, m: number, action: TermKey['action'] = 'down'): TermKey {
    return { type: 'key', key, code, action, ...mods(m), reportsRelease: this.reportsRelease }
  }

  private plain(ch: string, alt: boolean): TermKey[] {
    const m = 1 + (alt ? 2 : 0)
    if (ch === '\r' || ch === '\n') return [this.key('Enter', 'Enter', m)]
    if (ch === '\t') return [this.key('Tab', 'Tab', m)]
    if (ch === '\x7f' || ch === '\b') return [this.key('Backspace', 'Backspace', m)]
    if (ch === '\x1b') return [this.key('Escape', 'Escape', m)]
    if (ch === '\x00') return [this.key(' ', 'Space', m + 4)]
    const code = ch.charCodeAt(0)
    if (code < 0x20) {
      // ctrl + letter
      const letter = String.fromCharCode(code + 96)
      return [this.key(letter, codeFor(letter), m + 4)]
    }
    const upper = ch !== ch.toLowerCase()
    return [this.key(ch, codeFor(ch), m + (upper ? 1 : 0))]
  }

  private csi(prefix: string, params: string, final: string): TermInput | null {
    if (prefix === '<' && (final === 'M' || final === 'm')) {
      const [b, x, y] = params.split(';').map(Number)
      const base = { type: 'mouse' as const, x: x - 1, y: y - 1, shiftKey: !!(b & 4), altKey: !!(b & 8), ctrlKey: !!(b & 16) }
      if (b & 64) {
        const dir = (['up', 'down', 'left', 'right'] as const)[b & 3]
        return { ...base, action: 'wheel', button: 'none', wheel: dir }
      }
      const btn = (['left', 'middle', 'right', 'none'] as const)[b & 3]
      if (b & 32) return { ...base, action: 'move', button: btn }
      return { ...base, action: final === 'M' ? 'down' : 'up', button: btn }
    }
    if (prefix === '?' || prefix === '>') return { type: 'report', data: prefix + params + final }
    const parts = params.split(';')
    const [modStr = '1', evStr = '1'] = (parts[1] ?? '1').split(':')
    const m = parseInt(modStr, 10) || 1
    const evNum = parseInt(evStr, 10) || 1
    if (evNum !== 1) this.reportsRelease = true
    const action: TermKey['action'] = evNum === 3 ? 'up' : evNum === 2 ? 'repeat' : 'down'
    if (final === 'u') {
      const [codeStr, shiftedStr] = parts[0].split(':')
      const cp = parseInt(codeStr, 10)
      const special = KITTY_CODES[cp]
      if (special) return this.key(special[0], special[1], m, action)
      const shifted = shiftedStr ? parseInt(shiftedStr, 10) : NaN
      const md = mods(m)
      let ch = String.fromCodePoint(cp)
      if (md.shiftKey) ch = Number.isFinite(shifted) ? String.fromCodePoint(shifted) : ch.toUpperCase()
      return { type: 'key', key: ch, code: codeFor(String.fromCodePoint(cp)), action, ...md, reportsRelease: this.reportsRelease }
    }
    if (final === '~') {
      const k = CSI_TILDE[parseInt(parts[0], 10)]
      return k ? this.key(k, k, m, action) : null
    }
    if (final === 't') return { type: 'report', data: params + final }
    const k = CSI_LETTER[final]
    if (k) return this.key(k, k === 'Tab' ? 'Tab' : k, final === 'Z' ? 2 : m, action)
    return null
  }
}
