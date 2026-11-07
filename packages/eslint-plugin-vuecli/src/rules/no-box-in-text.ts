import type { Rule } from 'eslint'
import { DOCS, defineTemplateVisitor, matchesTag, tagOf, type VElement } from '../utils.js'

/** Layout containers (render a `tui-box`). */
export const BOX_TAGS = ['box', 'tui-box', 'div', 'view', 'h-stack', 'v-stack', 'center', 'scroll-box', 'spacer', 'divider']
/** Inline text elements (render a `tui-text`). */
export const TEXT_TAGS = ['text', 'tui-text', 'span', 'p']

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow layout boxes inside text elements (they are ignored by inline text layout)',
      recommended: true,
      url: `${DOCS}#vueclino-box-in-text`,
    },
    schema: [
      {
        type: 'object',
        properties: {
          boxTags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          textTags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      boxInText:
        '<{{box}}> inside <{{text}}> is ignored: text elements only lay out inline text. Move it out of <{{text}}> or wrap both in a <Box>.',
    },
  },
  create(context) {
    const opts = (context.options[0] ?? {}) as { boxTags?: string[]; textTags?: string[] }
    const boxes = new Set([...BOX_TAGS, ...(opts.boxTags ?? [])])
    const texts = new Set([...TEXT_TAGS, ...(opts.textTags ?? [])])
    return defineTemplateVisitor(context, {
      VElement(el: VElement) {
        if (!matchesTag(el, boxes)) return
        for (let p = el.parent; p && p.type === 'VElement'; p = p.parent) {
          const parent = p as VElement
          // report against the nearest text ancestor (<template> wrappers in between do not matter)
          if (matchesTag(parent, texts)) {
            context.report({ loc: el.startTag.loc, messageId: 'boxInText', data: { box: tagOf(el), text: tagOf(parent) } })
            return
          }
        }
      },
    })
  },
}
export default rule
