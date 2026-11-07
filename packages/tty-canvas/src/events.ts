/** Browser-shaped DOM events and a small EventTarget implementation (with capture/bubble and `on<type>` handlers). */

export interface EventInit {
  bubbles?: boolean
  cancelable?: boolean
  composed?: boolean
}

export class Event {
  static readonly NONE = 0
  static readonly CAPTURING_PHASE = 1
  static readonly AT_TARGET = 2
  static readonly BUBBLING_PHASE = 3
  readonly type: string
  readonly bubbles: boolean
  readonly cancelable: boolean
  readonly composed: boolean
  readonly timeStamp: number
  readonly isTrusted = false
  target: EventTarget | null = null
  currentTarget: EventTarget | null = null
  eventPhase = 0
  defaultPrevented = false
  /** @internal */ _stop = false
  /** @internal */ _stopImmediate = false
  /** @internal */ _path: EventTarget[] = []

  constructor(type: string, init: EventInit = {}) {
    if (arguments.length === 0) throw new TypeError("Failed to construct 'Event': 1 argument required, but only 0 present.")
    this.type = String(type)
    this.bubbles = !!init.bubbles
    this.cancelable = !!init.cancelable
    this.composed = !!init.composed
    this.timeStamp = typeof performance !== 'undefined' ? performance.now() : Date.now()
  }
  get cancelBubble() { return this._stop }
  set cancelBubble(v: boolean) { if (v) this._stop = true }
  get returnValue() { return !this.defaultPrevented }
  get srcElement() { return this.target }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true }
  stopPropagation() { this._stop = true }
  stopImmediatePropagation() { this._stop = true; this._stopImmediate = true }
  composedPath(): EventTarget[] { return this._path.slice() }
}

export class CustomEvent<T = unknown> extends Event {
  readonly detail: T
  constructor(type: string, init: EventInit & { detail?: T } = {}) {
    super(type, init)
    this.detail = init.detail as T
  }
}

export interface UIEventInit extends EventInit { detail?: number; view?: unknown }
export class UIEvent extends Event {
  readonly detail: number
  readonly view: unknown
  constructor(type: string, init: UIEventInit = {}) {
    super(type, init)
    this.detail = init.detail ?? 0
    this.view = init.view ?? null
  }
}

export interface ModifierInit { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean }

export interface MouseEventInit extends UIEventInit, ModifierInit {
  clientX?: number; clientY?: number; screenX?: number; screenY?: number
  /** Non-standard init: set offsetX/offsetY (otherwise derived from the target's bounding rect). */
  offsetX?: number; offsetY?: number
  movementX?: number; movementY?: number
  button?: number; buttons?: number
  relatedTarget?: EventTarget | null
}

export class MouseEvent extends UIEvent {
  readonly clientX: number; readonly clientY: number
  readonly screenX: number; readonly screenY: number
  readonly movementX: number; readonly movementY: number
  readonly button: number; readonly buttons: number
  readonly ctrlKey: boolean; readonly shiftKey: boolean; readonly altKey: boolean; readonly metaKey: boolean
  readonly relatedTarget: EventTarget | null
  private _ox?: number
  private _oy?: number
  constructor(type: string, init: MouseEventInit = {}) {
    super(type, init)
    this.clientX = init.clientX ?? 0
    this.clientY = init.clientY ?? 0
    this.screenX = init.screenX ?? this.clientX
    this.screenY = init.screenY ?? this.clientY
    this.movementX = init.movementX ?? 0
    this.movementY = init.movementY ?? 0
    this.button = init.button ?? 0
    this.buttons = init.buttons ?? 0
    this.ctrlKey = !!init.ctrlKey
    this.shiftKey = !!init.shiftKey
    this.altKey = !!init.altKey
    this.metaKey = !!init.metaKey
    this.relatedTarget = init.relatedTarget ?? null
    this._ox = init.offsetX
    this._oy = init.offsetY
  }
  get x() { return this.clientX }
  get y() { return this.clientY }
  get pageX() { return this.clientX }
  get pageY() { return this.clientY }
  get layerX() { return this.offsetX }
  get layerY() { return this.offsetY }
  get which() { return this.button + 1 }
  get offsetX(): number {
    if (this._ox !== undefined) return this._ox
    const r = rectOf(this.target)
    return r ? this.clientX - r.left : this.clientX
  }
  get offsetY(): number {
    if (this._oy !== undefined) return this._oy
    const r = rectOf(this.target)
    return r ? this.clientY - r.top : this.clientY
  }
  getModifierState(key: string) {
    return key === 'Control' ? this.ctrlKey : key === 'Shift' ? this.shiftKey : key === 'Alt' ? this.altKey : key === 'Meta' ? this.metaKey : false
  }
}

