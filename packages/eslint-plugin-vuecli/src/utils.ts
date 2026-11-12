import type { Rule } from 'eslint'

/** A vue-eslint-parser template node (loosely typed: the parser ships no ESM types). */
export interface VNode {
  type: string
  range: [number, number]
  loc: { start: { line: number; column: number }; end: { line: number; column: number } }
  parent?: VNode | null
  [key: string]: any
}

export interface VElement extends VNode {
  type: 'VElement'
  name: string
  rawName: string
  startTag: VNode & { attributes: VNode[] }
  endTag: VNode | null
  children: VNode[]
}

type Visitor = Record<string, (node: any) => void>

/**
 * Registers template visitors through vue-eslint-parser. Outside `.vue` files
 * (or without the parser) only the script visitor runs.
 */
export function defineTemplateVisitor(context: Rule.RuleContext, template: Visitor, script: Visitor = {}): Rule.RuleListener {
  const services = (context.sourceCode as unknown as { parserServices?: { defineTemplateBodyVisitor?: (t: Visitor, s?: Visitor) => Rule.RuleListener } }).parserServices
  if (!services?.defineTemplateBodyVisitor) return script as Rule.RuleListener
  return services.defineTemplateBodyVisitor(template, script)
}

/** Tag name as written (keeps case for components): `Box`, `tui-box`, `div`. */
export function tagOf(el: VElement): string {
  return el.rawName ?? el.name
}

/** `TextInput` → `text-input`; `tui-box` stays. */
export function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase()
}

/** Elements whose tag matches one of `names` (compared case-insensitively in kebab-case). */
export function matchesTag(el: VElement, names: Set<string>): boolean {
  const t = tagOf(el)
  return names.has(t) || names.has(kebab(t))
}

export const DOCS = 'https://github.com/marcuspuchalla/vuecli/blob/HEAD/packages/eslint-plugin-vuecli/README.md'
