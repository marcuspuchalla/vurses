/**
 * DOM event classes for web apps: `new KeyboardEvent('keydown', { key: 'a' })` works, and
 * the events vuecli dispatches are instances of the right class, so library checks such as
 * `e instanceof InputEvent` (Naive UI) or `e instanceof MouseEvent` pass.
 *
 * They extend Node's own `Event`; extra init fields become plain properties.
 */
const BaseEvent: typeof Event = (globalThis as { Event?: typeof Event }).Event ?? (class {} as unknown as typeof Event)

function withInit<T extends Event>(ev: T, init: object | undefined): T {
  if (!init) return ev
  for (const [k, v] of Object.entries(init)) {
    if (k === 'bubbles' || k === 'cancelable' || k === 'composed') continue // handled by Event
    try {
      Object.defineProperty(ev, k, { value: v, writable: true, enumerable: true, configurable: true })
    } catch {
      /* ignore */
    }
  }
  return ev
}

export class UIEvent extends BaseEvent {
  constructor(type: string, init?: EventInit & Record<string, unknown>) {
    super(type, init)
    withInit(this, init)
  }
}
export class MouseEvent extends UIEvent {}
export class PointerEvent extends MouseEvent {}
export class WheelEvent extends MouseEvent {}
export class KeyboardEvent extends UIEvent {}
export class InputEvent extends UIEvent {}
export class FocusEvent extends UIEvent {}
export class CompositionEvent extends UIEvent {}
export class StorageEvent extends BaseEvent {
  constructor(type: string, init?: EventInit & Record<string, unknown>) {
    super(type, init)
    withInit(this, init)
  }
}

export const EVENT_CLASSES = { UIEvent, MouseEvent, PointerEvent, WheelEvent, KeyboardEvent, InputEvent, FocusEvent, CompositionEvent, StorageEvent }

/** The class a browser would use for an event of this type. */
export function eventClassFor(type: string): { prototype: Event } {
  if (type.startsWith('key')) return KeyboardEvent
  if (type === 'input' || type === 'beforeinput') return InputEvent
  if (type.startsWith('pointer')) return PointerEvent
  if (type === 'wheel') return WheelEvent
  if (type === 'click' || type === 'dblclick' || type === 'contextmenu' || type.startsWith('mouse')) return MouseEvent
  if (type === 'focus' || type === 'blur' || type === 'focusin' || type === 'focusout') return FocusEvent
  if (type.startsWith('composition')) return CompositionEvent
  return BaseEvent
}
