/**
 * Element and component trees of a running app, as JSON-serializable data.
 * Used by the devtools hook, the MCP `get_tree` tool and the DevTools panel.
 * Browser-safe.
 */
import type { ComponentInternalInstance, VNode } from 'vue'
import type { Runtime } from '../app/app.js'
import type { TElement, TNode } from '../dom/nodes.js'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ElementInfo {
  id: number
  tag: string
  kind: 'box' | 'text' | 'root'
  rect: Rect
  /** Serializable props (listeners are reported in `listeners`). */
  props: Record<string, unknown>
  listeners: string[]
  /** Text content (text elements only, truncated). */
  text?: string
  children: ElementInfo[]
}

export interface ComponentInfo {
  id: number
  name: string
  /** Source file of the component (`__file`), if known. */
  file?: string
  props: Record<string, unknown>
  /** Union of the component's root element rects (null if it renders nothing). */
  rect: Rect | null
  /** Ids of the top-level elements it renders (see ElementInfo.id). */
  elements: number[]
  children: ComponentInfo[]
}

// ------------------------------------------------------------------ ids

const ids = new WeakMap<object, number>()
const byId = new Map<number, WeakRef<object>>()
let nextId = 1

/** Stable numeric id for an element or component instance. */
export function idOf(o: object): number {
  let id = ids.get(o)
  if (id === undefined) {
    id = nextId++
    ids.set(o, id)
    byId.set(id, new WeakRef(o))
  }
  return id
}

/** Looks up an object by id (null if it was garbage collected or never seen). */
export function objectById<T extends object = object>(id: number): T | null {
  const o = byId.get(id)?.deref()
  if (!o) byId.delete(id)
  return (o as T) ?? null
}

// ------------------------------------------------------------------ values

/** Converts arbitrary values into something JSON can carry (depth-limited, cycle-safe). */
export function serializeValue(v: unknown, depth = 3, seen = new WeakSet<object>()): unknown {
  if (v === null || v === undefined) return v ?? null
  const t = typeof v
  if (t === 'string') return (v as string).length > 500 ? (v as string).slice(0, 500) + '…' : v
  if (t === 'number' || t === 'boolean') return Number.isNaN(v) ? 'NaN' : v
  if (t === 'bigint') return `${v}n`
  if (t === 'symbol') return String(v)
  if (t === 'function') return `[Function ${(v as { name?: string }).name || 'anonymous'}]`
  const o = v as object
  if (seen.has(o)) return '[Circular]'
  if ((o as { nodeType?: unknown }).nodeType === 'element') return `<${(o as TElement).tag}>`
  if ((o as { __v_skip?: unknown }).__v_skip || (o as { $?: unknown }).$) return '[Component]'
  if (depth <= 0) return Array.isArray(o) ? `[Array(${(o as unknown[]).length})]` : '[Object]'
  seen.add(o)
  if (Array.isArray(o)) {
    const out = o.slice(0, 50).map((x) => serializeValue(x, depth - 1, seen))
    if (o.length > 50) out.push(`… ${o.length - 50} more`)
    return out
  }
  if (o instanceof Date) return o.toISOString()
  if (o instanceof Map) return { '[Map]': serializeValue(Object.fromEntries(o), depth - 1, seen) }
  if (o instanceof Set) return { '[Set]': serializeValue([...o], depth - 1, seen) }
  if (o instanceof Error) return { name: o.name, message: o.message }
  const out: Record<string, unknown> = {}
  let n = 0
  for (const k of Object.keys(o)) {
    if (n++ >= 50) {
      out['…'] = 'more keys'
      break
    }
    try {
      out[k] = serializeValue((o as Record<string, unknown>)[k], depth - 1, seen)
    } catch {
      out[k] = '[Unreadable]'
    }
  }
  return out
}

// ------------------------------------------------------------------ elements

const INTERNAL_PROPS = new Set(['paintCells', 'onLayout'])

