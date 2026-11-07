import { defineComponent, h, type VNode, type VNodeChild } from 'vue'

/** Parses inline markdown (bold, italic, code, strike, links) into text spans. */
function inline(src: string): VNodeChild[] {
  const out: VNodeChild[] = []
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|~~([^~]+)~~|\[([^\]]+)\]\(([^)]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index))
    if (m[2] || m[3]) out.push(h('tui-text', { bold: true }, inline(m[2] ?? m[3])))
    else if (m[4] || m[5]) out.push(h('tui-text', { italic: true }, inline(m[4] ?? m[5])))
    else if (m[6]) out.push(h('tui-text', { color: 'warning', bg: 'surface' }, m[6]))
    else if (m[7]) out.push(h('tui-text', { strikethrough: true, color: 'muted' }, m[7]))
    else if (m[8]) out.push(h('tui-text', { underline: true, color: 'accent' }, m[8]))
    last = m.index + m[0].length
  }
  if (last < src.length) out.push(src.slice(last))
  return out
}

/** Renders a markdown string with terminal styling. */
export const Markdown = defineComponent({
  name: 'Markdown',
  props: {
    source: { type: String, default: '' },
  },
  setup(props, { slots }) {
    return () => {
      let src = props.source
      if (!src && slots.default) {
        src = (slots.default() as VNode[]).map((v) => (typeof v.children === 'string' ? v.children : '')).join('')
      }
      const lines = src.replace(/\r\n/g, '\n').split('\n')
      // strip common indentation (handy for template literals)
      const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length))
      const ls = lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0))
      const blocks: VNodeChild[] = []
      let para: string[] = []
      let prevKind = ''
      // blank line between blocks, except between consecutive list items
      const gap = (kind: string) => {
        const m = blocks.length && !(kind === 'li' && prevKind === 'li') ? 1 : 0
        prevKind = kind
        return m
      }
      const flush = () => {
        if (para.length) blocks.push(h('tui-text', { key: blocks.length, marginTop: gap('p') }, inline(para.join(' '))))
        para = []
      }
      for (let i = 0; i < ls.length; i++) {
        const line = ls[i]
        let m: RegExpExecArray | null
        if (/^```/.test(line)) {
          flush()
          const code: string[] = []
          i++
          while (i < ls.length && !/^```/.test(ls[i])) code.push(ls[i++])
          blocks.push(
            h('tui-box', { key: blocks.length, marginTop: gap('code'), bg: 'surface', paddingX: 1, flexShrink: 0 }, [h('tui-text', { color: 'info', wrap: 'none' }, code.join('\n'))]),
          )
        } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
          flush()
          const level = m[1].length
          blocks.push(
            h(
              'tui-text',
              { key: blocks.length, marginTop: gap('h'), bold: true, color: level === 1 ? 'primary' : level === 2 ? 'accent' : 'text', underline: level === 1 },
              [level > 2 ? '' : '', ...inline(m[2])],
            ),
          )
        } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
          flush()
          blocks.push(h('tui-box', { key: blocks.length, marginTop: gap('hr'), border: 'single', borderLeft: false, borderRight: false, borderBottom: false, height: 1, flexShrink: 0 }))
        } else if ((m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line))) {
          flush()
          const depth = Math.floor(m[1].length / 2)
          const bullet = /\d/.test(m[2]) ? m[2] : ['•', '◦', '▪'][depth % 3]
          const task = /^\[( |x)\]\s+(.*)$/i.exec(m[3])
          blocks.push(
            h('tui-box', { key: blocks.length, marginTop: gap('li'), paddingLeft: depth * 2, gap: 1, flexShrink: 0 }, [
              h('tui-text', { color: 'primary', wrap: 'none' }, task ? (task[1] === ' ' ? '☐' : '☑') : bullet),
              h('tui-text', { flexShrink: 1 }, inline(task ? task[2] : m[3])),
            ]),
          )
        } else if ((m = /^>\s?(.*)$/.exec(line))) {
          flush()
          const quote = [m[1]]
          while (i + 1 < ls.length && /^>/.test(ls[i + 1])) quote.push(ls[++i].replace(/^>\s?/, ''))
          blocks.push(
            h('tui-box', { key: blocks.length, marginTop: gap('quote'), border: 'bold', borderTop: false, borderRight: false, borderBottom: false, borderColor: 'muted', paddingLeft: 1, flexShrink: 0 }, [
              h('tui-text', { italic: true, color: 'muted' }, inline(quote.join(' '))),
            ]),
          )
        } else if (!line.trim()) {
          flush()
        } else {
          para.push(line.trim())
        }
      }
      flush()
      return h('tui-box', { flexDirection: 'column', flexShrink: 0 }, blocks)
    }
  },
})
