import type { App, Component } from 'vue'
import * as primitives from './primitives.js'
import * as inputs from './inputs.js'
import * as display from './display.js'
import * as containers from './containers.js'
import * as bigtext from './bigtext.js'
import * as markdown from './markdown.js'
import * as layout from './layout.js'
import * as tree from './tree.js'
import * as code from './code.js'
import * as diff from './diff.js'
import * as charts from './charts.js'
import * as gradient from './gradient.js'
import * as slider from './slider.js'
import * as keyhelp from './keyhelp.js'
import * as asciifont from './asciifont.js'
import * as boundary from './boundary.js'
import * as canvas from './canvas.js'
import * as image from './image.js'
import * as router from './router.js'

export * from './primitives.js'
export * from './inputs.js'
export * from './display.js'
export * from './containers.js'
export * from './bigtext.js'
export * from './markdown.js'
export * from './layout.js'
export * from './tree.js'
export * from './code.js'
export * from './diff.js'
export * from './charts.js'
export * from './gradient.js'
export * from './slider.js'
export * from './keyhelp.js'
export * from './asciifont.js'
export * from './boundary.js'
export * from './canvas.js'
export * from './image.js'
export * from './router.js'

const modules: Record<string, unknown>[] = [
  primitives, inputs, display, containers, bigtext, markdown, layout, tree, code, diff, charts,
  gradient, slider, keyhelp, asciifont, boundary, canvas, image, router,
]

function isComponent(v: unknown): v is Component & { name?: string } {
  return !!v && typeof v === 'object' && ('setup' in v || 'render' in v || 'template' in v) && typeof (v as { name?: unknown }).name === 'string'
}

/**
 * Every exported Vue component with a `name` in the modules above is
 * registered globally under that name (so templates can use it without importing).
 */
export const components: Record<string, Component> = {}
for (const m of modules) {
  for (const key in m) {
    const v = m[key]
    if (isComponent(v) && /^[A-Z]/.test(key)) components[(v as { name: string }).name] = v
  }
}

/** Registers all built-in components globally (done automatically by createApp). */
export function installComponents(app: App) {
  for (const name in components) {
    if (!app.component(name)) app.component(name, components[name])
  }
}