function elementProps(el: TElement) {
  const props: Record<string, unknown> = {}
  const listeners: string[] = []
  for (const [k, v] of Object.entries(el.props)) {
    if (/^on[A-Z]/.test(k)) listeners.push(k.slice(2, 3).toLowerCase() + k.slice(3))
    else if (INTERNAL_PROPS.has(k)) props[k] = '[Function]'
    else if (v !== undefined) props[k] = serializeValue(v, 2)
  }
  return { props, listeners }
}

function rectOf(el: TElement): Rect {
  const { x, y, width, height } = el.layout
  return { x, y, width, height }
}

export interface TreeOptions {
  /** Max depth (default: unlimited). */
  depth?: number
  /** Include props (default true). */
  props?: boolean
}

/** Serializes the element tree below `root`. */
export function elementTree(root: TElement, opts: TreeOptions = {}, depth = 0): ElementInfo {
  const { props, listeners } = opts.props === false ? { props: {}, listeners: [] } : elementProps(root)
  const info: ElementInfo = { id: idOf(root), tag: root.tag, kind: root.kind, rect: rectOf(root), props, listeners, children: [] }
  if (root.kind === 'text') {
    const t = root.textContent
    info.text = t.length > 200 ? t.slice(0, 200) + '…' : t
  }
  if (opts.depth === undefined || depth < opts.depth) {
    for (const c of root.children) if (c.nodeType === 'element') info.children.push(elementTree(c, opts, depth + 1))
  }
  return info
}

/** Indented text outline of an element tree: `box#3 [0,0 80x24] class="p-1"`. */
export function formatElementTree(info: ElementInfo, indent = ''): string {
  const r = info.rect
  const extras: string[] = []
  for (const k of ['id', 'class', 'title', 'label']) if (info.props[k] !== undefined) extras.push(`${k}=${JSON.stringify(info.props[k])}`)
  if (info.listeners.length) extras.push(`@${info.listeners.join(' @')}`)
  if (info.text !== undefined) extras.push(JSON.stringify(info.text))
  let line = `${indent}${info.tag}#${info.id} [${r.x},${r.y} ${r.width}x${r.height}]${extras.length ? ' ' + extras.join(' ') : ''}`
  for (const c of info.children) line += '\n' + formatElementTree(c, indent + '  ')
  return line
}

// ------------------------------------------------------------------ components

const HIDDEN_COMPONENTS = new Set(['VueCliRoot', 'DevTools'])

/** Display name of a component instance. */
export function componentName(i: ComponentInternalInstance): string {
  const t = i.type as { name?: string; __name?: string; __file?: string; displayName?: string }
  if (t.name) return t.name
  if (t.__name) return t.__name
  if (t.displayName) return t.displayName
  if (t.__file) {
    const m = /([^/\\]+)\.\w+$/.exec(t.__file)
    if (m) return m[1]
  }
  return 'Anonymous'
}

function isElementVNode(v: VNode) {
  return typeof v.type === 'string'
}

/** Top-level host elements a vnode renders (through fragments and nested components). */
export function hostElements(v: VNode | null | undefined, out: TElement[] = []): TElement[] {
  if (!v) return out
  if (v.component) return hostElements(v.component.subTree, out)
  if (v.suspense) return hostElements((v.suspense as { activeBranch?: VNode }).activeBranch, out)
  if (isElementVNode(v)) {
    const el = v.el as TNode | null
    if (el && (el as TElement).nodeType === 'element') out.push(el as TElement)
    return out
  }
  if (Array.isArray(v.children)) for (const c of v.children as VNode[]) if (c && typeof c === 'object') hostElements(c, out)
  return out
}

/** Union of element rects (ignores zero-size elements unless all are). */
export function unionRect(els: TElement[]): Rect | null {
  if (!els.length) return null
  const rs = els.map(rectOf)
  const sized = rs.filter((r) => r.width > 0 && r.height > 0)
  const list = sized.length ? sized : rs
  const x = Math.min(...list.map((r) => r.x))
  const y = Math.min(...list.map((r) => r.y))
  const x2 = Math.max(...list.map((r) => r.x + r.width))
  const y2 = Math.max(...list.map((r) => r.y + r.height))
  return { x, y, width: x2 - x, height: y2 - y }
}

