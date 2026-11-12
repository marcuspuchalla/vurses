/**
 * The web scope: makes a subtree of terminal elements behave like an HTML page.
 *
 * - styles come from real CSS (author stylesheets + a user-agent sheet)
 * - block / inline flow: a block whose children are all inline becomes one
 *   wrapped text block; inline elements (a, strong, button, input, ...) flow
 *   inside it
 * - form controls and links are focusable and keyboard operable, and emit
 *   DOM-shaped events (`click`, `input`, `change`, `keyup`, `submit`, ...)
 * - elements get a small DOM facade (`value`, `checked`, `focus()`,
 *   `classList`, `getAttribute`, `addEventListener`, ...) for app code
 */
import { parseHTML } from './html.js'
import { ref, type Ref } from 'vue'
import { TComment, TElement, TTextNode, type StyleScope, type TNode } from '../dom/nodes.js'
import type { FocusEntry, FocusManager } from '../app/focus.js'
import { nextFocusId } from '../app/focus.js'
import type { KeyEvent, MouseEvent } from '../input/keys.js'
import { matchKey } from '../input/keys.js'
import type { Ink, Segment, Style } from '../style/style.js'
import { graphemeWidth } from '../render/text.js'
import { RuleIndex, StyleSheet, matches, parseSelectorList, splitTop, type MatchTarget, type MediaEnv, type Rule, type Declaration } from './css.js'
import { UA_CSS, cascade, computeStyle, isInlineDisplay, pseudoContent, pseudoInk, type WebStyle } from './cascade.js'
import { createEvent, dispatch, domKey, hasListener, type WebEvent } from './events.js'

// ------------------------------------------------------------------ control state

type ControlKind = 'text' | 'textarea' | 'checkbox' | 'radio' | 'select' | 'button' | 'link' | 'label' | 'summary' | 'clickable' | 'range'

interface Model {
  assign: ((v: unknown) => void) | null
  value: unknown
  mods: { lazy?: boolean; trim?: boolean; number?: boolean }
  kind: 'text' | 'checkbox' | 'radio' | 'select' | 'dynamic'
}

export interface ControlState {
  value: string
  cursor: number
  checked: boolean
  selectedIndex: number
  focused: boolean
  /** value changed since focus (fires `change` on blur) */
  dirty: boolean
  entry: FocusEntry | null
  model: Model | null
  /** extra listeners from addEventListener */
}

const states = new WeakMap<TElement, ControlState>()

export function controlState(el: TElement): ControlState {
  let s = states.get(el)
  if (!s) {
    s = { value: '', cursor: 0, checked: false, selectedIndex: -1, focused: false, dirty: false, entry: null, model: null }
    const v = el.props.value
    if (v !== undefined && v !== null && el.tag !== 'select') s.value = String(v)
    s.cursor = s.value.length
    if (el.props.checked !== undefined) s.checked = isTrue(el.props.checked)
    states.set(el, s)
  }
  return s
}

const isTrue = (v: unknown) => v === '' || v === true || v === 'true' || v === 'checked'

function inputType(el: TElement): string {
  return String(el.props.type ?? 'text').toLowerCase()
}

const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'color'])

export function controlKind(el: TElement): ControlKind | null {
  switch (el.tag) {
    case 'input': {
      const t = inputType(el)
      if (t === 'hidden') return null
      if (t === 'checkbox') return 'checkbox'
      if (t === 'radio') return 'radio'
      if (t === 'range') return 'range'
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button'
      return 'text'
    }
    case 'textarea':
      return 'textarea'
    case 'select':
      return 'select'
    case 'button':
      return 'button'
    case 'a':
      return el.props.href !== undefined || hasListener(el, 'click') ? 'link' : null
    case 'summary':
      return 'summary'
    case 'label':
      return el.props.for !== undefined || el.props.htmlFor !== undefined || hasListener(el, 'click') || hasListener(el, 'dblclick') ? 'label' : null
  }
  return null
}

function options(select: TElement): TElement[] {
  const out: TElement[] = []
  const walk = (n: TElement) => {
    for (const c of n.children) {
      if (c.nodeType !== 'element') continue
      if (c.tag === 'option') out.push(c)
      else if (c.tag === 'optgroup') walk(c)
    }
  }
  walk(select)
  return out
}

function optionValue(o: TElement): unknown {
  const v = (o as unknown as { _value?: unknown })._value ?? o.props.value
  return v !== undefined ? v : o.textContent.trim()
}

function selectedIndexOf(select: TElement, st: ControlState): number {
  const opts = options(select)
  if (st.selectedIndex >= 0 && st.selectedIndex < opts.length) return st.selectedIndex
  const i = opts.findIndex((o) => o.props.selected !== undefined && o.props.selected !== false)
  return i >= 0 ? i : opts.length ? 0 : -1
}

const looseEqual = (a: unknown, b: unknown) => a === b || String(a) === String(b)

// ------------------------------------------------------------------ the scope

export interface WebScopeOptions {
  /** Author stylesheet. */
  sheet: StyleSheet
  focus: FocusManager
  /** Terminal size in cells. */
  size(): { columns: number; rows: number }
  dark: boolean
  requestRender(): void
  /** Navigation request for a plain `<a href>` (not handled by the app). */
  navigate?(href: string, el: TElement): void
  onError?(e: unknown): void
}

/** Wraps a terminal element for the selector matcher. */
class Target implements MatchTarget {
  constructor(
    readonly el: TElement,
    private scope: WebScope,
  ) {}
  get tag() {
    return this.el.tag
  }
  id() {
    const v = this.el.props.id
    return v === undefined ? undefined : String(v)
  }
  hasClass(c: string) {
    return this.scope.classesOf(this.el).includes(c)
  }
  attr(name: string) {
    const v = this.el.props[name]
    if (v === undefined || v === null || v === false) return undefined
    if (name === 'value' && (this.el.tag === 'input' || this.el.tag === 'textarea')) return controlState(this.el).value
    return v === true ? '' : String(v)
  }
  parent() {
    const p = this.el.parent
    return p && p !== this.scope.root ? this.scope.target(p) : null
  }
  prevSibling() {
    const p = this.el.parent
    if (!p) return null
    const i = p.children.indexOf(this.el)
    for (let k = i - 1; k >= 0; k--) {
      const c = p.children[k]
      if (c.nodeType === 'element') return this.scope.target(c)
    }
    return null
  }
  siblings() {
    const p = this.el.parent
    if (!p) return [this]
    return p.children.filter((c): c is TElement => c.nodeType === 'element').map((c) => this.scope.target(c))
  }
  isEmpty() {
    return this.el.children.every((c) => c.nodeType === 'comment')
  }
  state(name: 'hover' | 'focus' | 'focus-within' | 'checked' | 'active') {
    const f = this.scope.focusedElement()
    switch (name) {
      case 'focus':
        return f === this.el
      case 'focus-within':
        return !!f && this.el.contains(f)
      case 'hover':
        // keyboard users "hover" what they focus; mouse hover is tracked too
        return (!!f && this.el.contains(f)) || this.scope.isHovered(this.el)
      case 'checked': {
        const k = controlKind(this.el)
        if (k === 'checkbox' || k === 'radio') return controlState(this.el).checked
        if (this.el.tag === 'option') {
          const sel = this.el.parent?.tag === 'select' ? this.el.parent : this.el.parent?.parent
          if (sel) return options(sel)[selectedIndexOf(sel, controlState(sel))] === this.el
        }
        return false
      }
      default:
        return false
    }
  }
  same(o: MatchTarget) {
    return (o as Target).el === this.el
  }
}

export class WebScope implements StyleScope {
  readonly root: TElement
  private ua: RuleIndex
  private uaRules: Rule[]
  private index: RuleIndex | null = null
  private indexEnv = ''
  private targets = new WeakMap<TElement, Target>()
  private classCache = new WeakMap<TElement, { src: unknown; list: string[] }>()
  private dirty = new Set<TElement>()
  private restyleAll = false
  private flushing = false
  private hovered: TElement[] = []
  private hasStatePseudo: boolean
  private lastClick: { el: TElement; at: number } | null = null
  private downTarget: TElement | null = null
  readonly canvas: { bg?: string; color?: string } = {}

  constructor(
    root: TElement,
    readonly opts: WebScopeOptions,
  ) {
    this.root = root
    const ua = new StyleSheet(UA_CSS)
    this.uaRules = ua.rules
    this.ua = new RuleIndex(ua.rules)
    this.hasStatePseudo = true
    root.scope = this
  }

