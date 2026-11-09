import { compile } from '@vue/compiler-dom'
import * as Vue from 'vue'
import { createRenderer, registerRuntimeCompiler, type RenderFunction } from 'vue'
import { TComment, TElement, TTextNode, getElementById, type TNode } from './dom/nodes.js'

import { TERMINAL_TAGS, compilerOptions } from './compiler-options.js'
import { vuecliError } from './errors.js'
import { cloneNode, parseHTML } from './web/html.js'
export { TERMINAL_TAGS, compilerOptions }

const activeRoots = new Set<TElement>()
export function trackRoot(root: TElement) {
  activeRoots.add(root)
  return () => activeRoots.delete(root)
}

const renderer = createRenderer<TNode, TElement>({
  createElement: (tag) => new TElement(tag),
  createText: (text) => new TTextNode(text),
  createComment: (text) => new TComment(text),
  setText(node, text) {
    if (node.nodeType === 'text') node.text = text
    else if (node.nodeType === 'comment') node.text = text
  },
  setElementText(el, text) {
    for (const c of [...el.children]) el.removeChild(c)
    if (text) el.insertBefore(new TTextNode(text), null)
  },
  insert(child, parent, anchor) {
    parent.insertBefore(child, anchor ?? null)
  },
  remove(child) {
    child.parent?.removeChild(child)
  },
  parentNode: (node) => node.parent,
  nextSibling(node) {
    const p = node.parent
    if (!p) return null
    const i = p.children.indexOf(node)
    return p.children[i + 1] ?? null
  },
  patchProp(el, key, _prev, next) {
    // v-html / v-text: the element's children come from the value
    if (key === 'innerHTML' || key === 'textContent') {
      for (const c of [...el.children]) el.removeChild(c)
      const v = next === undefined || next === null ? '' : String(next)
      const nodes = key === 'innerHTML' ? parseHTML(v) : v ? [new TTextNode(v)] : []
      for (const n of nodes) el.insertBefore(n, null)
      return
    }
    el.setProp(key, next)
  },
  querySelector(selector) {
    for (const r of activeRoots) {
      // web apps: CSS selectors and `body` resolve inside the page scope
      for (const el of r.walk()) {
        const q = (el.scope as { querySelector?(s: string): TElement | null } | null)?.querySelector
        if (q) {
          const found = q.call(el.scope, selector)
          if (found) return found
        }
      }
      if (selector.startsWith('#')) {
        const found = getElementById(r, selector.slice(1))
        if (found) return found
      }
    }
    return null
  },
  setScopeId(el, id) {
    // scoped-CSS attribute (data-v-xxxx); only the web layer reads it
    el.props[id] = ''
  },
  insertStaticContent(content, parent, anchor, _namespace, start, end) {
    // stringified static subtrees (production builds of SFC templates)
    const nodes: TNode[] = []
    if (start && end) {
      // re-mount from cache: clone the previously inserted range
      let n: TNode | null = start
      while (n) {
        nodes.push(cloneNode(n))
        if (n === end) break
        const p: TElement | null = n.parent
        n = p ? (p.children[p.children.indexOf(n) + 1] ?? null) : null
      }
    } else nodes.push(...parseHTML(content))
    if (!nodes.length) nodes.push(new TTextNode(''))
    for (const n of nodes) parent.insertBefore(n, anchor ?? null)
    return [nodes[0], nodes[nodes.length - 1]]
  },
})

export const render = renderer.render
export const createBaseApp = renderer.createApp

// Support `template: '...'` in components, compiled at runtime for the terminal.
const compileCache = new Map<string, RenderFunction>()
/** Namespace the compiled render functions take their helpers from. */
let templateHelpers: Record<string, unknown> = Vue

/**
 * Replaces the helpers used by runtime-compiled templates (the web layer
 * swaps in its own v-model directives and transitions).
 */
export function setTemplateHelpers(ns: Record<string, unknown>) {
  templateHelpers = ns
  compileCache.clear()
}
registerRuntimeCompiler((template: string, options: Record<string, any> = {}) => {
  const key = template
  const cached = compileCache.get(key)
  if (cached) return cached
  const userCustom = options.isCustomElement as ((t: string) => boolean) | undefined
  const { code } = compile(template, {
    ...options,
    ...compilerOptions,
    isCustomElement: (tag) => compilerOptions.isCustomElement(tag) || !!userCustom?.(tag),
    nodeTransforms: [...compilerOptions.nodeTransforms, ...((options.nodeTransforms as never[]) ?? [])],
    mode: 'function',
    prefixIdentifiers: false,
    onError(err) {
      throw err
    },
  })
  const fn = new Function('Vue', code)(templateHelpers) as RenderFunction & { _rc?: boolean }
  fn._rc = true
  compileCache.set(key, fn)
  return fn
})
