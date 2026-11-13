import {
  computed,
  getCurrentInstance,
  inject,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'
import { APP_CONTEXT, type AppContext, type KeyBindingInfo, type KeymapEntry } from './app/context.js'
import { nextFocusId, type FocusEntry } from './app/focus.js'
import type { TElement } from './dom/nodes.js'
import { matchKey, type KeyEvent } from './input/keys.js'
import type { Theme } from './style/theme.js'
import { vursesError } from './errors.js'

export function useAppContext(): AppContext {
  const ctx = inject(APP_CONTEXT, null)
  if (!ctx) throw vursesError('VC001', { name: 'useAppContext' })
  return ctx
}

/** Access app-level controls: exit, theme, size. */
export function useApp() {
  const ctx = useAppContext()
  return {
    exit: ctx.exit,
    theme: computed(() => ctx.theme.value),
    setTheme: ctx.setTheme,
    size: ctx.size,
    requestRender: ctx.requestRender,
    toggleDevtools: () => (ctx.devtools.value = !ctx.devtools.value),
  }
}

/** Reactive terminal size `{ columns, rows }`. */
export function useTerminalSize() {
  return useAppContext().size
}

/** The active theme (reactive). */
export function useTheme(): ComputedRef<Theme> {
  const ctx = useAppContext()
  return computed(() => ctx.theme.value)
}

export interface UseInputOptions {
  /** Only receive events while this is true. */
  isActive?: MaybeRefOrGetter<boolean>
  /** Handlers with higher priority run first. Default 0 (dialogs use 100). */
  priority?: number
}

let handlerOrder = 0

/**
 * Global keyboard handler. Receives every key event that the focused component
 * didn't stop. Call `e.stopPropagation()` to prevent other handlers.
 */
export function useInput(handler: (e: KeyEvent) => void, options: UseInputOptions = {}) {
  const ctx = useAppContext()
  const entry = {
    handler,
    active: () => (options.isActive === undefined ? true : !!toValue(options.isActive)),
    priority: options.priority ?? 0,
    order: ++handlerOrder,
  }
  onMounted(() => ctx.inputHandlers.add(entry))
  onBeforeUnmount(() => ctx.inputHandlers.delete(entry))
}

/** A key binding with metadata (shown by `<KeyHelp>`). */
export interface KeyBinding {
  handler: (e: KeyEvent) => void
  /** Human readable description, e.g. 'Save file'. */
  description?: string
  /** Group heading in `<KeyHelp>`, e.g. 'File'. */
  group?: string
  /** Keep the binding out of `<KeyHelp>`. */
  hidden?: boolean
  /** Only active while this is true. */
  when?: MaybeRefOrGetter<boolean>
}

export type Keymap = Record<string, ((e: KeyEvent) => void) | KeyBinding>

export interface UseKeymapOptions extends UseInputOptions {
  /** Default group for bindings without one. */
  group?: string
}

function bindingOf(v: Keymap[string]): KeyBinding {
  return typeof v === 'function' ? { handler: v } : v
}

/**
 * Declarative key bindings: `useKeymap({ 'ctrl+s': save, 'q|escape': quit })`.
 * Matched keys stop propagation. Bindings can carry metadata for `<KeyHelp>`:
 * `useKeymap({ 'ctrl+s': { handler: save, description: 'Save', group: 'File' } })`.
 */
export function useKeymap(keymap: MaybeRefOrGetter<Keymap>, options: UseKeymapOptions = {}) {
  const ctx = useAppContext()
  const isActive = () => (options.isActive === undefined ? true : !!toValue(options.isActive))
  useInput((e) => {
    const map = toValue(keymap)
    for (const combo in map) {
      const b = bindingOf(map[combo])
      if (b.when !== undefined && !toValue(b.when)) continue
      if (matchKey(e, combo)) {
        e.stopPropagation()
        b.handler(e)
        return
      }
    }
  }, options)
  const entry: KeymapEntry = {
    order: ++handlerOrder,
    priority: options.priority ?? 0,
    active: isActive,
    bindings: () => {
      const map = toValue(keymap)
      const out: KeyBindingInfo[] = []
      for (const combo in map) {
        const b = bindingOf(map[combo])
        if (b.hidden || (b.when !== undefined && !toValue(b.when))) continue
        out.push({ keys: combo, description: b.description, group: b.group ?? options.group })
      }
      return out
    },
  }
  // older contexts (custom runtimes) may not have a registry
  onMounted(() => ctx.keymaps?.add(entry))
  onBeforeUnmount(() => ctx.keymaps?.delete(entry))
}

/** All key bindings currently registered with `useKeymap` (active ones only, reactive). */
export function useKeyBindings(): ComputedRef<KeyBindingInfo[]> {
  const ctx = useAppContext()
  return computed(() => {
    const entries = [...(ctx.keymaps ?? [])].filter((k) => k.active())
    entries.sort((a, b) => b.priority - a.priority || a.order - b.order)
    const seen = new Set<string>()
    const out: KeyBindingInfo[] = []
    for (const en of entries) {
      for (const b of en.bindings()) {
        if (seen.has(b.keys)) continue
        seen.add(b.keys)
        out.push(b)
      }
    }
    return out
  })
}

export interface UseFocusOptions {
  id?: string
  autoFocus?: boolean
  disabled?: MaybeRefOrGetter<boolean | undefined>
  /** Keys delivered while this component is focused (before global handlers). */
  onKey?: (e: KeyEvent) => void
  onFocus?: () => void
  onBlur?: () => void
}

export interface UseFocusReturn {
  /** Template ref: bind to the component's root element (`ref: focus.el`). */
  el: Ref<TElement | null>
  isFocused: Readonly<Ref<boolean>>
  focus(): void
  blur(): void
  id: string
}

/**
 * Makes the current component focusable. Bind `el` to the root element so
 * focus order follows the layout and clicks focus the component.
 */
export function useFocus(options: UseFocusOptions = {}): UseFocusReturn {
  const ctx = useAppContext()
  const el = shallowRef<TElement | null>(null)
  const isFocused = ref(false)
  const id = options.id ?? nextFocusId()
  const entry: FocusEntry = {
    id,
    el: () => resolveEl(el.value),
    isFocused,
    disabled: () => !!toValue(options.disabled),
    autoFocus: !!options.autoFocus,
    onKey: options.onKey,
    onFocus: options.onFocus,
    onBlur: options.onBlur,
  }
  onMounted(() => ctx.focus.register(entry))
  onUnmounted(() => ctx.focus.unregister(entry))
  return {
    el: el as Ref<TElement | null>,
    isFocused,
    focus: () => ctx.focus.focus(entry),
    blur: () => ctx.focus.current.value === entry && ctx.focus.blur(),
    id,
  }
}

function resolveEl(v: unknown): TElement | null {
  if (!v) return null
  if (typeof v === 'object' && v !== null && 'nodeType' in v) return v as TElement
  // component instance ref
  const sub = (v as { $el?: unknown }).$el
  return sub && typeof sub === 'object' && 'nodeType' in (sub as object) ? (sub as TElement) : null
}

/** Programmatic focus control. */
export function useFocusManager() {
  const ctx = useAppContext()
  return {
    focusNext: () => ctx.focus.focusNext(),
    focusPrevious: () => ctx.focus.focusPrevious(),
    focus: (id: string) => ctx.focus.focus(id),
    blur: () => ctx.focus.blur(),
    activeId: computed(() => ctx.focus.activeId.value),
  }
}

/** Runs `fn` every `ms` milliseconds while the component is mounted. */
export function useInterval(fn: () => void, ms: MaybeRefOrGetter<number>) {
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    timer = setInterval(fn, toValue(ms))
  })
  onBeforeUnmount(() => clearInterval(timer))
}

/** Reactive counter that ticks every `ms` (handy for animations). */
export function useTicker(ms = 100) {
  const tick = ref(0)
  useInterval(() => tick.value++, ms)
  return tick
}

/** Captured console output (console.log etc. are redirected while the app runs). */
export function useLogs() {
  return useAppContext().logs
}

/** Frame statistics of the renderer. */
export function useFrameStats() {
  return useAppContext().stats
}

/** Throws if called outside setup(). */
export function assertSetup(name: string) {
  if (!getCurrentInstance()) throw vursesError('VC050', { name })
}