  // ---------------------------------------------------------------- helpers

  target(el: TElement): Target {
    let t = this.targets.get(el)
    if (!t) this.targets.set(el, (t = new Target(el, this)))
    return t
  }

  classesOf(el: TElement): string[] {
    const src = el.props.class
    const c = this.classCache.get(el)
    if (c && c.src === src) return c.list
    const list = src ? String(src).split(/\s+/).filter(Boolean) : []
    this.classCache.set(el, { src, list })
    return list
  }

  focusedElement(): TElement | null {
    return (this.opts.focus.current.value?.el() as TElement | null) ?? null
  }

  isHovered(el: TElement) {
    return this.hovered.includes(el)
  }

  inScope(n: TElement | null): boolean {
    for (let p = n; p; p = p.parent) if (p === this.root) return true
    return false
  }

  /**
   * The color scheme the page is painted in: dark only when the terminal theme is dark AND
   * the site has dark styles (otherwise it is shown on white, like a browser would).
   * `matchMedia('(prefers-color-scheme: dark)')` reports the same, so class-based dark
   * modes (useDark, Tailwind `dark:`) agree with the canvas.
   */
  get prefersDark(): boolean {
    return this.opts.dark && this.opts.sheet.supportsDark
  }

  get env(): MediaEnv & { columns: number; rows: number } {
    const { columns, rows } = this.opts.size()
    return { width: columns * 8, height: rows * 16, dark: this.opts.dark, columns, rows }
  }

  private rules(): RuleIndex {
    const env = this.env
    const key = `${env.width}x${env.height}:${env.dark}`
    if (!this.index || key !== this.indexEnv) {
      const runtime = this.runtimeSheet ? this.runtimeSheet.activeRules(env) : []
      this.index = new RuleIndex([...this.opts.sheet.activeRules(env), ...runtime])
      this.indexEnv = key
    }
    return this.index
  }

  /** <style> elements in the page (added at runtime by component libraries, useStyleTag, ...). */
  private styleEls = new Set<TElement>()
  private runtimeSheet: StyleSheet | null = null
  private runtimeCss = ''

  /** Rebuilds the runtime sheet when a <style> element was added, removed or changed. */
  private syncRuntimeStyles() {
    let css = ''
    for (const el of this.styleEls) if (el.computedStyle !== undefined && el.parent) css += el.textContent + '\n'
    if (css === this.runtimeCss) return
    this.runtimeCss = css
    // ordered after the app's own CSS, like a <style> appended to <head>
    this.runtimeSheet = css.trim() ? new StyleSheet(css, 1e9) : null
    this.index = null
    this.restyleAll = true
  }

  // ---------------------------------------------------------------- StyleScope

  style(el: TElement): Style {
    const parent = el.parent && el.parent !== this.root ? (el.parent.computedStyle as WebStyle) : null
    const t = this.target(el)
    const classes = this.classesOf(el)
    const author = this.rules().match(t, classes)
    const ua = this.ua.match(t, classes)
    const main = author.filter((r) => !r.selector.pseudoElement)
    const inline = inlineDecls(el.props.style)
    // `el.style.x = ...` / `style.setProperty()` win over the style attribute, like a browser's CSSOM
    if (el.styleOverrides?.size) for (const [prop, value] of el.styleOverrides) inline.push({ prop, value, important: false })
    const parentVars = parent?.vars ?? this.rootVars()
    const { values, vars } = cascade(main, ua.filter((r) => !r.selector.pseudoElement), inline, parentVars)
    const env = this.env
    const ws = computeStyle(values, vars, parent, env, el.tag)

    // ::before / ::after content
    for (const which of ['before', 'after'] as const) {
      const pr = author.filter((r) => r.selector.pseudoElement === which)
      if (!pr.length) continue
      const pv = cascade(pr, [], [], vars).values
      const text = pseudoContent(pv, (n) => t.attr(n))
      if (text) ws[which] = [{ text, ink: pseudoInk(pv) }]
    }

    // grid children: equal columns
    if (parent?.gridCols && parent.gridCols > 1 && ws.width === undefined) {
      ws.flexBasis = `${100 / parent.gridCols}%`
      ws.flexGrow = 0
      ws.flexShrink = 1
      if (parent.gridGap) ws.paddingRight = Math.max(ws.paddingRight ?? 0, parent.gridGap)
    }
    // list markers
    if (ws.cssDisplay === 'list-item' && ws.listStyle !== 'none' && ws.display !== 'none') {
      const marker = listMarker(el, ws.listStyle)
      if (marker) {
        ws.marker = marker
        ws.paddingLeft = Math.max(ws.paddingLeft ?? 0, [...marker].reduce((w, ch) => w + graphemeWidth(ch), 0))
      }
    }
    if (el.tag === 'option' || el.tag === 'optgroup') ws.display = 'none'
    // icon fonts draw private-use glyphs: show a terminal symbol instead
    if (!ws.content && !ws.before && !el.children.length) {
      const icon = iconGlyph(classes)
      if (icon) ws.content = [{ text: icon }]
    }
    // adjacent vertical margins collapse (the larger one wins), like CSS
    if (ws.marginTop && !isInlineDisplay(ws.cssDisplay) && ws.position !== 'absolute' && parent?.flexDirection === 'column') {
      const prev = prevElement(el)
      if (prev) {
        const ps = prev.computedStyle as WebStyle
        if (ps.display !== 'none' && !isInlineDisplay(ps.cssDisplay)) ws.marginTop = Math.max(0, ws.marginTop - (ps.marginBottom ?? 0))
      }
    }
    // readable text: fix colors that vanish on the effective background
    ws.effBg = ws.bg ?? parent?.effBg ?? this.canvas.bg ?? (this.opts.dark ? '#1e1e1e' : '#ffffff')
    if (ws.color?.startsWith('#') && ws.effBg.startsWith('#') && contrast(ws.color, ws.effBg) < 1.6) ws.color = luminance(ws.effBg) > 0.4 ? '#202020' : '#e6e6e6'
    if (ws.hideText) {
      // font-size: 0 hides text but keeps ::before / ::after
      const segs = [...toSegments(ws.before), ...toSegments(ws.after)]
      ws.content = segs
      delete ws.before
      delete ws.after
    }
    this.decorateControl(el, ws)
    // children of flex / grid containers are blockified into separate items
    const pd = parent?.cssDisplay
    const flexItem = pd === 'flex' || pd === 'inline-flex' || pd === 'grid' || pd === 'inline-grid'
    ws.inline = isInlineDisplay(ws.cssDisplay) && ws.position !== 'absolute' && !flexItem
    ws.inlineBlock = ws.inline && ws.cssDisplay !== 'inline'
    return ws
  }

  /** Custom properties of the page root (`:root`, `html`). */
  private rootVars(): Map<string, string> {
    return new Map()
  }

  attached(node: TNode) {
    if (node.nodeType === 'text') {
      if (node.parent) this.dirty.add(node.parent)
      return
    }
    if (node.nodeType !== 'element') return
    for (const el of node.walk()) {
      if (el.tag === 'style') this.styleEls.add(el)
      this.dirty.add(el)
      ;(el as unknown as { _style: unknown })._style = null
      this.setupElement(el)
    }
    if (node.parent) this.dirty.add(node.parent)
  }

  detached(node: TNode) {
    if (node.nodeType !== 'element') return
    for (const el of node.walk()) {
      this.styleEls.delete(el)
      const st = states.get(el)
      if (st?.entry) {
        this.opts.focus.unregister(st.entry)
        st.entry = null
      }
      this.hovered = this.hovered.filter((h) => h !== el)
      this.dirty.delete(el)
    }
  }

  changed(el: TElement) {
    if (this.flushing) return
    this.dirty.add(el)
  }

  propChanged(el: TElement, key: string, value: unknown) {
    if (key === 'style:override') {
      this.restyleAll = true
      return
    }
    if (key === 'class' || key === 'id' || (key.startsWith('data-') && !key.startsWith('data-v-')) || key === 'open' || key === 'disabled' || key === 'hidden' || key === 'type') {
      // descendant / sibling selectors may depend on it
      this.restyleAll = true
    }
    const st = states.get(el)
    if (key === 'value' && el.tag !== 'select' && el.tag !== 'option') {
      const s = st ?? controlState(el)
      const v = value === undefined || value === null ? '' : String(value)
      if (v !== s.value) {
        s.value = v
        s.cursor = Math.min(s.cursor, v.length)
        if (!s.focused) s.cursor = v.length
      }
    } else if (key === 'checked') {
      controlState(el).checked = isTrue(value)
    } else if (key === 'selected' && el.tag === 'option' && isTrue(value)) {
      const sel = el.parent?.tag === 'select' ? el.parent : el.parent?.parent
      if (sel) controlState(sel).selectedIndex = options(sel).indexOf(el)
    }
    if (/^on[A-Z]/.test(key) && this.inScope(el)) this.ensureEntry(el)
    if (key === 'href' && this.inScope(el)) this.ensureEntry(el)
  }