function rectOf(t: unknown): { left: number; top: number } | null {
  const f = (t as { getBoundingClientRect?: () => { left: number; top: number } } | null)?.getBoundingClientRect
  return typeof f === 'function' ? f.call(t) : null
}

export interface PointerEventInit extends MouseEventInit {
  pointerId?: number; pointerType?: string; isPrimary?: boolean; width?: number; height?: number; pressure?: number
}
export class PointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  readonly isPrimary: boolean
  readonly width: number
  readonly height: number
  readonly pressure: number
  readonly tiltX = 0
  readonly tiltY = 0
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'mouse'
    this.isPrimary = init.isPrimary ?? true
    this.width = init.width ?? 1
    this.height = init.height ?? 1
    this.pressure = init.pressure ?? (init.buttons ? 0.5 : 0)
  }
  getCoalescedEvents() { return [this] }
  getPredictedEvents() { return [] }
}

export interface WheelEventInit extends MouseEventInit { deltaX?: number; deltaY?: number; deltaZ?: number; deltaMode?: number }
export class WheelEvent extends MouseEvent {
  static readonly DOM_DELTA_PIXEL = 0
  static readonly DOM_DELTA_LINE = 1
  static readonly DOM_DELTA_PAGE = 2
  readonly deltaX: number
  readonly deltaY: number
  readonly deltaZ: number
  readonly deltaMode: number
  constructor(type: string, init: WheelEventInit = {}) {
    super(type, init)
    this.deltaX = init.deltaX ?? 0
    this.deltaY = init.deltaY ?? 0
    this.deltaZ = init.deltaZ ?? 0
    this.deltaMode = init.deltaMode ?? 0
  }
  get wheelDelta() { return -this.deltaY * 1.2 }
}

export interface KeyboardEventInit extends UIEventInit, ModifierInit {
  key?: string; code?: string; location?: number; repeat?: boolean; isComposing?: boolean
  keyCode?: number; charCode?: number
}
export class KeyboardEvent extends UIEvent {
  static readonly DOM_KEY_LOCATION_STANDARD = 0
  static readonly DOM_KEY_LOCATION_LEFT = 1
  static readonly DOM_KEY_LOCATION_RIGHT = 2
  static readonly DOM_KEY_LOCATION_NUMPAD = 3
  readonly key: string
  readonly code: string
  readonly location: number
  readonly repeat: boolean
  readonly isComposing: boolean
  readonly ctrlKey: boolean; readonly shiftKey: boolean; readonly altKey: boolean; readonly metaKey: boolean
  readonly keyCode: number
  readonly charCode: number
  constructor(type: string, init: KeyboardEventInit = {}) {
    super(type, init)
    this.key = init.key ?? ''
    this.code = init.code ?? ''
    this.location = init.location ?? 0
    this.repeat = !!init.repeat
    this.isComposing = !!init.isComposing
    this.ctrlKey = !!init.ctrlKey
    this.shiftKey = !!init.shiftKey
    this.altKey = !!init.altKey
    this.metaKey = !!init.metaKey
    this.keyCode = init.keyCode ?? legacyKeyCode(this.key, this.code)
    this.charCode = init.charCode ?? (type === 'keypress' && this.key.length === 1 ? this.key.charCodeAt(0) : 0)
  }
  get which() { return this.keyCode || this.charCode }
  getModifierState(key: string) {
    return key === 'Control' ? this.ctrlKey : key === 'Shift' ? this.shiftKey : key === 'Alt' ? this.altKey : key === 'Meta' ? this.metaKey : false
  }
}

export class FocusEvent extends UIEvent {
  readonly relatedTarget: EventTarget | null
  constructor(type: string, init: UIEventInit & { relatedTarget?: EventTarget | null } = {}) {
    super(type, init)
    this.relatedTarget = init.relatedTarget ?? null
  }
}

