/**
 * Browser input -> raw terminal sequences.
 *
 * Keys, paste and IME composition reach the app through ONE hidden
 * `<textarea>`: special keys are translated on `keydown` (arrows, enter,
 * ctrl+letter, F-keys, ...), printable text arrives through `input` /
 * `compositionend` (so dead keys and IMEs work), paste becomes a bracketed
 * paste. Clicking the page focuses the textarea.
 *
 * Shared by the browser console target and the frame player. Browser-safe.
 */

export interface KeyLike {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  isComposing?: boolean
}

const CSI = '\x1b['
const LETTER: Record<string, string> = { ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F' }
const TILDE: Record<string, number> = {
  Insert: 2, Delete: 3, PageUp: 5, PageDown: 6,
  F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24,
}
const SS3: Record<string, string> = { F1: 'P', F2: 'Q', F3: 'R', F4: 'S' }

/**
 * Translates a non-text key press into a terminal sequence. Returns null for
 * keys that should travel as text (`input` event) or be ignored.
 */
export function keyToSequence(e: KeyLike): string | null {
  const mod = 1 + (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0)
  const k = e.key
  if (k in LETTER) return mod > 1 ? `${CSI}1;${mod}${LETTER[k]}` : `${CSI}${LETTER[k]}`
  if (k in TILDE) return mod > 1 ? `${CSI}${TILDE[k]};${mod}~` : `${CSI}${TILDE[k]}~`
  if (k in SS3) return mod > 1 ? `${CSI}1;${mod}${SS3[k]}` : `\x1bO${SS3[k]}`
  const alt = e.altKey ? '\x1b' : ''
  switch (k) {
    case 'Enter':
      return alt + '\r'
    case 'Backspace':
      return alt + (e.ctrlKey ? '\b' : '\x7f')
    case 'Tab':
      return e.shiftKey ? `${CSI}Z` : '\t'
    case 'Escape':
      return '\x1b'
  }
  if (k.length === 1 && e.ctrlKey && !e.metaKey) {
    const c = k.toLowerCase().charCodeAt(0)
    if (c >= 97 && c <= 122) return alt + String.fromCharCode(c - 96) // ctrl+a .. ctrl+z
    if (k === ' ' || k === '@') return '\x00'
    if (k === '[') return '\x1b'
    if (k === '\\') return '\x1c'
    if (k === ']') return '\x1d'
  }
  if (k.length === 1 && e.altKey && !e.ctrlKey && !e.metaKey) return '\x1b' + k
  return null
}

/** SGR mouse report for a cell (0-based). `button`: 0 left, 1 middle, 2 right. */
export function mouseSequence(action: 'down' | 'up' | 'move' | 'drag' | 'wheel-up' | 'wheel-down', x: number, y: number, button = 0, mods: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {}): string {
  let b = action === 'wheel-up' ? 64 : action === 'wheel-down' ? 65 : action === 'move' ? 35 : button
  if (action === 'drag') b = button + 32
  if (mods.shift) b += 4
  if (mods.alt) b += 8
  if (mods.ctrl) b += 16
  return `${CSI}<${b};${x + 1};${y + 1}${action === 'up' ? 'm' : 'M'}`
}

export interface HiddenInputOptions {
  /** Receives raw terminal input. */
  onData(data: string): void
  /** Document to attach to. Default: `globalThis.document`. */
  document?: Document
  /** Element whose clicks focus the textarea. Default: the document. */
  focusTarget?: EventTarget
  /** Called for each key press before translation; return true to swallow it. */
  intercept?(e: KeyboardEvent): boolean
}

/**
 * Creates the hidden `<textarea>` that captures keys, paste and IME input.
 * Returns a cleanup function.
 */
export function attachHiddenInput(options: HiddenInputOptions): { textarea: HTMLTextAreaElement; focus(): void; dispose(): void } {
  const doc = options.document ?? (globalThis as any).document as Document
  const ta = doc.createElement('textarea')
  ta.setAttribute('aria-label', 'vuecli keyboard input')
  ta.setAttribute('autocapitalize', 'off')
  ta.setAttribute('autocomplete', 'off')
  ta.setAttribute('spellcheck', 'false')
  ta.dataset.vuecliInput = ''
  // invisible but focusable (display:none would not receive keys)
  ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;resize:none;overflow:hidden;z-index:-1'
  doc.body.appendChild(ta)
  let composing = false
  const send = (s: string) => {
    if (s) options.onData(s)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (options.intercept?.(e)) return
    if (composing || e.isComposing || e.key === 'Process' || e.key === 'Dead') return
    // let the browser handle copy (ctrl/cmd+c with a selection) and paste shortcuts
    if ((e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V')) return
    if (e.metaKey) return
    const seq = keyToSequence(e)
    if (seq !== null) {
      e.preventDefault()
      send(seq)
    }
  }
  const onInput = () => {
    if (composing) return
    const v = ta.value
    ta.value = ''
    send(v.replace(/\n/g, '\r'))
  }
  const onCompStart = () => (composing = true)
  const onCompEnd = (e: CompositionEvent) => {
    composing = false
    ta.value = ''
    send(e.data)
  }
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text/plain') ?? ''
    e.preventDefault()
    if (text) send('\x1b[200~' + text + '\x1b[201~')
  }
  const focus = () => ta.focus({ preventScroll: true })
  const target = options.focusTarget ?? doc
  ta.addEventListener('keydown', onKeyDown)
  ta.addEventListener('input', onInput)
  ta.addEventListener('compositionstart', onCompStart)
  ta.addEventListener('compositionend', onCompEnd as EventListener)
  ta.addEventListener('paste', onPaste as EventListener)
  target.addEventListener('click', focus)
  focus()
  return {
    textarea: ta,
    focus,
    dispose() {
      ta.removeEventListener('keydown', onKeyDown)
      ta.removeEventListener('input', onInput)
      ta.removeEventListener('compositionstart', onCompStart)
      ta.removeEventListener('compositionend', onCompEnd as EventListener)
      ta.removeEventListener('paste', onPaste as EventListener)
      target.removeEventListener('click', focus)
      ta.remove()
    },
  }
}
