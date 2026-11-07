import type { Rule } from 'eslint'
import { DOCS, defineTemplateVisitor, tagOf, type VElement } from '../utils.js'

/**
 * HTML elements with no terminal meaning in vuecli, and the component to use
 * instead. `div` / `span` / `p` / `box` / `text` / `view` / `br` are valid
 * vuecli aliases and never reported.
 */
export const DOM_ELEMENTS: Record<string, string> = {
  input: 'TextInput (text), Checkbox / Switch (checkbox), RadioGroup (radio) or Slider (range)',
  textarea: 'TextInput',
  button: 'Button',
  select: 'Select',
  option: 'Select :options',
  optgroup: 'Select :options',
  datalist: 'Select',
  form: 'Box (handle @submit on TextInput)',
  fieldset: 'Box border title="..."',
  legend: 'Box title="..."',
  label: 'Text',
  img: 'Image',
  picture: 'Image',
  video: 'Image / Canvas',
  audio: 'a terminal bell or nothing',
  canvas: 'Canvas',
  svg: 'Canvas',
  iframe: 'a separate component',
  object: 'Image',
  embed: 'Image',
  a: 'Link (App Router) or Text',
  ul: 'List',
  ol: 'List',
  li: 'List :items',
  dl: 'Table / List',
  dt: 'Text',
  dd: 'Text',
  table: 'Table',
  thead: 'Table :columns',
  tbody: 'Table :rows',
  tfoot: 'Table',
  tr: 'Table :rows',
  td: 'Table :rows',
  th: 'Table :columns',
  caption: 'Table title / Box title',
  colgroup: 'Table :columns',
  col: 'Table :columns',
  h1: 'BigText or Text bold',
  h2: 'Text bold',
  h3: 'Text bold',
  h4: 'Text bold',
  h5: 'Text bold',
  h6: 'Text bold',
  hr: 'Divider',
  progress: 'ProgressBar',
  meter: 'ProgressBar',
  dialog: 'Dialog',
  details: 'Box + v-if',
  summary: 'Text',
  pre: 'Text wrap="none" or Code',
  code: 'Code or Text',
  b: 'Text bold',
  strong: 'Text bold',
  i: 'Text italic',
  em: 'Text italic',
  u: 'Text underline',
  s: 'Text strikethrough',
  del: 'Text strikethrough',
  small: 'Text dim',
  mark: 'Text inverse',
  kbd: 'KeyHints or Text',
  script: '<script> blocks of the SFC',
  style: 'utility classes, :style or props',
  link: 'nothing (no stylesheets in the terminal)',
}

/** Sectioning elements render as plain boxes; reported only with `{ sectioning: true }`. */
export const SECTIONING = ['header', 'footer', 'main', 'nav', 'section', 'article', 'aside', 'figure', 'figcaption', 'address']

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow HTML elements that have no meaning in a vuecli terminal app',
      recommended: true,
      url: `${DOCS}#vueclino-dom-elements`,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          sectioning: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noDom: '<{{tag}}> has no terminal meaning in vuecli and renders as a plain box. Use {{suggestion}} instead.',
      noSectioning: '<{{tag}}> renders as a plain box in vuecli. Use <Box> instead.',
    },
  },
  create(context) {
    const opts = (context.options[0] ?? {}) as { allow?: string[]; sectioning?: boolean }
    const allow = new Set(opts.allow ?? [])
    const sectioning = new Set(opts.sectioning ? SECTIONING : [])
    return defineTemplateVisitor(context, {
      VElement(el: VElement) {
        const tag = tagOf(el)
        // only lowercase, namespace-free HTML tag names; components are PascalCase or kebab-case with a dash
        if (tag !== tag.toLowerCase() || allow.has(tag)) return
        const loc = el.startTag.loc
        if (sectioning.has(tag)) {
          context.report({ loc, messageId: 'noSectioning', data: { tag } })
          return
        }
        const suggestion = Object.prototype.hasOwnProperty.call(DOM_ELEMENTS, tag) ? DOM_ELEMENTS[tag] : undefined
        if (!suggestion) return
        context.report({ loc, messageId: 'noDom', data: { tag, suggestion } })
      },
    })
  },
}
export default rule
