/**
 * Minimal HTML parser for the terminal DOM.
 *
 * Used for Vue's stringified static content (`insertStaticContent`) and for
 * the static parts of a web app's `index.html`. It handles elements,
 * attributes, text, comments, void elements and character references, which
 * is enough for compiler output and hand-written page shells. It is not a
 * spec-compliant HTML5 tree builder.
 */
import { TComment, TElement, TTextNode, type TNode } from '../dom/nodes.js'

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
/** Elements whose content is raw text (no tags inside). */
const RAW = new Set(['script', 'style', 'textarea', 'title'])
/** Opening one of these implicitly closes an open element of the same kind. */
const AUTO_CLOSE: Record<string, string[]> = { li: ['li'], p: ['p'], option: ['option'], tr: ['tr'], td: ['td', 'th'], th: ['td', 'th'], dt: ['dt', 'dd'], dd: ['dt', 'dd'] }

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…',
  mdash: '—', ndash: '–', laquo: '«', raquo: '»', middot: '·', bull: '•', times: '×', larr: '←', rarr: '→', uarr: '↑',
  darr: '↓', hearts: '♥', check: '✓', euro: '€', pound: '£', yen: '¥', deg: '°', para: '¶', sect: '§',
}

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of src.matchAll(ATTR)) out[m[1]] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  return out
}

/** Parses an HTML fragment into detached terminal nodes. */
export function parseHTML(html: string): TNode[] {
  const roots: TNode[] = []
  const stack: TElement[] = []
  const append = (n: TNode) => {
    const parent = stack[stack.length - 1]
    if (parent) parent.insertBefore(n, null)
    else roots.push(n)
  }
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    const textEnd = lt < 0 ? html.length : lt
    if (textEnd > i) append(new TTextNode(decodeEntities(html.slice(i, textEnd))))
    if (lt < 0) break
    i = lt
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4)
      append(new TComment(html.slice(i + 4, end < 0 ? html.length : end)))
      i = end < 0 ? html.length : end + 3
      continue
    }
    if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
      const end = html.indexOf('>', i)
      i = end < 0 ? html.length : end + 1
      continue
    }
    const close = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(html.slice(i))
    if (close) {
      const tag = close[1].toLowerCase()
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].tag === tag) {
          stack.length = k
          break
        }
      }
      i += close[0].length
      continue
    }
    const open = /^<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/.exec(html.slice(i))
    if (!open) {
      // a stray '<' is text
      append(new TTextNode('<'))
      i++
      continue
    }
    i += open[0].length
    const tag = open[1].toLowerCase()
    const closes = AUTO_CLOSE[tag]
    if (closes && stack.length && closes.includes(stack[stack.length - 1].tag)) stack.pop()
    const el = new TElement(tag)
    const attrs = parseAttrs(open[2])
    for (const k in attrs) el.props[k] = attrs[k]
    append(el)
    if (open[3] === '/' || VOID.has(tag)) continue
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, i)
      const raw = html.slice(i, end < 0 ? html.length : end)
      if (raw) el.insertBefore(new TTextNode(tag === 'textarea' || tag === 'title' ? decodeEntities(raw) : raw), null)
      i = end < 0 ? html.length : html.indexOf('>', end) + 1
      continue
    }
    stack.push(el)
  }
  return roots
}

/** Deep copy of a terminal node (for re-mounting cached static content). */
export function cloneNode(n: TNode): TNode {
  if (n.nodeType === 'text') return new TTextNode(n.text)
  if (n.nodeType === 'comment') return new TComment(n.text)
  const el = new TElement(n.tag)
  Object.assign(el.props, n.props)
  for (const c of n.children) el.insertBefore(cloneNode(c), null)
  return el
}
