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
import { assignStyle, parseStyleString, type Ink, type Style, mergeInk } from '../style/style.js'
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
    return (this.glyphs ??= toGlyphs(this._text, {}))
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
  readonly kind: ElementKind
  props: Record<string, any> = {}
  children: TNode[] = []
  host: Host | null = null

  /** resolved style (cached) */
  private _style: Style | null = null
  private _vshowDisplay: string = ''
  private childrenDirty = true
  private styleApplied = false
  private glyphCache: Glyph[] | null = null
  /** Absolute layout from the last frame. */
  layout: LayoutInfo = { x: 0, y: 0, width: 0, height: 0, innerWidth: 0, innerHeight: 0, scrollWidth: 0, scrollHeight: 0 }
  private lastLayoutKey = ''

  /** Minimal `style` shim so Vue's `v-show` directive works on terminal elements. */
  readonly style: { display: string }

  constructor(public readonly tag: string) {
    super()
    this.kind = kindOfTag(tag)
    const self = this
    this.style = {
      get display() {
        return self._vshowDisplay
      },
      set display(v: string) {
        if (v === self._vshowDisplay) return
        self._vshowDisplay = v
        self.invalidateStyle()
      },
    }
  }

  // ---------------------------------------------------------------- tree

  insertBefore(child: TNode, anchor: TNode | null) {
    if (child.parent) child.parent.removeChild(child, false)
    child.parent = this
    const i = anchor ? this.children.indexOf(anchor) : -1
    if (i >= 0) this.children.splice(i, 0, child)
    else this.children.push(child)
    this.childrenChanged()
  }

  removeChild(child: TNode, dispose = true) {
    const i = this.children.indexOf(child)
    if (i < 0) return
    this.children.splice(i, 1)
    detachYoga(child)
    child.parent = null
    if (dispose) disposeTree(child)
    this.childrenChanged()
  }

  private childrenChanged() {
    this.childrenDirty = true
    if (this.kind === 'text') this.invalidateText()
    this.notify()
  }

  // ---------------------------------------------------------------- props

  setProp(key: string, value: unknown) {
    if (value === undefined || value === null) delete this.props[key]
    else this.props[key] = value
    if (/^on[A-Z]/.test(key)) return
    this.invalidateStyle()
  }

  invalidateStyle() {
    this._style = null
    this.styleApplied = false
    if (this.kind === 'text') this.invalidateText()
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
    const out: Glyph[] = []
    collectGlyphs(this, mergeInk({}, this.computedStyle), out)
    return (this.glyphCache = out)
  }

  // ---------------------------------------------------------------- layout

  /**
   * Builds/updates the Yoga tree for this subtree. Called once per frame before
   * `calculateLayout`.
   */
  prepareLayout() {
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

function setTextMeasure(yoga: YogaNode, glyphs: () => Glyph[], wrap: () => WrapMode | undefined) {
  hasMeasure.add(yoga)
  yoga.setMeasureFunc((width, widthMode) => {
    const max = widthMode === MeasureMode.Undefined ? Infinity : width
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

function collectGlyphs(el: TElement, ink: Ink, out: Glyph[]) {
  for (const c of el.children) {
    if (c.nodeType === 'text') toGlyphs(c.text, ink, out)
    else if (c.nodeType === 'element') {
      if (c.computedStyle.display === 'none') continue
      if (c.tag === 'tui-newline' || c.tag === 'br') {
        const n = Number(c.props.count ?? 1)
        for (let i = 0; i < n; i++) out.push({ ch: '\n', w: 0, ink })
        continue
      }
      collectGlyphs(c, mergeInk(ink, c.computedStyle), out)
    }
  }
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
