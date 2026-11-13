import Yoga, {
  Align,
  Direction,
  Display,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  MeasureMode,
  Overflow,
  PositionType,
  Wrap,
  type Node as YogaNode,
} from 'yoga-layout'
import { parseClasses } from '../style/classes.js'
import { assignStyle, parseStyleString, type Ink, type Segment, type Style, mergeInk } from '../style/style.js'
import { measureGlyphs, toGlyphs, type Glyph, type WrapMode } from '../render/text.js'

export type TNode = TElement | TTextNode | TComment

const yogaConfig = Yoga.Config.create()
yogaConfig.setPointScaleFactor(1)

export type ElementKind = 'box' | 'text' | 'root'

const TAG_KIND: Record<string, ElementKind> = {
  'tui-root': 'root',
  'tui-box': 'box',
  box: 'box',
  div: 'box',
  view: 'box',
  'tui-text': 'text',
  text: 'text',
  span: 'text',
  p: 'text',
}

export function kindOfTag(tag: string): ElementKind {
  return TAG_KIND[tag] ?? 'box'
}

export interface LayoutRect {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutInfo extends LayoutRect {
  /** Size of the content area (inside border and padding). */
  innerWidth: number
  innerHeight: number
  /** Total size of the children (for scroll containers). */
  scrollWidth: number
  scrollHeight: number
}

/** Hook used by the app to know when it must repaint. */
export interface Host {
  requestRender(): void
}

/**
 * A style scope takes over style resolution for every element below the
 * element it is attached to (`el.scope = ...`). Used by the web layer
 * (`vurses web`) to apply real CSS and HTML flow layout to existing web apps.
 */
export interface StyleScope {
  /** Resolves the style of an element inside the scope. */
  style(el: TElement): Style
  /** A subtree was inserted below the scope. */
  attached(node: TNode): void
  /** A subtree is about to be removed from the scope. */
  detached(node: TNode): void
  /** Children or style of an element changed (flow may need recomputing). */
  changed(el: TElement): void
  /** A prop was patched on an element inside the scope. */
  propChanged(el: TElement, key: string, value: unknown): void
  /** Called once per frame, before layout. */
  flush(): void
}

/** Nearest scope at or above `n`. */
export function scopeOf(n: TElement | null): StyleScope | null {
  while (n) {
    if (n.scope) return n.scope
    n = n.parent
  }
  return null
}

abstract class NodeBase {
  parent: TElement | null = null
  yoga: YogaNode | null = null

  get root(): TElement | null {
    let n: TElement | null = this.parent
    if (!n) return this instanceof TElement && this.kind === 'root' ? this : null
    while (n.parent) n = n.parent
    return n.kind === 'root' ? n : null
  }

  protected notify() {
    const r = this.root
    r?.host?.requestRender()
  }

  /** Nearest text element ancestor if this node is inline text content. */
  get textContainer(): TElement | null {
    let n = this.parent
    let found: TElement | null = null
    while (n && n.kind === 'text') {
      found = n
      n = n.parent
    }
    return found
  }
}

/**
 * Like DOM nodes, tree nodes are never made reactive: a template ref held in `ref()`
 * must be the node itself, not a proxy (identity checks, WeakMap lookups, the DOM facade).
 */
;(NodeBase.prototype as unknown as Record<string, unknown>).__v_skip = true

export class TTextNode extends NodeBase {
  readonly nodeType = 'text' as const
  private _text: string
  glyphs: Glyph[] | null = null
  constructor(text: string) {
    super()
    this._text = text
  }
  get text() {
    return this._text
  }
  set text(v: string) {
    if (v === this._text) return
    this._text = v
    this.glyphs = null
    const tc = this.textContainer
    if (tc) tc.invalidateText()
    else this.yoga?.markDirty()
    this.notify()
  }
  getGlyphs(): Glyph[] {
    if (this.glyphs) return this.glyphs
    // web flow: collapse white space like CSS `white-space: normal`
    const ws = this.parent?.computedStyle.whiteSpace
    const text = ws === 'normal' || ws === 'nowrap' ? this._text.replace(/\s+/g, ' ').trim() : this._text
    return (this.glyphs = toGlyphs(text, {}))
  }
}

export class TComment extends NodeBase {
  readonly nodeType = 'comment' as const
  constructor(public text: string) {
    super()
  }
}

export type Listener = (...args: any[]) => unknown

export class TElement extends NodeBase {
  readonly nodeType = 'element' as const
  kind: ElementKind
  props: Record<string, any> = {}
  children: TNode[] = []
  host: Host | null = null
  /** Set on the element that owns a style scope (see `StyleScope`). */
  scope: StyleScope | null = null
  /**
   * Web flow only: layout items of a box that mixes block and inline
   * children; consecutive inline children are grouped into `InlineRun`s
   * (CSS anonymous inline boxes). Null for ordinary elements.
   */
  layoutItems: (TNode | InlineRun | LineBox)[] | null = null
  private runs: InlineRun[] = []
  private lines: LineBox[] = []
  /** Positioned by a `LineBox` as a float (its Yoga margin / alignment were changed). */
  private lineFloat = false