function collectChildComponents(v: VNode | null | undefined, out: ComponentInternalInstance[]) {
  if (!v) return
  if (v.component) {
    out.push(v.component)
    return
  }
  if (v.suspense) {
    collectChildComponents((v.suspense as { activeBranch?: VNode }).activeBranch, out)
    return
  }
  if (Array.isArray(v.children)) for (const c of v.children as VNode[]) if (c && typeof c === 'object') collectChildComponents(c, out)
}

/** Direct child component instances of an instance. */
export function childComponents(i: ComponentInternalInstance): ComponentInternalInstance[] {
  const out: ComponentInternalInstance[] = []
  collectChildComponents(i.subTree, out)
  return out
}

function componentInfo(i: ComponentInternalInstance, opts: TreeOptions, depth: number): ComponentInfo[] {
  const kids = () => {
    if (opts.depth !== undefined && depth >= opts.depth) return []
    return childComponents(i).flatMap((c) => componentInfo(c, opts, depth + 1))
  }
  const name = componentName(i)
  if (HIDDEN_COMPONENTS.has(name)) return name === 'DevTools' ? [] : kids()
  const els = hostElements(i.subTree)
  const file = (i.type as { __file?: string }).__file
  const props: Record<string, unknown> = {}
  if (opts.props !== false) for (const [k, v] of Object.entries(i.props ?? {})) props[k] = serializeValue(v, 2)
  return [
    {
      id: idOf(i),
      name,
      ...(file && { file }),
      props,
      rect: unionRect(els),
      elements: els.map(idOf),
      children: kids(),
    },
  ]
}

/** The root component instance of a runtime (the user's root, below vuecli's wrapper). */
export function rootInstance(runtime: Runtime): ComponentInternalInstance | null {
  const app = (runtime as unknown as { app?: { _instance?: ComponentInternalInstance | null } }).app
  if (app?._instance) return app._instance
  const vnode = (runtime.root as unknown as { _vnode?: VNode })._vnode
  return vnode?.component ?? null
}

/** Serializes the component tree of a running app. */
export function componentTree(runtime: Runtime, opts: TreeOptions = {}): ComponentInfo[] {
  const root = rootInstance(runtime)
  return root ? componentInfo(root, opts, 0) : []
}

/** Indented text outline of a component tree: `<TodoList#5> [0,2 40x10] items=3`. */
export function formatComponentTree(nodes: ComponentInfo[], indent = ''): string {
  return nodes
    .map((n) => {
      const r = n.rect
      const props = Object.entries(n.props)
        .filter(([, v]) => v !== undefined && v !== null && !(typeof v === 'string' && v.startsWith('[Function')))
        .slice(0, 6)
        .map(([k, v]) => `${k}=${short(v)}`)
      let line = `${indent}<${n.name}#${n.id}>${r ? ` [${r.x},${r.y} ${r.width}x${r.height}]` : ''}${props.length ? ' ' + props.join(' ') : ''}`
      if (n.children.length) line += '\n' + formatComponentTree(n.children, indent + '  ')
      return line
    })
    .join('\n')
}

function short(v: unknown): string {
  const s = JSON.stringify(v) ?? String(v)
  return s.length > 40 ? s.slice(0, 39) + '…' : s
}

/** Finds a component by id or name in the live instance tree. */
export function findComponent(runtime: Runtime, query: number | string): ComponentInternalInstance | null {
  const root = rootInstance(runtime)
  if (!root) return null
  const stack = [root]
  while (stack.length) {
    const i = stack.shift()!
    if (typeof query === 'number' ? idOf(i) === query : componentName(i) === query) return i
    stack.push(...childComponents(i))
  }
  return null
}

/** Resolves a rect for an element id or a component id. */
export function rectForId(runtime: Runtime, id: number): Rect | null {
  const o = objectById(id)
  if (!o) {
    const c = findComponent(runtime, id)
    return c ? unionRect(hostElements(c.subTree)) : null
  }
  if ((o as TElement).nodeType === 'element') return rectOf(o as TElement)
  if ((o as ComponentInternalInstance).subTree) return unionRect(hostElements((o as ComponentInternalInstance).subTree))
  return null
}
