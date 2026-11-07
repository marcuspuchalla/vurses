import { compile } from '@vue/compiler-dom'
import * as Vue from 'vue'
import { createRenderer, registerRuntimeCompiler, type RenderFunction } from 'vue'
import { TComment, TElement, TTextNode, getElementById, type TNode } from './dom/nodes.js'

import { TERMINAL_TAGS, compilerOptions } from './compiler-options.js'
import { vuecliError } from './errors.js'
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
    el.setProp(key, next)
  },
  querySelector(selector) {
    if (!selector.startsWith('#')) return null
    for (const r of activeRoots) {
      const found = getElementById(r, selector.slice(1))
      if (found) return found
    }
    return null
  },
  insertStaticContent() {
    throw vuecliError('VC010')
  },
})

export const render = renderer.render
export const createBaseApp = renderer.createApp

// Support `template: '...'` in components, compiled at runtime for the terminal.
const compileCache = new Map<string, RenderFunction>()
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
  const fn = new Function('Vue', code)(Vue) as RenderFunction & { _rc?: boolean }
  fn._rc = true
  compileCache.set(key, fn)
  return fn
})