  /** resolved style (cached) */
  private _style: Style | null = null
  private _vshowDisplay: string = ''
  private childrenDirty = true
  private styleApplied = false
  private glyphCache: Glyph[] | null = null
  /** Absolute layout from the last frame. */
  layout: LayoutInfo = { x: 0, y: 0, width: 0, height: 0, innerWidth: 0, innerHeight: 0, scrollWidth: 0, scrollHeight: 0 }
  private lastLayoutKey = ''

  /**
   * Inline style written through `el.style` (directives, libraries, `style.setProperty('--x')`),
   * kebab-case property → value. Web pages apply it after the `style` attribute.
   */
  styleOverrides: Map<string, string> | null = null
  private _styleDecl: CSSStyleLike | null = null

  constructor(public readonly tag: string) {
    super()
    this.kind = kindOfTag(tag)
  }

  /** A `CSSStyleDeclaration`-like object (`display` drives Vue's `v-show`). */
  get style(): CSSStyleLike {
    return (this._styleDecl ??= createStyleDecl(this))
  }

  /** @internal used by the `el.style` object */
  _setVshowDisplay(v: string) {
    if (v === this._vshowDisplay) return
    this._vshowDisplay = v
    this.invalidateStyle()
  }
  /** @internal */
  _getVshowDisplay() {
    return this._vshowDisplay
  }

  // ---------------------------------------------------------------- tree

  insertBefore(child: TNode, anchor: TNode | null) {
    // like the DOM (HierarchyRequestError): a node can't go inside itself or its descendants
    if (child.nodeType === 'element' && child.contains(this)) throw new Error('HierarchyRequestError: the new child element contains the parent')
    if (child.parent) child.parent.removeChild(child, false)
    child.parent = this
    const i = anchor ? this.children.indexOf(anchor) : -1
    if (i >= 0) this.children.splice(i, 0, child)
    else this.children.push(child)
    this.childrenChanged()
    scopeOf(this)?.attached(child)
  }

  removeChild(child: TNode, dispose = true) {
    const i = this.children.indexOf(child)
    if (i < 0) return
    scopeOf(this)?.detached(child)
    this.children.splice(i, 1)
    detachYoga(child)
    child.parent = null
    if (dispose) disposeTree(child)
    this.childrenChanged()
  }

  private childrenChanged() {
    this.childrenDirty = true
    if (this.kind === 'text') this.invalidateText()
    scopeOf(this)?.changed(this)
    this.notify()
  }

  /**
   * Switches between box and text layout (web flow: a block whose children
   * are all inline becomes a text block). Drops the Yoga subtree; it is
   * rebuilt on the next layout.
   */
  setKind(kind: ElementKind) {
    if (kind === this.kind) return
    disposeTree(this)
    this.kind = kind
    this._style = null
    this.styleApplied = false
    this.childrenDirty = true
    for (const el of this.walk()) el.glyphCache = null
    if (this.parent) this.parent.childrenDirty = true
    this.notify()
  }

  // ---------------------------------------------------------------- props

  setProp(key: string, value: unknown) {
    if (value === undefined || value === null) delete this.props[key]
    else this.props[key] = value
    const scope = scopeOf(this.parent)
    if (scope) scope.propChanged(this, key, value)
    if (/^on[A-Z]/.test(key)) return
    this.invalidateStyle()
  }

  invalidateStyle() {
    this._style = null
    this.styleApplied = false
    if (this.kind === 'text') this.invalidateText()
    scopeOf(this.parent)?.changed(this)
    this.notify()
  }