  /** Before layout: re-resolve styles if needed and update block/inline flow. */
  flush() {
    this.flushing = true
    try {
      if (this.styleEls.size || this.runtimeSheet) this.syncRuntimeStyles()
      if (this.restyleAll) {
        this.restyleAll = false
        for (const el of this.root.walk()) {
          if (el === this.root) continue
          el.invalidateStyle()
          this.dirty.add(el)
        }
      }
      if (!this.dirty.size) return
      // include ancestors (their flow depends on children), deepest first
      const set = new Set<TElement>()
      for (const el of this.dirty) for (let n: TElement | null = el; n && n !== this.root; n = n.parent) set.add(n)
      this.dirty.clear()
      const depth = (n: TElement) => {
        let d = 0
        for (let p = n.parent; p; p = p.parent) d++
        return d
      }
      const list = [...set].filter((el) => this.inScope(el)).sort((a, b) => depth(b) - depth(a))
      for (const el of list) el.setKind(this.flowKind(el))
      const bg = this.pageCanvas()
      if (bg !== this.canvas.bg) {
        this.canvas.bg = bg
        this.canvas.color = bg && luminance(bg) > 0.4 ? '#202020' : undefined
        this.root.setProp('bg', bg)
        this.root.setProp('color', this.canvas.color)
        this.restyleAll = true
        this.opts.requestRender()
      }
    } finally {
      this.flushing = false
    }
  }

  /** Background of the page: html, then body (like browsers). */
  private pageCanvas(): string | undefined {
    const html = this.root.children.find((c): c is TElement => c.nodeType === 'element' && c.tag === 'html')
    if (!html) return undefined
    const body = html.children.find((c): c is TElement => c.nodeType === 'element' && c.tag === 'body')
    const declared = html.computedStyle.bg ?? body?.computedStyle.bg
    if (declared) return declared
    // a site without dark-mode styles is designed for the browser's white page
    if (!this.opts.dark || !this.opts.sheet.supportsDark) return '#ffffff'
    return undefined
  }

  private isInlineLevel(n: TNode): boolean {
    if (n.nodeType !== 'element') return true
    const s = n.computedStyle as WebStyle
    if (s.display === 'none') return true
    return !!s.inline && n.kind === 'text'
  }

  private flowKind(el: TElement): 'box' | 'text' {
    const s = el.computedStyle as WebStyle
    if (REPLACED.has(el.tag) || s.content !== undefined) return 'text'
    const d = s.cssDisplay
    if (d === 'flex' || d === 'inline-flex' || d === 'grid' || d === 'inline-grid' || d === 'table' || d === 'table-row' || d === 'table-row-group') return 'box'
    for (const c of el.children) if (!this.isInlineLevel(c)) return 'box'
    return 'text'
  }

  querySelector(selector: string): TElement | null {
    if (selector === 'body') return this.find((el) => el.tag === 'body')
    const list = parseSelectorList(selector)
    if (!list.length) return null
    return this.find((el) => list.some((sel) => matches(sel, this.target(el))))
  }

  querySelectorAll(selector: string, within: TElement = this.root): TElement[] {
    const list = parseSelectorList(selector)
    const out: TElement[] = []
    for (const el of within.walk()) if (el !== within && list.some((sel) => matches(sel, this.target(el)))) out.push(el)
    return out
  }

  private find(pred: (el: TElement) => boolean): TElement | null {
    for (const el of this.root.walk()) if (el !== this.root && pred(el)) return el
    return null
  }

  // ---------------------------------------------------------------- controls

  private setupElement(el: TElement) {
    installFacade(el, this)
    this.ensureEntry(el)
  }

  /** Registers a focus entry for elements that can be focused. */
  ensureEntry(el: TElement) {
    const st = controlState(el)
    if (st.entry) return
    const kind = controlKind(el)
    const tab = el.props.tabindex ?? el.props.tabIndex
    const clickable = hasListener(el, 'click') || hasListener(el, 'dblclick') || hasListener(el, 'mousedown')
    if (!kind && tab === undefined && !clickable) return
    const isFocused: Ref<boolean> = ref(false)
    const entry: FocusEntry = {
      id: nextFocusId(),
      el: () => el,
      isFocused,
      disabled: () => !this.canFocus(el),
      autoFocus: el.props.autofocus !== undefined && el.props.autofocus !== false,
      onKey: (e) => this.onKey(el, e),
      onFocus: () => this.onFocus(el),
      onBlur: () => this.onBlur(el),
    }
    st.entry = entry
    this.opts.focus.register(entry)
  }

  private canFocus(el: TElement): boolean {
    if (!this.inScope(el)) return false
    if (el.props.disabled !== undefined && el.props.disabled !== false) return false
    const tab = el.props.tabindex ?? el.props.tabIndex
    if (tab !== undefined && Number(tab) < 0) return false
    if (controlKind(el)) return true
    if (tab !== undefined) return true
    // elements that only have click listeners: focusable unless they wrap a control
    if (hasListener(el, 'click') || hasListener(el, 'dblclick') || hasListener(el, 'mousedown')) {
      for (const d of el.walk()) if (d !== el && controlKind(d)) return false
      return true
    }
    return false
  }

  focus(el: TElement) {
    this.ensureEntry(el)
    const st = controlState(el)
    if (st.entry) this.opts.focus.focus(st.entry)
  }

  blur(el: TElement) {
    if (this.focusedElement() === el) this.opts.focus.blur()
  }

  private onFocus(el: TElement) {
    const st = controlState(el)
    st.focused = true
    st.dirty = false
    if (controlKind(el) === 'text' || controlKind(el) === 'textarea') st.cursor = st.value.length
    this.restyleAll = true
    el.invalidateStyle()
    this.fire('focus', el)
    this.fire('focusin', el)
    this.opts.requestRender()
  }

  private onBlur(el: TElement) {
    const st = controlState(el)
    st.focused = false
    if (st.dirty) {
      st.dirty = false
      this.commitLazy(el)
      this.fire('change', el)
    }
    this.restyleAll = true
    el.invalidateStyle()
    this.fire('blur', el)
    this.fire('focusout', el)
    this.opts.requestRender()
  }

  fire(type: string, el: TElement, init: Partial<WebEvent> = {}): boolean {
    return dispatch(createEvent(type, el, init), this.opts.onError)
  }

  private onKey(el: TElement, e: KeyEvent) {
    const init = domKey(e)
    const proceed = this.fire('keydown', el, init)
    if (proceed) this.keyAction(el, e)
    if (!el.parent) return // removed by a handler
    this.fire('keyup', el, init)
  }

  private keyAction(el: TElement, e: KeyEvent) {
    const kind = controlKind(el)
    const st = controlState(el)
    const consume = () => e.stopPropagation()
    if (kind === 'text' || kind === 'textarea') {
      if (this.editText(el, st, e, kind === 'textarea')) consume()
      return
    }
    if (kind === 'checkbox' || kind === 'radio') {
      if (matchKey(e, 'space|enter')) {
        consume()
        this.activate(el)
      }
      return
    }
    if (kind === 'select') {
      const opts = options(el)
      if (!opts.length) return
      let i = selectedIndexOf(el, st)
      if (matchKey(e, 'down|right|space|enter')) i = (i + 1) % opts.length
      else if (matchKey(e, 'up|left')) i = (i - 1 + opts.length) % opts.length
      else return
      consume()
      st.selectedIndex = i
      el.invalidateStyle()
      this.fire('input', el)
      this.assignModel(el, 'select')
      this.fire('change', el)
      return
    }
    if (kind === 'range') {
      const min = Number(el.props.min ?? 0)
      const max = Number(el.props.max ?? 100)
      const step = Number(el.props.step ?? 1) || 1
      let v = Number(st.value || (min + max) / 2)
      if (matchKey(e, 'right|up')) v = Math.min(max, v + step)
      else if (matchKey(e, 'left|down')) v = Math.max(min, v - step)
      else return
      consume()
      st.value = String(v)
      el.invalidateStyle()
      this.fire('input', el)
      this.assignModel(el, 'text')
      this.fire('change', el)
      return
    }
    // buttons, links, labels, summaries and clickable elements
    if (matchKey(e, 'enter') || (matchKey(e, 'space') && kind !== 'link')) {
      consume()
      this.activate(el)
    }
  }

