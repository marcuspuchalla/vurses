import { shallowRef, ref, type Ref } from 'vue'
import type { TElement } from '../dom/nodes.js'
import type { KeyEvent } from '../input/keys.js'

export interface FocusEntry {
  id: string
  el: () => TElement | null
  isFocused: Ref<boolean>
  disabled: () => boolean
  autoFocus: boolean
  onKey?: (e: KeyEvent) => void
  onFocus?: () => void
  onBlur?: () => void
}

let uid = 0
export function nextFocusId() {
  return `focus-${++uid}`
}

export class FocusManager {
  readonly entries = new Set<FocusEntry>()
  readonly current = shallowRef<FocusEntry | null>(null)
  /** Stack of focus traps (e.g. open dialogs). Focus can't leave the top trap. */
  private traps: (() => TElement | null)[] = []
  /** Reactive id of the focused entry. */
  readonly activeId = ref<string | null>(null)

  constructor(private root: () => TElement | null) {}

  register(entry: FocusEntry) {
    this.entries.add(entry)
    if (entry.autoFocus) queueMicrotask(() => this.entries.has(entry) && this.focus(entry))
    return () => this.unregister(entry)
  }

  unregister(entry: FocusEntry) {
    this.entries.delete(entry)
    if (this.current.value === entry) {
      this.setCurrent(null)
      queueMicrotask(() => {
        if (!this.current.value) this.focusFirst()
      })
    }
  }

  pushTrap(el: () => TElement | null) {
    this.traps.push(el)
    queueMicrotask(() => {
      const cur = this.current.value
      if (!cur || !this.inTrap(cur)) this.focusFirst()
    })
    return () => {
      const i = this.traps.indexOf(el)
      if (i >= 0) this.traps.splice(i, 1)
      queueMicrotask(() => {
        const cur = this.current.value
        if (!cur || !this.isEligible(cur)) this.focusFirst()
      })
    }
  }

  private inTrap(e: FocusEntry) {
    const trap = this.traps[this.traps.length - 1]?.()
    if (!trap) return true
    const el = e.el()
    return !!el && trap.contains(el)
  }

  private isVisible(el: TElement) {
    let n: TElement | null = el
    while (n) {
      if (n.computedStyle.display === 'none') return false
      n = n.parent
    }
    return true
  }

  isEligible(e: FocusEntry) {
    if (!this.entries.has(e) || e.disabled()) return false
    const el = e.el()
    const root = this.root()
    if (!el || !root || !root.contains(el)) return false
    return this.isVisible(el) && this.inTrap(e)
  }

  /** Focusable entries in document order. */
  ordered(): FocusEntry[] {
    const root = this.root()
    if (!root) return []
    const order = new Map<TElement, number>()
    let i = 0
    for (const el of root.walk()) order.set(el, i++)
    return [...this.entries]
      .filter((e) => this.isEligible(e))
      .sort((a, b) => (order.get(a.el()!) ?? 0) - (order.get(b.el()!) ?? 0))
  }

  private setCurrent(entry: FocusEntry | null) {
    const prev = this.current.value
    if (prev === entry) return
    if (prev) {
      prev.isFocused.value = false
      prev.onBlur?.()
    }
    this.current.value = entry
    this.activeId.value = entry?.id ?? null
    if (entry) {
      entry.isFocused.value = true
      entry.onFocus?.()
    }
  }

  focus(entry: FocusEntry | string | null) {
    if (typeof entry === 'string') entry = [...this.entries].find((e) => e.id === entry) ?? null
    if (entry && !this.isEligible(entry)) return false
    this.setCurrent(entry)
    return true
  }

  blur() {
    this.setCurrent(null)
  }

  focusFirst() {
    const list = this.ordered()
    this.setCurrent(list[0] ?? null)
  }

  focusNext() {
    this.move(1)
  }

  focusPrevious() {
    this.move(-1)
  }

  private move(dir: 1 | -1) {
    const list = this.ordered()
    if (!list.length) return
    const cur = this.current.value
    const i = cur ? list.indexOf(cur) : -1
    const next = i < 0 ? (dir === 1 ? 0 : list.length - 1) : (i + dir + list.length) % list.length
    this.setCurrent(list[next])
  }

  /** Focus entry owning `el` or one of its ancestors. */
  entryFor(el: TElement | null): FocusEntry | null {
    const byEl = new Map<TElement, FocusEntry>()
    for (const e of this.entries) {
      const x = e.el()
      if (x) byEl.set(x, e)
    }
    let n = el
    while (n) {
      const e = byEl.get(n)
      if (e) return e
      n = n.parent
    }
    return null
  }

  dispatchKey(e: KeyEvent) {
    const cur = this.current.value
    if (cur && this.entries.has(cur) && !cur.disabled()) cur.onKey?.(e)
  }
}