  invalidateText() {
    this.glyphCache = null
    // inline spans: the enclosing text block owns the glyph cache
    const tc = this.textContainer
    if (tc && tc !== this) tc.invalidateText()
    else if (this.yoga && this.isLayoutText()) this.yoga.markDirty()
    this.notify()
  }

  get computedStyle(): Style {
    if (this._style) return this._style
    const scope = scopeOf(this.parent)
    if (scope) {
      const ws = scope.style(this)
      if (this._vshowDisplay === 'none') ws.display = 'none'
      return (this._style = ws)
    }
    const s: Style = {}
    const p = this.props
    if (p.class) Object.assign(s, parseClasses(String(p.class)))
    if (p.style) assignStyle(s, typeof p.style === 'string' ? parseStyleString(p.style) : p.style)
    for (const key in p) {
      if (key === 'class' || key === 'style' || key.startsWith('on')) continue
      assignStyle(s, { [key]: p[key] })
    }
    if (this._vshowDisplay === 'none') s.display = 'none'
    return (this._style = s)
  }

  /** Listener(s) registered via `onXxx` props. */
  getListeners(event: string): Listener[] {
    const key = 'on' + event[0].toUpperCase() + event.slice(1)
    const h = this.props[key]
    if (!h) return []
    return Array.isArray(h) ? h : [h]
  }

  hasListener(event: string) {
    return this.getListeners(event).length > 0
  }

  // ---------------------------------------------------------------- text

  /** True if this is a text element laid out as a block (i.e. its parent is not text). */
  isLayoutText() {
    return this.kind === 'text' && (!this.parent || this.parent.kind !== 'text')
  }

  /** Glyphs of the whole text element, including nested spans, with their own ink. */
  getGlyphs(): Glyph[] {
    if (this.glyphCache) return this.glyphCache
    let out: Glyph[] = []
    collectGlyphs(this, mergeInk({}, this.computedStyle), out)
    const ws = this.computedStyle.whiteSpace
    if (ws === 'normal' || ws === 'nowrap') out = collapseSpaces(out)
    return (this.glyphCache = out)
  }

  // ---------------------------------------------------------------- layout

  /**
   * Builds/updates the Yoga tree for this subtree. Called once per frame before
   * `calculateLayout`.
   */
  prepareLayout() {
    this.scope?.flush()
    const yoga = (this.yoga ??= Yoga.Node.create(yogaConfig))
    if (!this.styleApplied) {
      applyYogaStyle(yoga, this.computedStyle, this.kind)
      this.styleApplied = true
    }
    if (this.kind === 'text') {
      if (!hasMeasure.has(yoga)) setTextMeasure(yoga, () => this.getGlyphs(), () => this.computedStyle.wrap)
      // inline children never get yoga nodes
      for (const c of this.children) releaseYogaTree(c)
      return
    }
    if (this.computedStyle.whiteSpace !== undefined) return this.prepareFlowLayout(yoga)
    for (const c of this.children) {
      if (c.nodeType === 'element') c.prepareLayout()
      else if (c.nodeType === 'text') prepareTextNode(c)
    }
    if (this.childrenDirty) {
      while (yoga.getChildCount() > 0) yoga.removeChild(yoga.getChild(0))
      let i = 0
      for (const c of this.children) {
        if (c.yoga) yoga.insertChild(c.yoga, i++)
      }
      this.childrenDirty = false
    }
  }