  /** Line editing for text inputs. Returns true when the key was used. */
  private editText(el: TElement, st: ControlState, e: KeyEvent, multiline: boolean): boolean {
    if (el.props.readonly !== undefined && el.props.readonly !== false) return false
    const v = st.value
    const set = (value: string, cursor: number, inputType: string, data: string | null = null) => {
      const max = el.props.maxlength !== undefined ? Number(el.props.maxlength) : Infinity
      if (value.length > max) value = value.slice(0, max)
      st.value = value
      st.cursor = Math.max(0, Math.min(cursor, value.length))
      st.dirty = true
      el.invalidateStyle()
      this.fire('input', el, { inputType, data })
      this.assignModel(el, 'text')
    }
    const move = (c: number) => {
      st.cursor = Math.max(0, Math.min(c, v.length))
      el.invalidateStyle()
    }
    if (e.paste) {
      const text = multiline ? e.char : e.char.replace(/\r?\n/g, ' ')
      set(v.slice(0, st.cursor) + text + v.slice(st.cursor), st.cursor + text.length, 'insertFromPaste', text)
      return true
    }
    if (matchKey(e, 'enter')) {
      if (multiline) {
        set(v.slice(0, st.cursor) + '\n' + v.slice(st.cursor), st.cursor + 1, 'insertLineBreak')
        return true
      }
      // commit + implicit form submission
      if (st.dirty) {
        st.dirty = false
        this.commitLazy(el)
        this.fire('change', el)
      }
      const form = closest(el, 'form')
      if (form) this.submit(form, el)
      return true
    }
    if (matchKey(e, 'backspace')) {
      if (st.cursor > 0) set(v.slice(0, st.cursor - 1) + v.slice(st.cursor), st.cursor - 1, 'deleteContentBackward')
      return true
    }
    if (matchKey(e, 'delete|ctrl+d')) {
      if (st.cursor < v.length) set(v.slice(0, st.cursor) + v.slice(st.cursor + 1), st.cursor, 'deleteContentForward')
      return true
    }
    if (matchKey(e, 'left')) return (move(st.cursor - 1), true)
    if (matchKey(e, 'right')) return (move(st.cursor + 1), true)
    if (matchKey(e, 'home|ctrl+a')) return (move(multiline ? v.lastIndexOf('\n', st.cursor - 1) + 1 : 0), true)
    if (matchKey(e, 'end|ctrl+e')) {
      const nl = v.indexOf('\n', st.cursor)
      return (move(multiline && nl >= 0 ? nl : v.length), true)
    }
    if (matchKey(e, 'ctrl+u')) {
      set(v.slice(st.cursor), 0, 'deleteContentBackward')
      return true
    }
    if (matchKey(e, 'ctrl+w')) {
      const before = v.slice(0, st.cursor).replace(/\S+\s*$/, '')
      set(before + v.slice(st.cursor), before.length, 'deleteWordBackward')
      return true
    }
    if (e.char && !e.ctrl && !e.meta && e.name !== 'tab' && e.name !== 'escape') {
      if (inputType(el) === 'number' && !/^[\d.eE+-]$/.test(e.char)) return true
      set(v.slice(0, st.cursor) + e.char + v.slice(st.cursor), st.cursor + e.char.length, 'insertText', e.char)
      return true
    }
    return false
  }

  private commitLazy(el: TElement) {
    const st = controlState(el)
    if (st.model?.mods.lazy) this.assignModel(el, 'text', true)
  }

  /** Writes the control's value to its v-model binding. */
  private assignModel(el: TElement, kind: 'text' | 'select', lazyCommit = false) {
    const st = controlState(el)
    const m = st.model
    if (!m?.assign) return
    if (kind === 'select') {
      const opts = options(el)
      if (el.props.multiple !== undefined && el.props.multiple !== false) {
        m.assign(opts.filter((_, i) => i === st.selectedIndex).map(optionValue))
      } else {
        const o = opts[st.selectedIndex]
        let v = o ? optionValue(o) : undefined
        if (m.mods.number && v !== undefined) v = toNumber(v)
        m.assign(v)
      }
      return
    }
    if (m.mods.lazy && !lazyCommit) return
    let v: unknown = st.value
    if (m.mods.trim) v = String(v).trim()
    if (m.mods.number || inputType(el) === 'number') v = toNumber(v)
    m.assign(v)
  }

  /** Click semantics: event + default action. */
  activate(el: TElement, init: Partial<WebEvent> = {}) {
    const kind = controlKind(el)
    const st = controlState(el)
    // checkboxes / radios toggle before the click handlers run (like browsers)
    let prevChecked: boolean | null = null
    if (kind === 'checkbox' || kind === 'radio') {
      if (el.props.disabled !== undefined && el.props.disabled !== false) return
      prevChecked = st.checked
      if (kind === 'radio') {
        if (!st.checked) this.checkRadio(el)
      } else st.checked = !st.checked
      el.invalidateStyle()
    }
    const ok = this.fire('click', el, { button: 0, buttons: 0, detail: 1, ...init })
    if (!ok) {
      if (prevChecked !== null && kind === 'checkbox') {
        st.checked = prevChecked
        el.invalidateStyle()
      }
      return
    }
    if (hasListener(el, 'dblclick') && !hasListener(el, 'click') && init.detail === undefined) {
      // keyboard has no double click: Enter on a dblclick-only element triggers it
      this.fire('dblclick', el, { button: 0, detail: 2 })
    }
    if (prevChecked !== null && prevChecked !== st.checked) {
      this.fire('input', el)
      this.assignCheck(el)
      this.fire('change', el)
      return
    }
    if (kind === 'label') {
      const forId = el.props.for ?? el.props.htmlFor
      const target = forId ? this.find((x) => x.props.id === forId) : [...el.walk()].find((x) => x !== el && controlKind(x) && controlKind(x) !== 'label')
      if (target) {
        const tk = controlKind(target)
        if (tk === 'checkbox' || tk === 'radio' || tk === 'button') this.activate(target)
        else this.focus(target)
      }
      return
    }
    if (kind === 'summary') {
      const details = el.parent?.tag === 'details' ? el.parent : null
      if (details) details.setProp('open', details.props.open !== undefined ? undefined : '')
      return
    }
    if (kind === 'button') {
      const type = String(el.props.type ?? (el.tag === 'button' ? 'submit' : 'button')).toLowerCase()
      const form = closest(el, 'form')
      if (form && type === 'submit') this.submit(form, el)
      if (form && type === 'reset') this.fire('reset', form)
      return
    }
    if (kind === 'link') {
      const href = el.props.href
      if (typeof href === 'string' && href && !href.startsWith('javascript:')) this.opts.navigate?.(href, el)
    }
  }

  private submit(form: TElement, submitter: TElement) {
    this.fire('submit', form, { submitter } as Partial<WebEvent>)
  }

  private checkRadio(el: TElement) {
    const name = el.props.name
    if (name !== undefined) {
      const form = closest(el, 'form') ?? this.root
      for (const other of form.walk()) {
        if (other !== el && other.tag === 'input' && inputType(other) === 'radio' && other.props.name === name) {
          const os = controlState(other)
          if (os.checked) {
            os.checked = false
            other.invalidateStyle()
          }
        }
      }
    }
    controlState(el).checked = true
  }

  private assignCheck(el: TElement) {
    const st = controlState(el)
    const m = st.model
    if (!m?.assign) return
    if (controlKind(el) === 'radio') {
      m.assign((el as unknown as { _value?: unknown })._value ?? el.props.value ?? 'on')
      return
    }
    const value = (el as unknown as { _value?: unknown })._value ?? el.props.value
    const model = m.value
    if (Array.isArray(model)) {
      const i = model.findIndex((x) => looseEqual(x, value))
      if (st.checked && i < 0) m.assign([...model, value])
      else if (!st.checked && i >= 0) m.assign(model.filter((_, k) => k !== i))
    } else if (model instanceof Set) {
      const next = new Set(model)
      if (st.checked) next.add(value)
      else next.delete(value)
      m.assign(next)
    } else {
      const tv = el.props['true-value'] ?? (el as unknown as { _trueValue?: unknown })._trueValue
      const fv = el.props['false-value'] ?? (el as unknown as { _falseValue?: unknown })._falseValue
      m.assign(st.checked ? (tv !== undefined ? tv : true) : fv !== undefined ? fv : false)
    }
  }

