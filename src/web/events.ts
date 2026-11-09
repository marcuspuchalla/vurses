/**
 * DOM-shaped events for web apps running in the terminal.
 *
 * Vue templates bind `@click`, `@keyup.enter`, `@submit.prevent`, ... as
 * `onClick` / `onKeyup` / `onSubmit` props; runtime helpers (`withKeys`,
 * `withModifiers`) and libraries (vue-router's RouterLink) inspect the event
 * object, so it has to look like a DOM event.
 */
import type { TElement } from '../dom/nodes.js'
import type { KeyEvent } from '../input/keys.js'

export interface WebEvent {
  type: string
  target: TElement
  currentTarget: TElement | null
  bubbles: boolean
  defaultPrevented: boolean
  propagationStopped: boolean
  timeStamp: number
  isTrusted: boolean
  // keyboard
  key?: string
  code?: string
  keyCode?: number
  repeat?: boolean
  isComposing?: boolean
  // mouse / modifiers
  button?: number
  buttons?: number
  detail?: number
  clientX?: number
  clientY?: number
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  // input
  data?: string | null
  inputType?: string
  preventDefault(): void
  stopPropagation(): void
  stopImmediatePropagation(): void
  composedPath(): TElement[]
  getModifierState(k: string): boolean
}

export function createEvent(type: string, target: TElement, init: Partial<WebEvent> = {}): WebEvent {
  const ev: WebEvent = {
    type,
    target,
    currentTarget: null,
    bubbles: !['focus', 'blur', 'mouseenter', 'mouseleave', 'load', 'scroll'].includes(type),
    defaultPrevented: false,
    propagationStopped: false,
    timeStamp: performance.now(),
    isTrusted: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    preventDefault() {
      ev.defaultPrevented = true
    },
    stopPropagation() {
      ev.propagationStopped = true
    },
    stopImmediatePropagation() {
      ev.propagationStopped = true
    },
    composedPath() {
      const path: TElement[] = []
      for (let n: TElement | null = target; n; n = n.parent) path.push(n)
      return path
    },
    getModifierState(k: string) {
      return (k === 'Control' && ev.ctrlKey) || (k === 'Shift' && ev.shiftKey) || (k === 'Alt' && ev.altKey) || (k === 'Meta' && ev.metaKey)
    },
    ...init,
  }
  return ev
}

const NAMED_KEYS: Record<string, [string, number]> = {
  enter: ['Enter', 13], return: ['Enter', 13], escape: ['Escape', 27], tab: ['Tab', 9], backspace: ['Backspace', 8],
  delete: ['Delete', 46], space: [' ', 32], up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37],
  right: ['ArrowRight', 39], home: ['Home', 36], end: ['End', 35], pageup: ['PageUp', 33], pagedown: ['PageDown', 34],
  insert: ['Insert', 45],
}

/** Terminal key → DOM `key` / `keyCode` / modifiers. */
export function domKey(e: KeyEvent): Partial<WebEvent> {
  let key: string
  let keyCode = 0
  const named = NAMED_KEYS[e.name]
  if (named) [key, keyCode] = named
  else if (/^f\d+$/.test(e.name)) {
    key = e.name.toUpperCase()
    keyCode = 111 + parseInt(e.name.slice(1), 10)
  } else {
    key = e.char || e.name
    keyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0
  }
  return {
    key,
    code: key.length === 1 ? (/[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : /\d/.test(key) ? `Digit${key}` : key) : key,
    keyCode,
    ctrlKey: e.ctrl,
    shiftKey: e.shift,
    altKey: e.meta,
    metaKey: false,
    repeat: false,
    isComposing: false,
  }
}

/** Listener props for a DOM event type: `onClick`, `onClickOnce`, `onClickCapture`, ... */
function listenersOf(el: TElement, type: string): ((e: unknown) => unknown)[] {
  const base = 'on' + type[0].toUpperCase() + type.slice(1)
  const out: ((e: unknown) => unknown)[] = []
  for (const key in el.props) {
    if (key !== base && !(key.startsWith(base) && /^(Once|Passive|Capture)+$/.test(key.slice(base.length)))) continue
    const h = el.props[key]
    if (Array.isArray(h)) out.push(...h)
    else if (typeof h === 'function') out.push(h)
  }
  const extra = (el as unknown as { __listeners?: Map<string, Set<(e: unknown) => unknown>> }).__listeners?.get(type)
  if (extra) out.push(...extra)
  return out
}

export function hasListener(el: TElement, type: string) {
  return listenersOf(el, type).length > 0
}

/** Bubbles `ev` from its target to the root; returns false if a listener prevented the default. */
export function dispatch(ev: WebEvent, onError?: (e: unknown) => void): boolean {
  for (let n: TElement | null = ev.target; n; n = n.parent) {
    const ls = listenersOf(n, ev.type)
    if (ls.length) {
      ev.currentTarget = n
      for (const l of ls) {
        try {
          const r = l(ev)
          if (r instanceof Promise) r.catch((e) => onError?.(e))
        } catch (e) {
          onError?.(e)
        }
      }
    }
    if (ev.propagationStopped || !ev.bubbles) break
  }
  ev.currentTarget = null
  return !ev.defaultPrevented
}