  /** Web flow: block children get their own Yoga nodes, inline runs one text node each. */
  private prepareFlowLayout(yoga: YogaNode) {
    const items: (TNode | InlineRun)[] = []
    const runs: InlineRun[] = []
    let run: InlineRun | null = null
    for (const c of this.children) {
      if (c.nodeType === 'comment') continue
      if (isInlineMember(c, this)) {
        if (!run) {
          run = this.runs[runs.length] ?? new InlineRun(this)
          run.members = []
          runs.push(run)
          items.push(run)
        }
        run.members.push(c)
        releaseYogaTree(c)
        continue
      }
      run = null
      if (c.nodeType === 'element') {
        c.prepareLayout()
        items.push(c)
      } else if (c.nodeType === 'text') {
        prepareTextNode(c)
        items.push(c)
      }
    }
    for (const r of this.runs.slice(runs.length)) r.free()
    this.runs = runs
    // runs with nothing visible (formatting whitespace) take no space
    const visible = items.filter((it) => !(it instanceof InlineRun) || it.update())

    // inline-level items that include an inline-block box or a float share line boxes
    const out: (TNode | InlineRun | LineBox)[] = []
    const lines: LineBox[] = []
    let group: (InlineRun | TElement)[] = []
    let linesChanged = false
    const flush = () => {
      if (group.length >= 2 && group.some((it) => !(it instanceof InlineRun))) {
        const line = this.lines[lines.length] ?? new LineBox()
        if (line.setItems(group)) linesChanged = true
        lines.push(line)
        out.push(line)
      } else out.push(...group)
      group = []
    }
    for (const it of visible) {
      if (it instanceof InlineRun || (it.nodeType === 'element' && isLineLevel(it))) group.push(it)
      else {
        flush()
        out.push(it)
      }
    }
    flush()
    if (this.lines.length !== lines.length) linesChanged = true
    for (const l of this.lines.slice(lines.length)) l.free()
    this.lines = lines

    // floats keep the line box's placement only while they are in one
    const inLine = new Set<TElement>()
    for (const l of lines) for (const it of l.items) if (it instanceof TElement) inLine.add(it)
    for (const it of visible) {
      if (!(it instanceof TElement)) continue
      if (inLine.has(it)) it.lineFloat = !!it.computedStyle.float
      else if (it.lineFloat) {
        it.lineFloat = false
        applyYogaStyle(it.yoga!, it.computedStyle, it.kind)
      }
    }
    for (const l of lines) l.placeFloats()

    const prev = this.layoutItems
    const same = !!prev && prev.length === out.length && prev.every((p, i) => p === out[i])
    if (this.childrenDirty || !same || linesChanged) {
      while (yoga.getChildCount() > 0) yoga.removeChild(yoga.getChild(0))
      for (const l of lines) l.attach()
      let i = 0
      for (const it of out) {
        if (!it.yoga) continue
        detachYogaNode(it.yoga)
        yoga.insertChild(it.yoga, i++)
      }
      this.childrenDirty = false
    }
    this.layoutItems = out
  }

  calculateLayout(width: number, height: number) {
    this.prepareLayout()
    this.yoga!.calculateLayout(width, height, Direction.LTR)
  }

  /**
   * Called by the painter with the absolute position; fires `onLayout` when the
   * geometry changed.
   */
  updateLayout(info: LayoutInfo) {
    this.layout = info
    const key = `${info.x},${info.y},${info.width},${info.height},${info.innerWidth},${info.innerHeight},${info.scrollWidth},${info.scrollHeight}`
    if (key !== this.lastLayoutKey) {
      this.lastLayoutKey = key
      const ls = this.getListeners('layout')
      if (ls.length) queueMicrotask(() => ls.forEach((l) => l({ ...info })))
    }
  }

  /** Depth-first iteration. */
  *walk(): Generator<TElement> {
    yield this
    for (const c of this.children) if (c.nodeType === 'element') yield* c.walk()
  }

  contains(node: TNode | null): boolean {
    let n: TNode | null = node
    while (n) {
      if (n === this) return true
      n = n.parent
    }
    return false
  }

  /** Plain text content (for testing / debugging). */
  get textContent(): string {
    return this.children
      .map((c) => (c.nodeType === 'text' ? c.text : c.nodeType === 'element' ? c.textContent : ''))
      .join('')
  }
}

const hasMeasure = new WeakSet<YogaNode>()

/** What `el.style` offers: named properties plus the CSSStyleDeclaration methods. */
export type CSSStyleLike = Record<string, unknown> & {
  display: string
  cssText: string
  setProperty(name: string, value: string | null, priority?: string): void
  removeProperty(name: string): string
  getPropertyValue(name: string): string
}

const kebab = (p: string) => (p.startsWith('--') ? p : p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()))

