/**
 * Maps a browser KeyboardEvent (in the preview webview) to a vuecli key combo
 * ('enter', 'shift+tab', 'ctrl+s', 'a'). Pure; also injected into the webview
 * via `Function.prototype.toString`, so it must not reference anything outside
 * its own body.
 */
export interface KeyLike {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

export function keyComboFromEvent(e: KeyLike): string | null {
  const NAMES: Record<string, string> = {
    Enter: 'enter', Tab: 'tab', Escape: 'escape', Esc: 'escape', Backspace: 'backspace', Delete: 'delete',
    Insert: 'insert', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', ' ': 'space', Spacebar: 'space',
  }
  const k = e.key
  if (!k || k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock' || k === 'Dead' || k === 'Unidentified') return null
  let name = NAMES[k]
  if (!name && /^F([1-9]|1[0-2])$/.test(k)) name = k.toLowerCase()
  const printable = !name && [...k].length === 1
  if (!name && !printable) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('ctrl')
  if (e.altKey || e.metaKey) mods.push('alt')
  if (printable) {
    // plain or shifted characters are sent as typed ('A', '?')
    if (!mods.length) return k
    return mods.join('+') + '+' + k.toLowerCase()
  }
  if (e.shiftKey) mods.push('shift')
  return mods.length ? mods.join('+') + '+' + name : name
}