  // ---------------------------------------------------------------- widget visuals

  private decorateControl(el: TElement, ws: WebStyle) {
    const kind = controlKind(el)
    const st = states.get(el)
    const focused = !!st?.focused
    const focusInk: Ink = { inverse: true }
    if (kind === 'text' || kind === 'textarea') {
      const s = st ?? controlState(el)
      const masked = inputType(el) === 'password' ? '•'.repeat(s.value.length) : s.value
      const placeholder = el.props.placeholder !== undefined ? String(el.props.placeholder) : ''
      const width = typeof ws.width === 'number' ? Math.max(1, ws.width - (ws.paddingLeft ?? 0) - (ws.paddingRight ?? 0) - (ws.border ? 2 : 0)) : Number(el.props.size ?? (kind === 'textarea' ? 0 : 20))
      const segs: Segment[] = []
      const field: Ink = { underline: kind === 'text' && !ws.border }
      if (!masked && placeholder) {
        // like browsers: the placeholder stays until the first keystroke
        if (focused) segs.push({ text: placeholder.slice(0, 1), ink: { ...field, dim: true, inverse: true } }, { text: placeholder.slice(1), ink: { ...field, dim: true } })
        else segs.push({ text: placeholder, ink: { ...field, dim: true } })
      } else {
        segs.push({ text: masked.slice(0, s.cursor), ink: field })
        if (focused) {
          const at = masked.slice(s.cursor, s.cursor + 1)
          segs.push({ text: at && at !== '\n' ? at : ' ', ink: { ...field, inverse: true } })
          if (at === '\n') segs.push({ text: '\n' })
          segs.push({ text: masked.slice(s.cursor + 1), ink: field })
        } else segs.push({ text: masked.slice(s.cursor), ink: field })
      }
      if (kind === 'text') {
        const used = segs.reduce((n, sg) => n + sg.text.length, 0)
        if (width > used) segs.push({ text: ' '.repeat(width - used), ink: field })
        ws.wrap = 'truncate-start'
      } else {
        const rows = Number(el.props.rows ?? 3)
        if (ws.minHeight === undefined) ws.minHeight = rows + (ws.border ? 2 : 0)
        ws.whiteSpace = 'pre'
      }
      ws.content = segs
      if (focused && ws.border) ws.borderColor = 'focus'
      return
    }
    if (kind === 'checkbox' || kind === 'radio') {
      const s = st ?? controlState(el)
      const box = kind === 'checkbox' ? (s.checked ? '[x]' : '[ ]') : s.checked ? '(•)' : '( )'
      ws.content = [{ text: box, ink: focused ? focusInk : { bold: s.checked } }, { text: ' ' }]
      ws.dim = false
      return
    }
    if (kind === 'select') {
      const s = st ?? controlState(el)
      const opts = options(el)
      const o = opts[selectedIndexOf(el, s)]
      const label = o ? o.textContent.trim() : ''
      ws.content = [{ text: `[${label} ▾]`, ink: focused ? focusInk : undefined }]
      return
    }
    if (kind === 'range') {
      const s = st ?? controlState(el)
      const min = Number(el.props.min ?? 0)
      const max = Number(el.props.max ?? 100)
      const v = Number(s.value || (min + max) / 2)
      const n = 10
      const k = Math.round(((v - min) / (max - min || 1)) * n)
      ws.content = [{ text: '━'.repeat(k), ink: { color: 'primary' } }, { text: '●', ink: focused ? focusInk : { color: 'primary' } }, { text: '─'.repeat(n - k), ink: { dim: true } }]
      return
    }
    if (el.tag === 'input' && kind === 'button') {
      const label = String(el.props.value ?? (inputType(el) === 'reset' ? 'Reset' : 'Submit'))
      ws.content = [{ text: `[ ${label} ]`, ink: focused ? focusInk : { bold: true } }]
      return
    }
    if (el.tag === 'img') {
      const alt = el.props.alt !== undefined ? String(el.props.alt) : ''
      // like a browser's broken image: the alt text only shows when it fits the image's box
      // (a 32px avatar next to the author's name shows just the marker, not the name twice)
      const attrWidth = Number(el.props.width)
      const width = typeof ws.width === 'number' ? ws.width : attrWidth > 0 ? Math.round(attrWidth / 8) : undefined
      const text = alt ? `▣ ${alt}` : ''
      ws.content = !text ? '' : width !== undefined && text.length > width ? [{ text: '▣', ink: { dim: true } }] : [{ text, ink: { dim: true } }]
      return
    }
    if (el.tag === 'progress' || el.tag === 'meter') {
      const max = Number(el.props.max ?? 1) || 1
      const v = Math.max(0, Math.min(max, Number(el.props.value ?? 0)))
      const n = 12
      const k = Math.round((v / max) * n)
      ws.content = [{ text: '█'.repeat(k), ink: { color: 'primary' } }, { text: '░'.repeat(n - k), ink: { dim: true } }]
      return
    }
    if (el.tag === 'br') return
    if (kind === 'button' && el.kind === 'text' && !ws.border) {
      // terminal buttons: [ label ]
      ws.before = [{ text: '[ ' }, ...(Array.isArray(ws.before) ? ws.before : ws.before ? [{ text: ws.before }] : [])]
      ws.after = [...(Array.isArray(ws.after) ? ws.after : ws.after ? [{ text: ws.after }] : []), { text: ' ]' }]
      if (!ws.color) ws.bold = true
    }
    if (focused && kind !== null) ws.inverse = true
    else if (focused) ws.inverse = true
    if (focused && ws.border) ws.borderColor = 'focus'
  }

  // ---------------------------------------------------------------- mouse

  /** Runtime mouse hook: DOM-shaped mouse events for elements in the page. */
  handleMouse(e: MouseEvent, target: TElement | null, scrollBy: (rows: number) => void): boolean {
    if (!target || !this.inScope(target)) {
      if (e.action === 'move' && this.hovered.length) {
        this.hovered = []
        this.restyleAll = true
        this.opts.requestRender()
      }
      return false
    }
    const init: Partial<WebEvent> = { clientX: e.x * 8, clientY: e.y * 16, ctrlKey: e.ctrl, shiftKey: e.shift, altKey: e.meta }
    switch (e.action) {
      case 'wheel':
        if (this.fire('wheel', target, init)) scrollBy(e.direction === 'up' ? -3 : e.direction === 'down' ? 3 : 0)
        return true
      case 'down': {
        if (e.button !== 'left') return true
        this.downTarget = target
        const ok = this.fire('mousedown', target, { ...init, button: 0, buttons: 1 })
        const entry = this.opts.focus.entryFor(target)
        if (ok && entry && !entry.disabled()) this.opts.focus.focus(entry)
        return true
      }
      case 'up': {
        if (e.button !== 'left') return true
        this.fire('mouseup', target, { ...init, button: 0 })
        const down = this.downTarget
        this.downTarget = null
        if (!down || !(down.contains(target) || target.contains(down))) return true
        const now = Date.now()
        const dbl = !!this.lastClick && this.lastClick.el === target && now - this.lastClick.at < 450
        this.lastClick = dbl ? null : { el: target, at: now }
        // default actions belong to the nearest control (a click on a link's text still follows the link)
        let ctl: TElement | null = target
        while (ctl && ctl !== this.root && !controlKind(ctl)) ctl = ctl.parent
        if (ctl && ctl !== this.root && ctl !== target) {
          // the event targets the clicked element; the control's default action runs after it bubbles
          const ok = this.fire('click', target, { ...init, button: 0, detail: dbl ? 2 : 1 })
          if (ok) this.activateDefaultOnly(ctl)
        } else if (ctl && ctl !== this.root) this.activate(ctl, { ...init, detail: dbl ? 2 : 1 })
        else this.fire('click', target, { ...init, button: 0, detail: dbl ? 2 : 1 })
        if (dbl) this.fire('dblclick', target, { ...init, button: 0, detail: 2 })
        return true
      }
      case 'move':
      case 'drag': {
        const chain: TElement[] = []
        for (let n: TElement | null = target; n && n !== this.root; n = n.parent) chain.push(n)
        if (chain.length !== this.hovered.length || chain.some((c, i) => c !== this.hovered[i])) {
          this.hovered = chain
          this.restyleAll = true
          this.opts.requestRender()
        }
        return true
      }
    }
    return true
  }