function createStyleDecl(el: TElement): CSSStyleLike {
  const write = (prop: string, value: unknown) => {
    const k = kebab(prop)
    const v = value === null || value === undefined ? '' : String(value).trim()
    const map = (el.styleOverrides ??= new Map())
    if ((map.get(k) ?? '') === v) return
    if (v) map.set(k, v)
    else map.delete(k)
    el.invalidateStyle()
    // inherited values and custom properties reach the whole subtree
    scopeOf(el)?.propChanged?.(el, 'style:override', k)
  }
  const methods = {
    setProperty: (name: string, value: string | null) => write(name, value),
    removeProperty: (name: string) => {
      const old = el.styleOverrides?.get(kebab(name)) ?? ''
      write(name, '')
      return old
    },
    getPropertyValue: (name: string) => el.styleOverrides?.get(kebab(name)) ?? '',
  }
  return new Proxy(methods as unknown as CSSStyleLike, {
    get(t, key) {
      if (typeof key !== 'string') return undefined
      if (key in t) return (t as Record<string, unknown>)[key]
      if (key === 'display') return el._getVshowDisplay()
      if (key === 'cssText') return [...(el.styleOverrides ?? [])].map(([k, v]) => `${k}: ${v}`).join('; ')
      if (key === 'length') return el.styleOverrides?.size ?? 0
      return el.styleOverrides?.get(kebab(key)) ?? ''
    },
    set(_t, key, value) {
      if (typeof key !== 'string') return true
      if (key === 'display') el._setVshowDisplay(String(value ?? ''))
      else if (key === 'cssText') {
        el.styleOverrides?.clear()
        for (const part of String(value ?? '').split(';')) {
          const i = part.indexOf(':')
          if (i > 0) write(part.slice(0, i).trim(), part.slice(i + 1))
        }
        el.invalidateStyle()
      } else write(key, value)
      return true
    },
  })
}

/** Inline-level child of a web flow box: text, or an inline element laid out as text. */
function isInlineMember(c: TNode, parent: TElement): boolean {
  if (c.nodeType === 'text') return parent.computedStyle.whiteSpace !== undefined
  if (c.nodeType !== 'element') return false
  const s = c.computedStyle
  if (s.display === 'none') return true
  return !!s.inline && c.kind === 'text' && s.position !== 'absolute'
}

/**
 * Shares a line with text: an inline-block box (`display: inline-block` with block
 * content) or a float. Inline elements laid out as text are part of `InlineRun`s instead,
 * and a plain `display: inline` element with block content is split by it (CSS
 * block-in-inline), so it keeps a line of its own.
 */
function isLineLevel(el: TElement): boolean {
  const s = el.computedStyle
  if (s.display === 'none' || s.position === 'absolute') return false
  return !!s.float || (!!s.inlineBlock && el.kind !== 'text')
}

function detachYogaNode(node: YogaNode) {
  const p = node.getParent()
  if (p) p.removeChild(node)
}

/**
 * An anonymous line box of a web flow container: a wrapping row of text runs,
 * inline-block boxes and floats (CSS inline formatting context). Left floats
 * start the line and right floats end it, the rest keeps document order.
 */
export class LineBox {
  readonly yoga: YogaNode = Yoga.Node.create(yogaConfig)
  /** In layout order. */
  items: (InlineRun | TElement)[] = []

  constructor() {
    this.yoga.setFlexDirection(FlexDirection.Row)
    this.yoga.setFlexWrap(Wrap.Wrap)
    this.yoga.setAlignItems(Align.FlexStart)
    this.yoga.setFlexShrink(1)
  }

  /** Sets the members (document order); returns true when the layout order changed. */
  setItems(members: (InlineRun | TElement)[]): boolean {
    const side = (it: InlineRun | TElement) => (it instanceof TElement ? it.computedStyle.float : undefined)
    const left = members.filter((it) => side(it) === 'left')
    const right = members.filter((it) => side(it) === 'right').reverse() // the first right float is rightmost
    const rest = members.filter((it) => !side(it))
    const next = [...left, ...rest, ...right]
    const changed = next.length !== this.items.length || next.some((it, i) => it !== this.items[i])
    this.items = next
    return changed
  }

  /** Floats sit at the top of the line; the first right float pushes the rest to the right. */
  placeFloats() {
    let pushed = false
    for (const it of this.items) {
      if (!(it instanceof TElement) || !it.computedStyle.float) continue
      const y = it.yoga!
      y.setAlignSelf(Align.FlexStart)
      if (it.computedStyle.float === 'right' && !pushed) {
        y.setMarginAuto(Edge.Left)
        pushed = true
      }
    }
  }

  /** (Re)inserts the members' Yoga nodes in layout order. */
  attach() {
    while (this.yoga.getChildCount() > 0) this.yoga.removeChild(this.yoga.getChild(0))
    let i = 0
    for (const it of this.items) {
      detachYogaNode(it.yoga!)
      this.yoga.insertChild(it.yoga!, i++)
    }
  }