const KEYCODES: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Pause: 19, CapsLock: 20, Escape: 27, ' ': 32,
  PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  Insert: 45, Delete: 46, Meta: 91, ';': 186, '=': 187, ',': 188, '-': 189, '.': 190, '/': 191, '`': 192,
  '[': 219, '\\': 220, ']': 221, "'": 222,
}
function legacyKeyCode(key: string, code: string): number {
  if (key in KEYCODES) return KEYCODES[key]
  if (/^F\d{1,2}$/.test(key)) return 111 + +key.slice(1)
  if (key.length === 1) {
    const u = key.toUpperCase().charCodeAt(0)
    if ((u >= 65 && u <= 90) || (u >= 48 && u <= 57)) return u
    const m = /^Digit(\d)$/.exec(code)
    if (m) return 48 + +m[1]
  }
  return 0
}

// ---------------------------------------------------------------- EventTarget

export type EventListener = ((e: any) => unknown) | { handleEvent(e: any): unknown }
export interface AddEventListenerOptions { capture?: boolean; once?: boolean; passive?: boolean; signal?: { aborted: boolean; addEventListener(t: string, f: () => void): void } }

interface Entry {
  fn: EventListener
  capture: boolean
  once: boolean
  passive: boolean
}

export class EventTarget {
  /** @internal */ _listeners: Map<string, Entry[]> = new Map()

  addEventListener(type: string, fn: EventListener | null, options?: boolean | AddEventListenerOptions) {
    if (!fn) return
    const o = typeof options === 'boolean' ? { capture: options } : options ?? {}
    if (o.signal?.aborted) return
    const list = this._listeners.get(type) ?? []
    const capture = !!o.capture
    if (list.some((e) => e.fn === fn && e.capture === capture)) return
    list.push({ fn, capture, once: !!o.once, passive: !!o.passive })
    this._listeners.set(type, list)
    o.signal?.addEventListener('abort', () => this.removeEventListener(type, fn, { capture }))
  }

  removeEventListener(type: string, fn: EventListener | null, options?: boolean | { capture?: boolean }) {
    const list = this._listeners.get(type)
    if (!list || !fn) return
    const capture = typeof options === 'boolean' ? options : !!options?.capture
    const i = list.findIndex((e) => e.fn === fn && e.capture === capture)
    if (i >= 0) list.splice(i, 1)
  }

  /** Parent in the propagation path (overridden by DOM nodes). @internal */
  _eventParent(): EventTarget | null {
    return null
  }

  dispatchEvent(event: Event): boolean {
    const path: EventTarget[] = []
    for (let t: EventTarget | null = this; t; t = t._eventParent()) path.push(t)
    event.target = this
    event._path = path
    event._stop = false
    event._stopImmediate = false
    // capture
    for (let i = path.length - 1; i > 0 && !event._stop; i--) {
      event.eventPhase = Event.CAPTURING_PHASE
      path[i]._invoke(event, true)
    }
    if (!event._stop) {
      event.eventPhase = Event.AT_TARGET
      this._invoke(event, true)
      if (!event._stopImmediate) this._invoke(event, false)
    }
    if (event.bubbles) {
      for (let i = 1; i < path.length && !event._stop; i++) {
        event.eventPhase = Event.BUBBLING_PHASE
        path[i]._invoke(event, false)
      }
    }
    event.eventPhase = 0
    event.currentTarget = null
    return !event.defaultPrevented
  }

  /** @internal */
  _invoke(event: Event, capture: boolean) {
    event.currentTarget = this
    const list = this._listeners.get(event.type)
    if (list?.length) {
      for (const e of list.slice()) {
        if (e.capture !== capture) continue
        if (e.once) this.removeEventListener(event.type, e.fn, { capture: e.capture })
        callListener(e.fn, this, event)
        if (event._stopImmediate) return
      }
    }
    // `on<type>` handler (target and bubble phases)
    if (!capture) {
      const h = (this as unknown as Record<string, unknown>)['on' + event.type]
      if (typeof h === 'function') {
        const r = callListener(h as EventListener, this, event)
        if (r === false) event.preventDefault()
      }
    }
  }
}

function callListener(fn: EventListener, self: unknown, ev: Event): unknown {
  try {
    return typeof fn === 'function' ? fn.call(self, ev) : fn.handleEvent(ev)
  } catch (err) {
    // like browsers: report and continue with the other listeners
    const report = (globalThis as { reportError?: (e: unknown) => void }).reportError
    if (typeof report === 'function') report(err)
    else console.error(err)
    return undefined
  }
}