  /** Default action of a control whose click event was already dispatched. */
  private activateDefaultOnly(el: TElement) {
    const kind = controlKind(el)
    if (kind === 'checkbox' || kind === 'radio' || kind === 'label' || kind === 'summary') {
      // these toggle state; reuse activate but without re-firing click on el
      const st = controlState(el)
      if (kind === 'checkbox' || kind === 'radio') {
        const prev = st.checked
        if (kind === 'radio') this.checkRadio(el)
        else st.checked = !st.checked
        el.invalidateStyle()
        if (prev !== st.checked) {
          this.fire('input', el)
          this.assignCheck(el)
          this.fire('change', el)
        }
        return
      }
      if (kind === 'summary') {
        const details = el.parent?.tag === 'details' ? el.parent : null
        if (details) details.setProp('open', details.props.open !== undefined ? undefined : '')
        return
      }
      const forId = el.props.for ?? el.props.htmlFor
      const target = forId ? this.find((x) => x.props.id === forId) : [...el.walk()].find((x) => x !== el && controlKind(x) && controlKind(x) !== 'label')
      if (target) {
        const tk = controlKind(target)
        if (tk === 'checkbox' || tk === 'radio' || tk === 'button') this.activate(target)
        else this.focus(target)
      }
      return
    }
    if (kind === 'button') {
      const type = String(el.props.type ?? (el.tag === 'button' ? 'submit' : 'button')).toLowerCase()
      const form = closest(el, 'form')
      if (form && type === 'submit') this.submit(form, el)
      return
    }
    if (kind === 'link') {
      const href = el.props.href
      if (typeof href === 'string' && href && !href.startsWith('javascript:')) this.opts.navigate?.(href, el)
    }
    if (kind === 'text' || kind === 'textarea' || kind === 'select') this.focus(el)
  }
}

// ------------------------------------------------------------------ helpers

function prevElement(el: TElement): TElement | null {
  const p = el.parent
  if (!p) return null
  for (let i = p.children.indexOf(el) - 1; i >= 0; i--) {
    const c = p.children[i]
    if (c.nodeType === 'element') return c
    if (c.nodeType === 'text' && /\S/.test(c.text)) return null
  }
  return null
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16)
  const ch = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255)
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Icon-font classes (ionicons, font-awesome, bootstrap icons, ...) → a terminal symbol. */
const ICONS: [RegExp, string][] = [
  [/heart/, '♥'], [/star/, '★'], [/gear|cog|settings/, '⚙'], [/plus|add\b/, '+'], [/compose|edit|pencil|create/, '✎'],
  [/trash|delete|remove/, '✖'], [/close|times|\bx\b|cancel/, '✕'], [/search|magnif/, '⌕'], [/home|house/, '⌂'],
  [/person|user|account|profile/, '☺'], [/check/, '✓'], [/chevron-left|arrow-left|angle-left|back/, '‹'],
  [/chevron-right|arrow-right|angle-right|forward/, '›'], [/arrow-up|chevron-up|angle-up/, '↑'], [/arrow-down|chevron-down|angle-down/, '↓'],
  [/bars|menu|navicon|hamburger/, '≡'], [/mail|envelope|email/, '✉'], [/info/, 'ⓘ'], [/warn|alert|exclamation/, '⚠'],
  [/refresh|sync|reload|loop/, '↻'], [/bell|notif/, '♪'], [/play/, '▶'], [/pause/, '‖'], [/stop/, '■'], [/minus/, '−'],
  [/comment|chat|bubble/, '✎'], [/bookmark/, '⚑'], [/flag/, '⚑'], [/calendar|clock|time/, '◷'], [/lock/, '⚿'], [/link/, '∞'],
]

function iconGlyph(classes: string[]): string | undefined {
  const icon = classes.find((c) => /^(ion|fa|fas|far|fab|bi|icon|mdi|glyphicon|ti|ri|la|las)-/.test(c) && !/^(fa|bi|mdi|ion)-(lg|xs|sm|\dx|fw|spin|pulse|border|pull-\w+|solid|regular|brands|light)$/.test(c))
  if (!icon) return undefined
  const name = icon.replace(/^[a-z]+-/, '')
  for (const [re, glyph] of ICONS) if (re.test(name)) return glyph
  return '•'
}

function toSegments(v: Segment[] | string | undefined): Segment[] {
  if (!v) return []
  return typeof v === 'string' ? [{ text: v }] : v
}

/** v-model directive support (see vue-shim): syncs a control with its bound value. */
export function bindModel(el: TElement, model: Model) {
  const st = controlState(el)
  st.model = model
  const kind = controlKind(el)
  if (kind === 'checkbox') {
    const value = (el as unknown as { _value?: unknown })._value ?? el.props.value
    const v = model.value
    const tv = el.props['true-value'] ?? (el as unknown as { _trueValue?: unknown })._trueValue
    st.checked = Array.isArray(v) ? v.some((x) => looseEqual(x, value)) : v instanceof Set ? v.has(value) : tv !== undefined ? looseEqual(v, tv) : !!v
  } else if (kind === 'radio') {
    st.checked = looseEqual(model.value, (el as unknown as { _value?: unknown })._value ?? el.props.value)
  } else if (kind === 'select') {
    const opts = options(el)
    const i = opts.findIndex((o) => looseEqual(optionValue(o), Array.isArray(model.value) ? model.value[0] : model.value))
    if (i >= 0) st.selectedIndex = i
  } else {
    const next = model.value === undefined || model.value === null ? '' : String(model.value)
    const cur = model.mods.trim ? st.value.trim() : st.value
    const same = cur === next || (model.mods.number && toNumber(st.value) === model.value)
    if (!same && !(st.focused && model.mods.lazy)) {
      st.value = next
      st.cursor = st.focused ? Math.min(st.cursor, next.length) : next.length
    }
  }
  el.invalidateStyle()
}


const REPLACED = new Set(['input', 'img', 'select', 'textarea', 'progress', 'meter', 'br'])

function closest(el: TElement, tag: string): TElement | null {
  for (let n: TElement | null = el; n; n = n.parent) if (n.tag === tag) return n
  return null
}

function toNumber(v: unknown): unknown {
  const n = parseFloat(String(v))
  return Number.isNaN(n) ? v : n
}

function inlineDecls(style: unknown): Declaration[] {
  if (!style) return []
  if (typeof style === 'string') {
    const out: Declaration[] = []
    for (const part of splitTop(style, ';')) {
      const i = part.indexOf(':')
      if (i < 0) continue
      const prop = part.slice(0, i).trim()
      let value = part.slice(i + 1).trim()
      const important = /!important\s*$/i.test(value)
      if (important) value = value.replace(/\s*!important\s*$/i, '')
      if (prop && value) out.push({ prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value, important })
    }
    return out
  }
  if (typeof style === 'object') {
    const out: Declaration[] = []
    for (const [k, v] of Object.entries(style as Record<string, unknown>)) {
      if (v === undefined || v === null || v === '') continue
      const prop = k.startsWith('--') ? k : k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
      const value = typeof v === 'number' && !/^(opacity|flex|flex-grow|flex-shrink|z-index|font-weight|order|line-height)$/.test(prop) ? `${v}px` : String(v)
      out.push({ prop, value, important: false })
    }
    return out
  }
  return []
}

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]

function listMarker(el: TElement, type: string): string | null {
  switch (type) {
    case 'disc':
      return '• '
    case 'circle':
      return '◦ '
    case 'square':
      return '▪ '
    case 'none':
      return null
  }
  const p = el.parent
  let index = 1
  if (p) {
    const start = Number(p.props.start ?? 1)
    index = start + p.children.filter((c): c is TElement => c.nodeType === 'element' && c.tag === 'li').indexOf(el)
  }
  switch (type) {
    case 'decimal':
      return `${index}. `
    case 'decimal-leading-zero':
      return `${String(index).padStart(2, '0')}. `
    case 'lower-alpha':
    case 'lower-latin':
      return `${String.fromCharCode(96 + (((index - 1) % 26) + 1))}. `
    case 'upper-alpha':
    case 'upper-latin':
      return `${String.fromCharCode(64 + (((index - 1) % 26) + 1))}. `
    case 'lower-roman':
    case 'upper-roman': {
      let n = index
      let s = ''
      for (const [v, r] of ROMAN) while (n >= v) ((s += r), (n -= v))
      return `${type === 'upper-roman' ? s.toUpperCase() : s}. `
    }
  }
  return '• '
}