  free() {
    while (this.yoga.getChildCount() > 0) this.yoga.removeChild(this.yoga.getChild(0))
    detachYogaNode(this.yoga)
    this.yoga.free()
  }
}

/** Consecutive inline children of a box, laid out and painted as one wrapped text block. */
export class InlineRun {
  readonly yoga: YogaNode = Yoga.Node.create(yogaConfig)
  members: TNode[] = []
  glyphs: Glyph[] = []
  private sig = ''

  constructor(readonly owner: TElement) {
    this.yoga.setFlexShrink(1)
    setTextMeasure(this.yoga, () => this.glyphs, () => owner.computedStyle.wrap)
  }

  /** Recollects glyphs; returns false when the run has nothing to show. */
  update(): boolean {
    const out: Glyph[] = []
    collectList(this.owner, this.members, {}, out)
    const ws = this.owner.computedStyle.whiteSpace
    this.glyphs = ws === 'normal' || ws === 'nowrap' ? collapseSpaces(out) : out
    let sig = ''
    for (const g of this.glyphs) sig += g.ch
    if (sig !== this.sig) {
      this.sig = sig
      this.yoga.markDirty()
    }
    return this.glyphs.length > 0
  }

  free() {
    const p = this.yoga.getParent()
    if (p) p.removeChild(this.yoga)
    hasMeasure.delete(this.yoga)
    this.yoga.free()
  }
}

/** The width each text node was last measured (wrapped) with. */
const measuredMax = new WeakMap<YogaNode, number>()

/**
 * Width to wrap a text node's glyphs at when painting: the one its height was measured
 * with. Yoga rounds measured boxes up to whole cells, so in a fractional-width container
 * the box can be a cell wider than the text had; wrapping at the box width would join
 * lines differently and push the last characters past the container's edge.
 */
export function measuredWrapWidth(yoga: YogaNode): number {
  return Math.floor((measuredMax.get(yoga) ?? Infinity) + 1e-6)
}

function setTextMeasure(yoga: YogaNode, glyphs: () => Glyph[], wrap: () => WrapMode | undefined) {
  hasMeasure.add(yoga)
  yoga.setMeasureFunc((width, widthMode) => {
    const max = widthMode === MeasureMode.Undefined ? Infinity : width
    if (widthMode !== MeasureMode.Undefined) measuredMax.set(yoga, max)
    const m = measureGlyphs(glyphs(), max, wrap() ?? 'wrap')
    return { width: Math.min(m.width, max), height: m.height }
  })
}

function prepareTextNode(t: TTextNode) {
  if (!t.yoga) {
    t.yoga = Yoga.Node.create(yogaConfig)
    t.yoga.setFlexShrink(1)
    setTextMeasure(t.yoga, () => t.getGlyphs(), () => undefined)
  }
  // whitespace-only text directly inside a box is template formatting, not content
  t.yoga.setDisplay(/^\s*$/.test(t.text) ? Display.None : Display.Flex)
}

function pushSegments(segs: Segment[] | string, ink: Ink, out: Glyph[], src: TElement) {
  const start = out.length
  if (typeof segs === 'string') toGlyphs(segs, ink, out)
  else for (const seg of segs) toGlyphs(seg.text, seg.ink ? mergeInk(ink, seg.ink) : ink, out)
  // generated content (widget chrome, padding) is never collapsed
  for (let i = start; i < out.length; i++) {
    out[i].src = src
    out[i].keep = true
  }
}

function collectGlyphs(el: TElement, ink: Ink, out: Glyph[]) {
  const s = el.computedStyle
  if (s.content !== undefined) return pushSegments(s.content, ink, out, el)
  if (s.before) pushSegments(s.before, ink, out, el)
  collectList(el, el.children, ink, out)
  if (s.after) pushSegments(s.after, ink, out, el)
}

