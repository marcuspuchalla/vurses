/**
 * Minimal DOM Element (enough for canvas apps): tree, attributes, style,
 * classList, dataset, simple selectors, bounding rects and event propagation.
 */
import { EventTarget, Event } from './events.js'

export interface DOMRectLike {
  x: number; y: number; width: number; height: number
  left: number; top: number; right: number; bottom: number
  toJSON(): unknown
}

export function makeRect(x: number, y: number, width: number, height: number): DOMRectLike {
  return {
    x, y, width, height, left: x, top: y, right: x + width, bottom: y + height,
    toJSON() { return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height } },
  }
}

/** A CSSStyleDeclaration-ish object: arbitrary properties + setProperty/getPropertyValue/cssText. */
export function createStyle(): Record<string, any> {
  const props: Record<string, string> = {}
  const camel = (s: string) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  const target = {
    setProperty(name: string, value: string) { props[camel(name)] = String(value) },
    getPropertyValue(name: string) { return props[camel(name)] ?? '' },
    removeProperty(name: string) { const v = props[camel(name)] ?? ''; delete props[camel(name)]; return v },
    get cssText() {
      return Object.entries(props).map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}: ${v};`).join(' ')
    },
    set cssText(v: string) {
      for (const k in props) delete props[k]
      for (const decl of String(v).split(';')) {
        const i = decl.indexOf(':')
        if (i > 0) props[camel(decl.slice(0, i).trim())] = decl.slice(i + 1).trim()
      }
    },
  }
  return new Proxy(target as Record<string, any>, {
    get(t, k) { return k in t ? t[k as string] : typeof k === 'string' ? props[k] ?? '' : undefined },
    set(t, k, v) {
      if (k === 'cssText') t.cssText = v
      else props[k as string] = String(v)
      return true
    },
  })
}

class ClassList {
  constructor(private el: Element) {}
  private get list() { return this.el.className.split(/\s+/).filter(Boolean) }
  private set list(v: string[]) { this.el.className = v.join(' ') }
  get length() { return this.list.length }
  contains(c: string) { return this.list.includes(c) }
  add(...c: string[]) { this.list = [...new Set([...this.list, ...c])] }
  remove(...c: string[]) { this.list = this.list.filter((x) => !c.includes(x)) }
  toggle(c: string, force?: boolean) {
    const has = this.contains(c)
    const want = force ?? !has
    if (want && !has) this.add(c)
    if (!want && has) this.remove(c)
    return want
  }
  item(i: number) { return this.list[i] ?? null }
  toString() { return this.el.className }
  [Symbol.iterator]() { return this.list[Symbol.iterator]() }
}

export class Element extends EventTarget {
  static readonly ELEMENT_NODE = 1
  readonly nodeType: number = 1
  readonly tagName: string
  readonly localName: string
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml'
  parentNode: Element | null = null
  ownerDocument: any = null
  children: Element[] = []
  style: Record<string, any> = createStyle()
  readonly classList: ClassList
  readonly dataset: Record<string, string> = {}
  /** @internal */ _attrs = new Map<string, string>()
  /** @internal */ _text = ''
  /** @internal Host-provided layout rect (CSS px). */
  _rect: { x: number; y: number; width: number; height: number } | null = null
  tabIndex = -1
  hidden = false

  constructor(tagName: string) {
    super()
    this.tagName = tagName.toUpperCase()
    this.localName = tagName.toLowerCase()
    this.classList = new ClassList(this)
  }

  get nodeName() { return this.tagName }
  get id() { return this._attrs.get('id') ?? '' }
  set id(v: string) { this._attrs.set('id', String(v)) }
  get className() { return this._attrs.get('class') ?? '' }
  set className(v: string) { this._attrs.set('class', String(v)) }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null }
  get childNodes() { return this.children }
  get firstChild() { return this.children[0] ?? null }
  get lastChild() { return this.children[this.children.length - 1] ?? null }
  get firstElementChild() { return this.firstChild }
  get lastElementChild() { return this.lastChild }
  get childElementCount() { return this.children.length }
  get nextSibling() {
    const p = this.parentNode
    return p ? p.children[p.children.indexOf(this) + 1] ?? null : null
  }
  get previousSibling() {
    const p = this.parentNode
    return p ? p.children[p.children.indexOf(this) - 1] ?? null : null
  }
  get nextElementSibling() { return this.nextSibling }
  get previousElementSibling() { return this.previousSibling }
  get isConnected(): boolean {
    let n: Element | null = this
    while (n.parentNode) n = n.parentNode
    return n.nodeType === 9
  }
  get textContent(): string { return this._text + this.children.map((c) => c.textContent).join('') }
  set textContent(v: string) {
    for (const c of this.children) c.parentNode = null
    this.children = []
    this._text = String(v ?? '')
  }
  get innerText() { return this.textContent }
  set innerText(v: string) { this.textContent = v }
  get innerHTML() { return this._text }
  set innerHTML(v: string) { this.textContent = String(v).replace(/<[^>]*>/g, '') }

  getAttribute(name: string): string | null {
    return this._attrs.get(name.toLowerCase()) ?? null
  }
  setAttribute(name: string, value: string) {
    const n = name.toLowerCase()
    this._attrs.set(n, String(value))
    if (n === 'style') this.style.cssText = String(value)
    if (n.startsWith('data-')) this.dataset[n.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value)
    if (n === 'tabindex') this.tabIndex = parseInt(String(value), 10) || 0
  }
  removeAttribute(name: string) { this._attrs.delete(name.toLowerCase()) }
  hasAttribute(name: string) { return this._attrs.has(name.toLowerCase()) }
  getAttributeNames() { return [...this._attrs.keys()] }
  toggleAttribute(name: string, force?: boolean) {
    const want = force ?? !this.hasAttribute(name)
    if (want) this.setAttribute(name, '')
    else this.removeAttribute(name)
    return want
  }

  appendChild<T extends Element>(child: T): T {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    child.ownerDocument = this.ownerDocument ?? (this.nodeType === 9 ? this : null)
    this.children.push(child)
    return child
  }
  insertBefore<T extends Element>(child: T, ref: Element | null): T {
    if (!ref) return this.appendChild(child)
    if (child.parentNode) child.parentNode.removeChild(child)
    const i = this.children.indexOf(ref)
    child.parentNode = this
    child.ownerDocument = this.ownerDocument
    this.children.splice(i < 0 ? this.children.length : i, 0, child)
    return child
  }
  removeChild<T extends Element>(child: T): T {
    const i = this.children.indexOf(child)
    if (i >= 0) this.children.splice(i, 1)
    child.parentNode = null
    return child
  }
  replaceChild<T extends Element>(child: Element, old: T): T {
    this.insertBefore(child, old)
    return this.removeChild(old)
  }
  append(...nodes: (Element | string)[]) {
    for (const n of nodes) {
      if (typeof n === 'string') this._text += n
      else this.appendChild(n)
    }
  }
  prepend(...nodes: (Element | string)[]) {
    for (const n of nodes.reverse()) {
      if (typeof n === 'string') this._text = n + this._text
      else this.insertBefore(n, this.firstChild)
    }
  }
  replaceChildren(...nodes: (Element | string)[]) {
    this.textContent = ''
    this.append(...nodes)
  }
  remove() { this.parentNode?.removeChild(this) }
  contains(other: Element | null): boolean {
    for (let n = other; n; n = n.parentNode) if (n === this) return true
    return false
  }
  cloneNode(deep = false): Element {
    const c = new Element(this.localName)
    for (const [k, v] of this._attrs) c.setAttribute(k, v)
    if (deep) for (const ch of this.children) c.appendChild(ch.cloneNode(true))
    return c
  }

  matches(selector: string): boolean { return matchesSelector(this, selector) }
  closest(selector: string): Element | null {
    for (let n: Element | null = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(selector)) return n
    return null
  }
  querySelector(selector: string): Element | null {
    for (const el of this.descendants()) if (matchesSelector(el, selector)) return el
    return null
  }
  querySelectorAll(selector: string): Element[] {
    return [...this.descendants()].filter((el) => matchesSelector(el, selector))
  }
  getElementsByTagName(tag: string): Element[] {
    const t = tag.toUpperCase()
    return [...this.descendants()].filter((el) => t === '*' || el.tagName === t)
  }
  getElementsByClassName(cls: string): Element[] {
    const want = cls.split(/\s+/).filter(Boolean)
    return [...this.descendants()].filter((el) => want.every((c) => el.classList.contains(c)))
  }
  getElementById(id: string): Element | null {
    for (const el of this.descendants()) if (el.id === id) return el
    return null
  }
  *descendants(): Generator<Element> {
    for (const c of this.children) {
      yield c
      yield* c.descendants()
    }
  }

  getBoundingClientRect(): DOMRectLike {
    const r = this._rect ?? this._defaultRect()
    return makeRect(r.x, r.y, r.width, r.height)
  }
  getClientRects() { return [this.getBoundingClientRect()] }
  /** @internal */
  _defaultRect() {
    const p = this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode.getBoundingClientRect() : null
    return p ? { x: p.x, y: p.y, width: p.width, height: 0 } : { x: 0, y: 0, width: 0, height: 0 }
  }
  get clientWidth() { return Math.round(this.getBoundingClientRect().width) }
  get clientHeight() { return Math.round(this.getBoundingClientRect().height) }
  get offsetWidth() { return this.clientWidth }
  get offsetHeight() { return this.clientHeight }
  get offsetLeft() { return Math.round(this.getBoundingClientRect().left) }
  get offsetTop() { return Math.round(this.getBoundingClientRect().top) }
  get scrollWidth() { return this.clientWidth }
  get scrollHeight() { return this.clientHeight }
  scrollTop = 0
  scrollLeft = 0
  get offsetParent() { return this.parentElement }

  focus() {
    const doc = this.ownerDocument
    if (doc && doc._activeElement !== this) {
      const prev = doc._activeElement
      doc._activeElement = this
      prev?.dispatchEvent(new Event('blur'))
      this.dispatchEvent(new Event('focus'))
    }
  }
  blur() {
    const doc = this.ownerDocument
    if (doc && doc._activeElement === this) {
      doc._activeElement = null
      this.dispatchEvent(new Event('blur'))
    }
  }
  click() {
    // dynamic import avoided: MouseEvent lives in events.js
    this.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
  }
  scrollIntoView() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false }
  requestPointerLock() { return Promise.resolve() }
  requestFullscreen() { return Promise.resolve() }
  animate() { return { cancel() {}, finish() {}, finished: Promise.resolve() } }

  /** @internal */
  override _eventParent(): EventTarget | null {
    if (this.parentNode) return this.parentNode
    return null
  }
}

// ---------------------------------------------------------------- selectors

interface Compound {
  tag?: string
  id?: string
  classes: string[]
  attrs: { name: string; op?: string; value?: string }[]
}

const selectorCache = new Map<string, { parts: Compound[]; combinators: string[] }[]>()

function parseSelector(sel: string) {
  let parsed = selectorCache.get(sel)
  if (parsed) return parsed
  parsed = sel.split(',').map((s) => {
    const tokens = s.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean)
    const parts: Compound[] = []
    const combinators: string[] = []
    let pending = ' '
    for (const t of tokens) {
      if (t === '>') {
        pending = '>'
        continue
      }
      const c: Compound = { classes: [], attrs: [] }
      const re = /([#.]?)([\w-]+|\*)|\[([\w-]+)(?:([~|^$*]?=)["']?([^\]"']*)["']?)?\]/g
      let m: RegExpExecArray | null
      while ((m = re.exec(t))) {
        if (m[3]) c.attrs.push({ name: m[3].toLowerCase(), op: m[4], value: m[5] })
        else if (m[1] === '#') c.id = m[2]
        else if (m[1] === '.') c.classes.push(m[2])
        else if (m[2] !== '*') c.tag = m[2].toUpperCase()
      }
      if (parts.length) combinators.push(pending)
      parts.push(c)
      pending = ' '
    }
    return { parts, combinators }
  })
  selectorCache.set(sel, parsed)
  return parsed
}

function matchCompound(el: Element, c: Compound): boolean {
  if (el.nodeType !== 1) return false
  if (c.tag && el.tagName !== c.tag) return false
  if (c.id && el.id !== c.id) return false
  for (const cl of c.classes) if (!el.classList.contains(cl)) return false
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name)
    if (v === null) return false
    if (a.op === '=' && v !== a.value) return false
    if (a.op === '^=' && !v.startsWith(a.value!)) return false
    if (a.op === '$=' && !v.endsWith(a.value!)) return false
    if (a.op === '*=' && !v.includes(a.value!)) return false
    if (a.op === '~=' && !v.split(/\s+/).includes(a.value!)) return false
  }
  return true
}

export function matchesSelector(el: Element, sel: string): boolean {
  return parseSelector(sel).some(({ parts, combinators }) => {
    if (!parts.length || !matchCompound(el, parts[parts.length - 1])) return false
    let node: Element | null = el
    for (let i = parts.length - 2; i >= 0; i--) {
      const comb = combinators[i]
      if (comb === '>') {
        node = node!.parentNode
        if (!node || !matchCompound(node, parts[i])) return false
      } else {
        node = node!.parentNode
        while (node && !matchCompound(node, parts[i])) node = node.parentNode
        if (!node) return false
      }
    }
    return true
  })
}