// ------------------------------------------------------------------ DOM facade

const facadeScopes = new WeakMap<TElement, WebScope>()
let facadeInstalled = false

/** Adds DOM-like members to terminal elements (used by app code via template refs / event.target). */
function installFacade(el: TElement, scope: WebScope) {
  facadeScopes.set(el, scope)
  installFacadeProto()
}

/**
 * Installed once, when this module loads: libraries call DOM methods on elements they
 * create before the app is mounted (PrimeVue / Element Plus during `app.use()`).
 */
function installFacadeProto() {
  if (facadeInstalled) return
  facadeInstalled = true
  const proto = TElement.prototype as unknown as Record<string, unknown>
  const def = (name: string, desc: PropertyDescriptor) => {
    if (!(name in proto)) Object.defineProperty(proto, name, { configurable: true, ...desc })
  }
  const scopeOf = (self: TElement) => facadeScopes.get(self) ?? null
  def('value', {
    get(this: TElement) {
      if (this.tag === 'select') {
        const st = controlState(this)
        const o = options(this)[selectedIndexOf(this, st)]
        return o ? String(optionValue(o)) : ''
      }
      if (this.tag === 'option') return String(optionValue(this))
      if (this.tag === 'input' || this.tag === 'textarea') return controlState(this).value
      return this.props.value
    },
    set(this: TElement, v: unknown) {
      if (this.tag === 'select') {
        const i = options(this).findIndex((o) => looseEqual(optionValue(o), v))
        controlState(this).selectedIndex = i
      } else {
        const st = controlState(this)
        st.value = v === undefined || v === null ? '' : String(v)
        st.cursor = st.value.length
      }
      this.invalidateStyle()
    },
  })
  def('checked', {
    get(this: TElement) {
      return controlState(this).checked
    },
    set(this: TElement, v: unknown) {
      controlState(this).checked = !!v
      this.invalidateStyle()
    },
  })
  def('selectedIndex', {
    get(this: TElement) {
      return selectedIndexOf(this, controlState(this))
    },
    set(this: TElement, v: number) {
      controlState(this).selectedIndex = v
      this.invalidateStyle()
    },
  })
  def('selectionStart', {
    get(this: TElement) {
      return controlState(this).cursor
    },
  })
  def('selectionEnd', {
    get(this: TElement) {
      return controlState(this).cursor
    },
  })
  def('setSelectionRange', {
    value(this: TElement, start: number) {
      controlState(this).cursor = start
      this.invalidateStyle()
    },
  })
  def('select', { value() {} })
  def('focus', {
    value(this: TElement) {
      scopeOf(this)?.focus(this)
    },
  })
  def('blur', {
    value(this: TElement) {
      scopeOf(this)?.blur(this)
    },
  })
  def('click', {
    value(this: TElement) {
      scopeOf(this)?.activate(this)
    },
  })
  def('tagName', {
    get(this: TElement) {
      return this.tag.toUpperCase()
    },
  })
  def('nodeName', {
    get(this: TElement) {
      return this.tag.toUpperCase()
    },
  })
  def('id', {
    get(this: TElement) {
      return this.props.id ?? ''
    },
    set(this: TElement, v: unknown) {
      this.setProp('id', String(v))
    },
  })
  def('className', {
    get(this: TElement) {
      return this.props.class ?? ''
    },
    set(this: TElement, v: string) {
      this.setProp('class', v)
    },
  })
  def('innerText', {
    get(this: TElement) {
      return this.textContent
    },
  })
  def('parentElement', {
    get(this: TElement) {
      return this.parent
    },
  })
  def('getAttribute', {
    value(this: TElement, name: string) {
      const v = this.props[name]
      return v === undefined || v === null || v === false ? null : v === true ? '' : String(v)
    },
  })
  def('hasAttribute', {
    value(this: TElement, name: string) {
      return this.props[name] !== undefined && this.props[name] !== false
    },
  })
  def('setAttribute', {
    value(this: TElement, name: string, v: string) {
      this.setProp(name, String(v))
    },
  })
  def('removeAttribute', {
    value(this: TElement, name: string) {
      this.setProp(name, undefined)
    },
  })
  def('classList', {
    get(this: TElement) {
      const self = this
      const list = () => String(self.props.class ?? '').split(/\s+/).filter(Boolean)
      const write = (l: string[]) => self.setProp('class', l.join(' '))
      // an array of the current classes (iterable, indexable: `Array.from(el.classList)`)
      // with the DOMTokenList methods, which always act on the live class attribute
      return Object.assign([...list()], {
        add: (...c: string[]) => write([...new Set([...list(), ...c])]),
        remove: (...c: string[]) => write(list().filter((x) => !c.includes(x))),
        toggle: (c: string, force?: boolean) => {
          const has = list().includes(c)
          const on = force ?? !has
          if (on && !has) write([...list(), c])
          if (!on && has) write(list().filter((x) => x !== c))
          return on
        },
        contains: (c: string) => list().includes(c),
        replace: (a: string, b: string) => write(list().map((x) => (x === a ? b : x))),
        item: (i: number) => list()[i] ?? null,
        get value() {
          return list().join(' ')
        },
        toString: () => list().join(' '),
      })
    },
  })
  def('dataset', {
    get(this: TElement) {
      const out: Record<string, string> = {}
      for (const k in this.props) if (k.startsWith('data-') && !k.startsWith('data-v-')) out[k.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = String(this.props[k])
      return out
    },
  })
  type Listener = (e: unknown) => unknown
  type Owner = { __listeners?: Map<string, Set<Listener>>; __wrapped?: Map<string, Map<unknown, Listener>> }
  def('addEventListener', {
    value(this: TElement, type: string, fn: Listener | { handleEvent(e: unknown): unknown }, opts?: boolean | { once?: boolean }) {
      if (!fn) return
      const self = this as unknown as Owner
      self.__listeners ??= new Map()
      self.__wrapped ??= new Map()
      let set = self.__listeners.get(type)
      if (!set) self.__listeners.set(type, (set = new Set()))
      let wrapped = self.__wrapped.get(type)
      if (!wrapped) self.__wrapped.set(type, (wrapped = new Map()))
      if (wrapped.has(fn)) return // like the DOM: the same listener is added once
      const once = typeof opts === 'object' && !!opts?.once
      const call: Listener = typeof fn === 'function' ? fn : (e) => fn.handleEvent(e)
      const listener: Listener = once
        ? (e) => {
            set!.delete(listener)
            wrapped!.delete(fn)
            return call(e)
          }
        : call
      wrapped.set(fn, listener)
      set.add(listener)
      if (type === 'click' || type === 'keydown') scopeOf(this)?.ensureEntry(this)
    },
  })
  def('removeEventListener', {
    value(this: TElement, type: string, fn: unknown) {
      const self = this as unknown as Owner
      const listener = self.__wrapped?.get(type)?.get(fn)
      if (!listener) return
      self.__wrapped!.get(type)!.delete(fn)
      self.__listeners?.get(type)?.delete(listener)
    },
  })
  def('dispatchEvent', {
    value(this: TElement, ev: { type: string }) {
      const e = createEvent(ev.type, this, ev as Partial<WebEvent>)
      return dispatch(e)
    },
  })
  def('getBoundingClientRect', {
    value(this: TElement) {
      const l = this.layout
      return { x: l.x * 8, y: l.y * 16, left: l.x * 8, top: l.y * 16, width: l.width * 8, height: l.height * 16, right: (l.x + l.width) * 8, bottom: (l.y + l.height) * 16 }
    },
  })
  for (const [name, f] of [
    ['offsetWidth', (l: TElement['layout']) => l.width * 8],
    ['offsetHeight', (l: TElement['layout']) => l.height * 16],
    ['clientWidth', (l: TElement['layout']) => l.innerWidth * 8],
    ['clientHeight', (l: TElement['layout']) => l.innerHeight * 16],
    ['scrollWidth', (l: TElement['layout']) => l.scrollWidth * 8],
    ['scrollHeight', (l: TElement['layout']) => l.scrollHeight * 16],
  ] as const) {
    def(name, {
      get(this: TElement) {
        return f(this.layout)
      },
    })
  }
  def('scrollIntoView', { value() {} })
  // vue-router 5 compares root nodes of the view and the app container
  for (const P of [TElement.prototype, TTextNode.prototype, TComment.prototype] as unknown as Record<string, unknown>[]) {
    if (!('getRootNode' in P))
      Object.defineProperty(P, 'getRootNode', {
        configurable: true,
        value(this: TNode) {
          let n: TNode = this
          while (n.parent) n = n.parent
          return n
        },
      })
  }
  def('scrollTo', { value() {} })
  def('querySelector', {
    value(this: TElement, sel: string) {
      return scopeOf(this)?.querySelectorAll(sel, this)[0] ?? null
    },
  })
  def('querySelectorAll', {
    value(this: TElement, sel: string) {
      return scopeOf(this)?.querySelectorAll(sel, this) ?? []
    },
  })
  def('closest', {
    value(this: TElement, sel: string) {
      const scope = scopeOf(this)
      if (!scope) return null
      const list = parseSelectorList(sel)
      for (let n: TElement | null = this; n && n !== scope.root; n = n.parent) if (list.some((s) => matches(s, scope.target(n!)))) return n
      return null
    },
  })
  def('matches', {
    value(this: TElement, sel: string) {
      const scope = scopeOf(this)
      return !!scope && parseSelectorList(sel).some((s) => matches(s, scope.target(this)))
    },
  })
  def('append', {
    value(this: TElement, ...nodes: (TNode | string)[]) {
      for (const n of nodes) this.insertBefore(typeof n === 'string' ? new TTextNode(n) : n, null)
    },
  })
  def('appendChild', {
    value(this: TElement, n: TNode) {
      this.insertBefore(n, null)
      return n
    },
  })
  def('remove', {
    value(this: TElement) {
      this.parent?.removeChild(this)
    },
  })
  // shadow DOM: content attached to a shadow root isn't displayed (libraries use it for
  // banners / isolation), but attaching must not throw
  def('attachShadow', {
    value(this: TElement, init?: { mode?: string }) {
      const root = new TElement('div')
      if (init?.mode !== 'closed') Object.defineProperty(this, 'shadowRoot', { value: root, configurable: true })
      return root
    },
  })
  def('shadowRoot', { value: null, writable: true })
  def('prepend', {
    value(this: TElement, ...nodes: (TNode | string)[]) {
      const first = this.children[0] ?? null
      for (const n of nodes) this.insertBefore(typeof n === 'string' ? new TTextNode(n) : n, first)
    },
  })
  def('insertAdjacentElement', {
    value(this: TElement, where: string, el: TElement) {
      const w = where.toLowerCase()
      if (w === 'beforebegin') this.parent?.insertBefore(el, this)
      else if (w === 'afterbegin') this.insertBefore(el, this.children[0] ?? null)
      else if (w === 'beforeend') this.insertBefore(el, null)
      else if (w === 'afterend') this.parent?.insertBefore(el, siblingOf(this, 1))
      return el
    },
  })
  def('replaceChildren', {
    value(this: TElement, ...nodes: (TNode | string)[]) {
      for (const c of [...this.children]) this.removeChild(c)
      for (const n of nodes) this.insertBefore(typeof n === 'string' ? new TTextNode(n) : n, null)
    },
  })
  def('innerHTML', {
    get(this: TElement) {
      return this.children.map(serializeNode).join('')
    },
    set(this: TElement, v: unknown) {
      for (const c of [...this.children]) this.removeChild(c)
      for (const n of parseHTML(v === null || v === undefined ? '' : String(v))) this.insertBefore(n, null)
    },
  })
  def('outerHTML', {
    get(this: TElement) {
      return serializeNode(this)
    },
  })
  def('firstElementChild', {
    get(this: TElement) {
      return this.children.find((c) => c.nodeType === 'element') ?? null
    },
  })
  def('lastElementChild', {
    get(this: TElement) {
      return [...this.children].reverse().find((c) => c.nodeType === 'element') ?? null
    },
  })
  def('childElementCount', {
    get(this: TElement) {
      return this.children.filter((c) => c.nodeType === 'element').length
    },
  })
  def('firstChild', {
    get(this: TElement) {
      return this.children[0] ?? null
    },
  })
  def('lastChild', {
    get(this: TElement) {
      return this.children[this.children.length - 1] ?? null
    },
  })
  def('childNodes', {
    get(this: TElement) {
      return this.children
    },
  })
  def('hasChildNodes', {
    value(this: TElement) {
      return this.children.length > 0
    },
  })
  // writable textContent: replaces the children with one text node (Naive UI writes <style> text this way)
  const text = Object.getOwnPropertyDescriptor(TElement.prototype, 'textContent')
  if (text?.get && !text.set)
    Object.defineProperty(TElement.prototype, 'textContent', {
      configurable: true,
      get: text.get,
      set(this: TElement, v: unknown) {
        for (const c of [...this.children]) this.removeChild(c)
        if (v !== null && v !== undefined && v !== '') this.insertBefore(new TTextNode(String(v)), null)
      },
    })
  // node relationships for every node type (text and comment nodes too)
  for (const P of [TElement.prototype, TTextNode.prototype, TComment.prototype] as unknown as Record<string, unknown>[]) {
    const nodeDef = (name: string, desc: PropertyDescriptor) => {
      if (!(name in P)) Object.defineProperty(P, name, { configurable: true, ...desc })
    }
    nodeDef('parentNode', {
      get(this: TNode) {
        return this.parent
      },
    })
    nodeDef('nextSibling', {
      get(this: TNode) {
        return siblingOf(this, 1)
      },
    })
    nodeDef('previousSibling', {
      get(this: TNode) {
        return siblingOf(this, -1)
      },
    })
    nodeDef('nextElementSibling', {
      get(this: TNode) {
        return siblingOf(this, 1, true)
      },
    })
    nodeDef('previousElementSibling', {
      get(this: TNode) {
        return siblingOf(this, -1, true)
      },
    })
    nodeDef('isConnected', {
      get(this: TNode) {
        let n: TNode = this
        while (n.parent) n = n.parent
        return n.nodeType === 'element' && n.kind === 'root'
      },
    })
    nodeDef('ownerDocument', {
      get() {
        return (globalThis as { document?: unknown }).document ?? null
      },
    })
    nodeDef('before', {
      value(this: TNode, ...nodes: (TNode | string)[]) {
        for (const n of nodes) this.parent?.insertBefore(typeof n === 'string' ? new TTextNode(n) : n, this)
      },
    })
    nodeDef('after', {
      value(this: TNode, ...nodes: (TNode | string)[]) {
        const anchor = siblingOf(this, 1)
        for (const n of nodes) this.parent?.insertBefore(typeof n === 'string' ? new TTextNode(n) : n, anchor)
      },
    })
  }
  for (const P of [TTextNode.prototype, TComment.prototype] as unknown as Record<string, unknown>[]) {
    for (const name of ['nodeValue', 'data'])
      if (!(name in P))
        Object.defineProperty(P, name, {
          configurable: true,
          get(this: { text?: string }) {
            return this.text ?? ''
          },
          set(this: { text?: string }, v: unknown) {
            if ('text' in this) this.text = String(v)
          },
        })
  }
}

function siblingOf(n: TNode, dir: 1 | -1, elementsOnly = false): TNode | null {
  const list = n.parent?.children
  if (!list) return null
  for (let i = list.indexOf(n) + dir; i >= 0 && i < list.length; i += dir) if (!elementsOnly || list[i].nodeType === 'element') return list[i]
  return null
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const escapeHtml = (s: string, attr = false) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(attr ? /"/g : /$^/, '&quot;')

/** Simple HTML serialization (for `innerHTML` / `outerHTML` reads). */
function serializeNode(n: TNode): string {
  if (n.nodeType === 'text') return escapeHtml(n.text)
  if (n.nodeType !== 'element') return ''
  let attrs = ''
  for (const [k, v] of Object.entries(n.props)) {
    if (v === undefined || v === null || v === false || typeof v === 'function' || typeof v === 'object' || k.startsWith('on')) continue
    attrs += v === true ? ` ${k}` : ` ${k}="${escapeHtml(String(v), true)}"`
  }
  if (VOID_TAGS.has(n.tag)) return `<${n.tag}${attrs}>`
  return `<${n.tag}${attrs}>${n.children.map(serializeNode).join('')}</${n.tag}>`
}

installFacadeProto()

export type { Model }
