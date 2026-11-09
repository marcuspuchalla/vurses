/**
 * What `import ... from 'vue'` resolves to inside a web app built by
 * `vuecli web`: the real Vue, with the DOM-specific parts replaced.
 *
 * - `createApp` / `createSSRApp` → terminal page app (see ./app.ts)
 * - `vModelText` & co. → bind form controls of the terminal page
 * - `Transition` / `TransitionGroup` → no CSS animations (terminals don't animate)
 * - `useCssVars` → no-op
 */
import { BaseTransition, defineComponent, Fragment, h, type Component, type DirectiveBinding, type ObjectDirective, type VNode } from 'vue'
import * as VueNs from 'vue'
import type { TElement } from '../dom/nodes.js'
import { setTemplateHelpers } from '../renderer.js'
import { createWebApp } from './app.js'
import { bindModel, controlKind, controlState, type Model } from './scope.js'

export * from 'vue'

export function createApp(root: Component, props?: Record<string, unknown> | null) {
  return createWebApp(root, props)
}
export const createSSRApp = createApp

type ModelKind = Model['kind']

function assigner(vnode: VNode): ((v: unknown) => void) | null {
  const fn = vnode.props?.['onUpdate:modelValue']
  if (!fn) return null
  return Array.isArray(fn) ? (v) => fn.forEach((f: (v: unknown) => void) => f(v)) : fn
}

function modelDirective(kind: ModelKind): ObjectDirective<TElement> {
  const apply = (el: TElement, b: DirectiveBinding, vnode: VNode) => {
    const k = kind === 'dynamic' ? (el.tag === 'select' ? 'select' : controlKind(el) === 'checkbox' ? 'checkbox' : controlKind(el) === 'radio' ? 'radio' : 'text') : kind
    bindModel(el, { assign: assigner(vnode), value: b.value, mods: b.modifiers ?? {}, kind: k })
  }
  return {
    created: apply,
    mounted: apply,
    beforeUpdate: apply,
    updated(el, b, vnode) {
      // <select> options may have changed
      if (el.tag === 'select') apply(el, b, vnode)
    },
  }
}

export const vModelText = modelDirective('text')
export const vModelCheckbox = modelDirective('checkbox')
export const vModelRadio = modelDirective('radio')
export const vModelSelect = modelDirective('select')
export const vModelDynamic = modelDirective('dynamic')

/** `<Transition>` without CSS classes: content switches immediately. */
export const Transition = defineComponent({
  name: 'Transition',
  inheritAttrs: false,
  props: { mode: String, appear: Boolean, persisted: Boolean },
  setup(props, { slots }) {
    return () => h(BaseTransition, { mode: props.mode as 'in-out' | 'out-in' | 'default' | undefined, appear: props.appear, persisted: props.persisted }, slots)
  },
})

const TRANSITION_ATTRS = /^(name|moveClass|move-class|css|type|duration|(enter|leave|appear)(From|Active|To)?Class|(enter|leave|appear)(-from|-active|-to)?-class)$/

/** `<TransitionGroup>`: renders its children (in `tag` when given). */
export const TransitionGroup = defineComponent({
  name: 'TransitionGroup',
  inheritAttrs: false,
  props: { tag: String },
  setup(props, { slots, attrs }) {
    return () => {
      const children = slots.default?.() ?? []
      if (!props.tag) return h(Fragment, null, children)
      const rest: Record<string, unknown> = {}
      for (const k in attrs) if (!TRANSITION_ATTRS.test(k) && !/^on(Before|After)?(Enter|Leave|Appear)/.test(k)) rest[k] = attrs[k]
      return h(props.tag, rest, children)
    }
  },
})

// templates compiled at runtime (`template: '...'`) use the same replacements
setTemplateHelpers({ ...VueNs, vModelText, vModelCheckbox, vModelRadio, vModelSelect, vModelDynamic, Transition, TransitionGroup })

export function useCssVars(_getter: (ctx: unknown) => Record<string, string>) {
  /* CSS v-bind() is not supported in the terminal */
}

/** Access to a terminal control's state (for advanced integrations). */
export { controlState as __vuecliControlState }