/** Glyphs of `nodes` (children of `el`, or a run of them). */
function collectList(el: TElement, nodes: TNode[], ink: Ink, out: Glyph[]) {
  const s = el.computedStyle
  const collapse = s.whiteSpace === 'normal' || s.whiteSpace === 'nowrap'
  for (const c of nodes) {
    if (c.nodeType === 'text') {
      const start = out.length
      let text = collapse ? c.text.replace(/[ \t\n\r\f]+/g, ' ') : c.text
      // white-space: nowrap inside a wrapping run: its spaces must not become line breaks
      if (s.whiteSpace === 'nowrap' && el.computedStyle.inline) text = text.replace(/ /g, '\u00a0')
      toGlyphs(text, ink, out)
      for (let i = start; i < out.length; i++) out[i].src = el
    } else if (c.nodeType === 'element') {
      if (c.computedStyle.display === 'none') continue
      if (c.tag === 'tui-newline' || c.tag === 'br') {
        const n = Number(c.props.count ?? 1)
        for (let i = 0; i < n; i++) out.push({ ch: '\n', w: 0, ink })
        continue
      }
      const cs = c.computedStyle
      const cink = mergeInk(ink, cs)
      if (cs.whiteSpace !== undefined) {
        // web flow: an inline element's horizontal margin / padding become spaces, a border
        // brackets. Padding goes inside the brackets (one cell less: the bracket stands for it)
        const boxed = !!cs.border && cs.border !== 'none' && !c.computedStyle.content
        const pad = (p: number | undefined) => (boxed ? Math.max(0, (p ?? 0) - 1) : (p ?? 0))
        const outerL = ' '.repeat((cs.marginLeft ?? 0) + (boxed ? 0 : pad(cs.paddingLeft)))
        const outerR = ' '.repeat((cs.marginRight ?? 0) + (boxed ? 0 : pad(cs.paddingRight)))
        // no-break spaces: a line never breaks between a bracket and its content
        const innerL = boxed ? '\u00a0'.repeat(pad(cs.paddingLeft)) : ''
        const innerR = boxed ? '\u00a0'.repeat(pad(cs.paddingRight)) : ''
        const bracket = mergeInk(ink, { color: cs.borderColor ?? cs.color })
        if (outerL) pushSegments(outerL, ink, out, c)
        if (boxed) pushSegments('[' + innerL, bracket, out, c)
        collectGlyphs(c, cink, out)
        if (boxed) pushSegments(innerR + ']', bracket, out, c)
        if (outerR) pushSegments(outerR, ink, out, c)
        continue
      }
      collectGlyphs(c, cink, out)
    }
  }
}

/** CSS white-space collapsing across inline boundaries: no leading/trailing or double spaces. */
function collapseSpaces(glyphs: Glyph[]): Glyph[] {
  const out: Glyph[] = []
  for (const g of glyphs) {
    if (g.ch === ' ' && !g.keep) {
      const prev = out[out.length - 1]
      if (!prev || prev.ch === ' ' || prev.ch === '\n') continue
    } else if (g.ch === '\n') {
      while (out.length && out[out.length - 1].ch === ' ' && !out[out.length - 1].keep) out.pop()
    }
    out.push(g)
  }
  while (out.length && out[out.length - 1].ch === ' ' && !out[out.length - 1].keep) out.pop()
  return out
}

function detachYoga(n: TNode) {
  const y = n.yoga
  if (!y) return
  const p = y.getParent()
  if (p) p.removeChild(y)
}

function releaseYogaTree(n: TNode) {
  if (!n.yoga) return
  disposeTree(n)
}

/** Frees yoga nodes of a removed subtree. */
export function disposeTree(n: TNode) {
  if (n.nodeType === 'element') for (const c of n.children) disposeTree(c)
  if (n.yoga) {
    detachYoga(n)
    // detach any remaining yoga children so free() doesn't touch them
    while (n.yoga.getChildCount() > 0) n.yoga.removeChild(n.yoga.getChild(0))
    hasMeasure.delete(n.yoga)
    n.yoga.free()
    n.yoga = null
  }
  if (n.nodeType === 'element') {
    ;(n as any).childrenDirty = true
    ;(n as any).styleApplied = false
  }
}

// ------------------------------------------------------------------ yoga style

const FLEX_DIRECTION = {
  row: FlexDirection.Row,
  column: FlexDirection.Column,
  'row-reverse': FlexDirection.RowReverse,
  'column-reverse': FlexDirection.ColumnReverse,
}
const ALIGN: Record<string, Align> = {
  auto: Align.Auto,
  'flex-start': Align.FlexStart,
  start: Align.FlexStart,
  'flex-end': Align.FlexEnd,
  end: Align.FlexEnd,
  center: Align.Center,
  stretch: Align.Stretch,
  baseline: Align.Baseline,
  'space-between': Align.SpaceBetween,
  'space-around': Align.SpaceAround,
}
const JUSTIFY: Record<string, Justify> = {
  'flex-start': Justify.FlexStart,
  start: Justify.FlexStart,
  'flex-end': Justify.FlexEnd,
  end: Justify.FlexEnd,
  center: Justify.Center,
  'space-between': Justify.SpaceBetween,
  'space-around': Justify.SpaceAround,
  'space-evenly': Justify.SpaceEvenly,
}

