/** A small, forgiving HTML parser: builds elements into a tree and collects scripts. */
import type { Document } from '../dom.js'
import type { Element } from '../element.js'

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const RAW = new Set(['script', 'style', 'textarea', 'title'])

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', hellip: '…', mdash: '—', ndash: '–' }
export function decodeEntities(s: string) {
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Parses HTML into `doc` (head/body children are placed into document.head / document.body). Returns elements in document order. */
export function parseHtml(html: string, doc: Document): Element[] {
  const all: Element[] = []
  const stack: Element[] = [doc.body]
  let inHead = true
  const current = () => stack[stack.length - 1]
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/\s*([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) {
      const text = decodeEntities(m[5])
      if (text.trim() && current() !== doc.body) current()._text += text
      else if (text.trim()) doc.body._text += text
      continue
    }
    if (m[1]) {
      const tag = m[1].toLowerCase()
      if (tag === 'head') inHead = false
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].localName === tag) {
          stack.length = i
          break
        }
      }
      continue
    }
    if (!m[2]) continue
    const tag = m[2].toLowerCase()
    if (tag === 'html') continue
    if (tag === 'head') { inHead = true; continue }
    if (tag === 'body') {
      inHead = false
      applyAttrs(doc.body, m[3])
      continue
    }
    const el = doc.createElement(tag)
    applyAttrs(el, m[3])
    const parent = inHead && stack.length === 1 && ['script', 'style', 'link', 'meta', 'title', 'base'].includes(tag) ? doc.head : current()
    if (tag === 'title') {
      const end = html.toLowerCase().indexOf('</title>', re.lastIndex)
      const t = decodeEntities(html.slice(re.lastIndex, end < 0 ? html.length : end))
      doc.title = t.trim()
      re.lastIndex = end < 0 ? html.length : end + 8
      continue
    }
    parent.appendChild(el)
    all.push(el)
    if (RAW.has(tag) && !m[4]) {
      const close = new RegExp(`</${tag}\\s*>`, 'i')
      const rest = html.slice(re.lastIndex)
      const cm = close.exec(rest)
      const body = cm ? rest.slice(0, cm.index) : rest
      el._text = tag === 'textarea' ? decodeEntities(body) : body
      re.lastIndex += cm ? cm.index + cm[0].length : rest.length
      continue
    }
    if (!VOID.has(tag) && !m[4] && !(inHead && parent === doc.head)) stack.push(el)
  }
  return all
}

function applyAttrs(el: Element, src: string) {
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const value = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
    el.setAttribute(m[1], value)
  }
}