export function hasBorder(s: Style) {
  return !!s.border && s.border !== 'none'
}

export function borderEdges(s: Style) {
  const on = hasBorder(s)
  return {
    top: on && s.borderTop !== false ? 1 : 0,
    right: on && s.borderRight !== false ? 1 : 0,
    bottom: on && s.borderBottom !== false ? 1 : 0,
    left: on && s.borderLeft !== false ? 1 : 0,
  }
}

function applyYogaStyle(y: YogaNode, s: Style, kind: ElementKind) {
  y.setDisplay(s.display === 'none' ? Display.None : Display.Flex)
  y.setPositionType(s.position === 'absolute' ? PositionType.Absolute : PositionType.Relative)
  y.setPosition(Edge.Top, s.top as any)
  y.setPosition(Edge.Left, s.left as any)
  y.setPosition(Edge.Right, s.right as any)
  y.setPosition(Edge.Bottom, s.bottom as any)

  y.setFlexDirection(FLEX_DIRECTION[s.flexDirection ?? (kind === 'root' ? 'column' : 'row')])
  y.setFlexWrap(s.flexWrap === 'wrap' ? Wrap.Wrap : s.flexWrap === 'wrap-reverse' ? Wrap.WrapReverse : Wrap.NoWrap)
  y.setFlexGrow(s.flexGrow ?? 0)
  y.setFlexShrink(s.flexShrink ?? 1)
  y.setFlexBasis((s.flexBasis ?? 'auto') as any)
  y.setAlignItems(ALIGN[s.alignItems ?? 'stretch'] ?? Align.Stretch)
  y.setAlignSelf(ALIGN[s.alignSelf ?? 'auto'] ?? Align.Auto)
  y.setAlignContent(ALIGN[s.alignContent ?? 'flex-start'] ?? Align.FlexStart)
  y.setJustifyContent(JUSTIFY[s.justifyContent ?? 'flex-start'] ?? Justify.FlexStart)

  y.setWidth((s.width ?? 'auto') as any)
  y.setHeight((s.height ?? 'auto') as any)
  y.setMinWidth(s.minWidth as any)
  y.setMinHeight(s.minHeight as any)
  y.setMaxWidth(s.maxWidth as any)
  y.setMaxHeight(s.maxHeight as any)

  y.setPadding(Edge.All, s.padding ?? 0)
  y.setPadding(Edge.Horizontal, s.paddingX)
  y.setPadding(Edge.Vertical, s.paddingY)
  y.setPadding(Edge.Top, s.paddingTop)
  y.setPadding(Edge.Right, s.paddingRight)
  y.setPadding(Edge.Bottom, s.paddingBottom)
  y.setPadding(Edge.Left, s.paddingLeft)

  y.setMargin(Edge.All, s.margin ?? 0)
  y.setMargin(Edge.Horizontal, s.marginX)
  y.setMargin(Edge.Vertical, s.marginY)
  y.setMargin(Edge.Top, s.marginTop)
  y.setMargin(Edge.Right, s.marginRight)
  y.setMargin(Edge.Bottom, s.marginBottom)
  y.setMargin(Edge.Left, s.marginLeft)

  y.setGap(Gutter.All, s.gap ?? 0)
  if (s.rowGap !== undefined) y.setGap(Gutter.Row, s.rowGap)
  if (s.columnGap !== undefined) y.setGap(Gutter.Column, s.columnGap)

  const b = borderEdges(s)
  y.setBorder(Edge.Top, b.top)
  y.setBorder(Edge.Right, b.right)
  y.setBorder(Edge.Bottom, b.bottom)
  y.setBorder(Edge.Left, b.left)

  y.setOverflow(s.overflow === 'hidden' ? Overflow.Hidden : Overflow.Visible)
}

export function createRoot(host: Host): TElement {
  const root = new TElement('tui-root')
  root.host = host
  return root
}

/** Finds the element with the given `id` prop. */
export function getElementById(root: TElement, id: string): TElement | null {
  for (const el of root.walk()) if (el.props.id === id) return el
  return null
}
