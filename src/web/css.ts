/**
 * A small CSS engine for running existing web apps in the terminal.
 *
 * Parses stylesheets (with @media evaluated against the terminal size and the
 * theme's color scheme), matches selectors against terminal elements and
 * cascades declarations by specificity and source order. The mapping to
 * terminal styles lives in `./cascade.ts`.
 *
 * Supported selectors: type, `*`, `.class`, `#id`, `[attr]`, `[attr=v]`
 * (and `~= |= ^= $= *=`), descendant / child / sibling combinators, and the
 * pseudo-classes that make sense in a terminal (`:hover` and `:focus*` follow
 * keyboard focus, structural ones like `:first-child` / `:nth-child()`,
 * `:not() :is() :where()`, `:checked :disabled :empty :root`). Rules with
 * other pseudo-classes never match. `::before` / `::after` are kept for
 * their `content`.
 */

export interface Declaration {
  prop: string
  value: string
  important: boolean
}

export type Combinator = ' ' | '>' | '+' | '~'

export interface Compound {
  tag?: string
  id?: string
  classes: string[]
  attrs: { name: string; op?: string; value?: string; i?: boolean }[]
  pseudos: { name: string; arg?: string; list?: Selector[] }[]
}

export interface Selector {
  /** Right-to-left: parts[0] is the subject. */
  parts: Compound[]
  /** combinators[i] links parts[i] to parts[i + 1]. */
  combinators: Combinator[]
  pseudoElement?: 'before' | 'after' | 'marker' | 'placeholder'
  specificity: number
}

export interface Rule {
  selector: Selector
  decls: Declaration[]
  order: number
  /** Cascade layer rank: earlier layers lose; unlayered rules (the default) beat all layers. */
  layer?: number
}

/** Layer rank of rules outside any `@layer`. */
export const UNLAYERED = Number.MAX_SAFE_INTEGER

export interface MediaEnv {
  /** Viewport width/height in CSS px. */
  width: number
  height: number
  dark: boolean
}

// ------------------------------------------------------------------ parsing

function stripComments(css: string) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Splits on `sep` at nesting depth 0 (outside (), [] and strings). */
export function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i))
      start = i + 1
    }
  }
  out.push(s.slice(start))
  return out
}

function parseDecls(body: string): Declaration[] {
  const out: Declaration[] = []
  for (const part of splitTop(body, ';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const prop = part.slice(0, i).trim()
    let value = part.slice(i + 1).trim()
    if (!prop || !value) continue
    let important = false
    const imp = /\s*!\s*important\s*$/i.exec(value)
    if (imp) {
      important = true
      value = value.slice(0, imp.index).trim()
    }
    out.push({ prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value, important })
  }
  return out
}

const PSEUDO_ELEMENTS = new Set(['before', 'after', 'marker', 'placeholder'])

function parseCompound(src: string): { compound: Compound; pseudoElement?: Selector['pseudoElement'] } | null {
  const c: Compound = { classes: [], attrs: [], pseudos: [] }
  let pseudoElement: Selector['pseudoElement']
  let i = 0
  const ident = () => {
    const m = /^(?:\\.|[\w-]|[^\x00-\x7f])+/.exec(src.slice(i))
    if (!m) return null
    i += m[0].length
    return m[0].replace(/\\(.)/g, '$1')
  }
  if (src[i] === '*') i++
  else if (/[\w-]/.test(src[i] ?? '')) {
    const t = ident()
    if (t) c.tag = t.toLowerCase()
  }
  while (i < src.length) {
    const ch = src[i]
    if (ch === '.') {
      i++
      const n = ident()
      if (!n) return null
      c.classes.push(n)
    } else if (ch === '#') {
      i++
      const n = ident()
      if (!n) return null
      c.id = n
    } else if (ch === '[') {
      const end = src.indexOf(']', i)
      if (end < 0) return null
      const m = /^\s*([\w-:]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?\s*$/.exec(src.slice(i + 1, end))
      if (!m) return null
      c.attrs.push({ name: m[1].replace(/^[\w-]*\|/, ''), op: m[2], value: m[3] ?? m[4] ?? m[5], i: !!m[6] })
      i = end + 1
    } else if (ch === ':') {
      const double = src[i + 1] === ':'
      i += double ? 2 : 1
      const n = ident()
      if (!n) return null
      const name = n.toLowerCase()
      let arg: string | undefined
      if (src[i] === '(') {
        let depth = 0
        let j = i
        for (; j < src.length; j++) {
          if (src[j] === '(') depth++
          else if (src[j] === ')' && --depth === 0) break
        }
        arg = src.slice(i + 1, j).trim()
        i = j + 1
      }
      if (PSEUDO_ELEMENTS.has(name) && (double || name === 'before' || name === 'after')) {
        pseudoElement = name as Selector['pseudoElement']
        continue
      }
      if (double) return null // other pseudo-elements (::selection, ::-webkit-*) never match
      const pseudo: Compound['pseudos'][number] = { name, arg }
      if (arg !== undefined && (name === 'not' || name === 'is' || name === 'where' || name === 'matches' || name === 'has')) {
        pseudo.list = parseSelectorList(arg)
      }
      c.pseudos.push(pseudo)
    } else return null
  }
  return { compound: c, pseudoElement }
}

const specOf = (c: Compound): number => {
  let s = (c.id ? 10000 : 0) + (c.classes.length + c.attrs.length) * 100 + (c.tag ? 1 : 0)
  for (const p of c.pseudos) {
    if (p.name === 'where') continue
    if (p.list) s += Math.max(0, ...p.list.map((x) => x.specificity))
    else s += 100
  }
  return s
}

export function parseSelector(src: string): Selector | null {
  src = src.trim()
  if (!src) return null
  // tokenize into compounds and combinators
  const tokens: string[] = []
  let cur = ''
  let depth = 0
  let quote = ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      cur += ch
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
    } else if (ch === '(' || ch === '[') {
      depth++
      cur += ch
    } else if (ch === ')' || ch === ']') {
      depth--
      cur += ch
    } else if (depth === 0 && (ch === '>' || ch === '+' || ch === '~' || /\s/.test(ch))) {
      if (cur) tokens.push(cur)
      cur = ''
      if (ch !== ' ' && !/\s/.test(ch)) tokens.push(ch)
      else if (tokens.length && !['>', '+', '~', ' '].includes(tokens[tokens.length - 1])) tokens.push(' ')
    } else cur += ch
  }
  if (cur) tokens.push(cur)
  // drop descendant markers adjacent to explicit combinators
  const clean: string[] = []
  for (const t of tokens) {
    const prev = clean[clean.length - 1]
    if (t === ' ' && (prev === undefined || ['>', '+', '~'].includes(prev))) continue
    if (['>', '+', '~'].includes(t) && prev === ' ') clean.pop()
    clean.push(t)
  }
  while (clean.length && clean[clean.length - 1] === ' ') clean.pop()
  const parts: Compound[] = []
  const combinators: Combinator[] = []
  let pseudoElement: Selector['pseudoElement']
  for (let k = 0; k < clean.length; k++) {
    const t = clean[k]
    if (t === ' ' || t === '>' || t === '+' || t === '~') {
      combinators.unshift(t)
      continue
    }
    const parsed = parseCompound(t)
    if (!parsed) return null
    if (parsed.pseudoElement) {
      if (k !== clean.length - 1) return null
      pseudoElement = parsed.pseudoElement
    }
    parts.unshift(parsed.compound)
  }
  if (!parts.length || combinators.length !== parts.length - 1) return null
  return { parts, combinators, pseudoElement, specificity: parts.reduce((a, c) => a + specOf(c), 0) }
}

export function parseSelectorList(src: string): Selector[] {
  const out: Selector[] = []
  for (const s of splitTop(src, ',')) {
    const sel = parseSelector(s)
    if (sel) out.push(sel)
  }
  return out
}

// ------------------------------------------------------------------ media queries

function px(v: string): number {
  const m = /^(-?[\d.]+)(px|em|rem)?$/.exec(v.trim())
  if (!m) return NaN
  const n = parseFloat(m[1])
  return m[2] === 'em' || m[2] === 'rem' ? n * 16 : n
}

export function matchMedia(query: string, env: MediaEnv): boolean {
  return splitTop(query, ',').some((q) => {
    let s = q.trim().toLowerCase()
    let negate = false
    if (s.startsWith('not ')) {
      negate = true
      s = s.slice(4)
    }
    s = s.replace(/^only\s+/, '')
    const parts = s.split(/\s+and\s+/)
    let ok = true
    for (const p of parts) {
      const t = p.trim()
      if (!t || t === 'all' || t === 'screen') continue
      if (t === 'print' || t === 'speech') {
        ok = false
        continue
      }
      const m = /^\(\s*([\w-]+)\s*(?::\s*(.+?))?\s*\)$/.exec(t)
      if (!m) {
        // range syntax: (width >= 600px), (400px <= width <= 800px)
        const r = /^\(\s*(?:([\d.]+\w*)\s*(<=|<|>=|>)\s*)?(width|height)\s*(?:(<=|<|>=|>)\s*([\d.]+\w*))?\s*\)$/.exec(t)
        if (!r) {
          ok = false
          continue
        }
        const val = r[3] === 'width' ? env.width : env.height
        const cmp = (a: number, op: string, b: number) => (op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b)
        if (r[1] && !cmp(px(r[1]), r[2], val)) ok = false
        if (r[5] && !cmp(val, r[4], px(r[5]))) ok = false
        continue
      }
      const [, feature, value = ''] = m
      switch (feature) {
        case 'min-width':
          if (!(env.width >= px(value))) ok = false
          break
        case 'max-width':
          if (!(env.width <= px(value))) ok = false
          break
        case 'min-height':
          if (!(env.height >= px(value))) ok = false
          break
        case 'max-height':
          if (!(env.height <= px(value))) ok = false
          break
        case 'prefers-color-scheme':
          if ((value === 'dark') !== env.dark) ok = false
          break
        case 'orientation':
          if ((value === 'landscape') !== env.width >= env.height) ok = false
          break
        case 'hover':
        case 'any-hover':
          if (value === 'none') ok = false
          break
        case 'pointer':
        case 'any-pointer':
          if (value !== 'fine') ok = false
          break
        case 'prefers-reduced-motion':
          // terminals don't animate: behave like "reduce"
          if (value !== 'reduce') ok = false
          break
        default:
          // unknown features (min-resolution, display-mode, ...) don't match
          ok = false
      }
    }
    return negate ? !ok : ok
  })
}

// ------------------------------------------------------------------ stylesheet

const SKIP_AT = /^@(keyframes|-webkit-keyframes|-moz-keyframes|font-face|page|counter-style|property|font-feature-values|view-transition)\b/i

export class StyleSheet {
  readonly rules: Rule[] = []
  /** The page has `prefers-color-scheme: dark` styles (otherwise it assumes a white page). */
  supportsDark = false
  /** Rules inside @media, re-evaluated when the environment changes. */
  private conditional: { media: string; rules: Rule[] }[] = []
  private order: number

  /** `startOrder`: source order of the first rule (a later sheet starts after an earlier one). */
  constructor(css = '', startOrder = 0) {
    this.order = startOrder
    if (css) this.add(css)
  }

  add(css: string) {
    this.parseBlock(stripComments(css), null, UNLAYERED, '')
  }

  /** Layer names in order of first appearance (`@layer theme, base, utilities;` declares the order). */
  private layerRanks = new Map<string, number>()
  private layerRank(name: string) {
    let r = this.layerRanks.get(name)
    if (r === undefined) this.layerRanks.set(name, (r = this.layerRanks.size))
    return r
  }

  private parseBlock(css: string, media: string | null, layer: number, layerName: string) {
    let i = 0
    while (i < css.length) {
      while (i < css.length && /\s/.test(css[i])) i++
      if (i >= css.length) break
      if (css[i] === '@') {
        const semi = css.indexOf(';', i)
        const brace = css.indexOf('{', i)
        if (brace < 0 || (semi >= 0 && semi < brace)) {
          // statement at-rule: @import, @charset, @layer a, b; (the latter fixes the layer order)
          const stmt = css.slice(i, semi < 0 ? css.length : semi)
          const lm = /^@layer\s+(.+)$/is.exec(stmt.trim())
          if (lm) for (const n of lm[1].split(',')) this.layerRank(layerName ? `${layerName}.${n.trim()}` : n.trim())
          i = semi < 0 ? css.length : semi + 1
          continue
        }
        const prelude = css.slice(i, brace).trim()
        const end = matchBrace(css, brace)
        const body = css.slice(brace + 1, end)
        i = end + 1
        if (SKIP_AT.test(prelude)) continue
        const mm = /^@media\s+(.+)$/is.exec(prelude)
        if (mm) {
          if (/prefers-color-scheme\s*:\s*dark/i.test(mm[1])) this.supportsDark = true
          this.parseBlock(body, media ? `${media} and ${mm[1]}` : mm[1], layer, layerName)
          continue
        }
        const lb = /^@layer(?:\s+([^{]+))?$/is.exec(prelude)
        if (lb) {
          const name = lb[1]?.trim() || `<anonymous ${this.layerRanks.size}>`
          const full = layerName ? `${layerName}.${name}` : name
          this.parseBlock(body, media, this.layerRank(full), full)
          continue
        }
        // @supports, @container, @scope, @document: use the contents
        this.parseBlock(body, media, layer, layerName)
        continue
      }
      const brace = css.indexOf('{', i)
      if (brace < 0) break
      const end = matchBrace(css, brace)
      const selectorText = css.slice(i, brace).trim()
      const body = css.slice(brace + 1, end)
      i = end + 1
      // CSS nesting: a body containing rules is flattened one level
      const nested = /\{/.test(body)
      const decls = parseDecls(nested ? body.replace(/[^;{}]*\{[^{}]*\}/g, '') : body)
      const selectors = parseSelectorList(selectorText)
      const rules: Rule[] = []
      for (const selector of selectors) rules.push({ selector, decls, order: this.order++, layer })
      if (nested) {
        for (const m of body.matchAll(/([^;{}]+)\{([^{}]*)\}/g)) {
          const inner = m[1].trim()
          const combined = splitTop(selectorText, ',')
            .flatMap((outer) => splitTop(inner, ',').map((s) => (s.includes('&') ? s.replace(/&/g, outer.trim()) : `${outer.trim()} ${s.trim()}`)))
            .join(',')
          for (const selector of parseSelectorList(combined)) rules.push({ selector, decls: parseDecls(m[2]), order: this.order++, layer })
        }
      }
      if (media) this.conditional.push({ media, rules })
      else this.rules.push(...rules)
    }
  }

  /** Rules that apply in `env` (unconditional + matching @media), in source order. */
  activeRules(env: MediaEnv): Rule[] {
    const out = [...this.rules]
    for (const c of this.conditional) if (matchMedia(c.media, env)) out.push(...c.rules)
    return out.sort((a, b) => a.order - b.order)
  }
}

function matchBrace(s: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return s.length
}

// ------------------------------------------------------------------ matching

/** What the matcher needs to know about an element. */
export interface MatchTarget {
  tag: string
  id(): string | undefined
  hasClass(c: string): boolean
  attr(name: string): string | undefined
  parent(): MatchTarget | null
  prevSibling(): MatchTarget | null
  /** Element siblings including self, in order. */
  siblings(): MatchTarget[]
  isEmpty(): boolean
  state(name: 'hover' | 'focus' | 'focus-within' | 'checked' | 'active'): boolean
  same(other: MatchTarget): boolean
}

function nth(arg: string, index: number): boolean {
  const a = arg.toLowerCase().replace(/\s+of\s+.*$/, '').replace(/\s+/g, '')
  if (a === 'odd') return index % 2 === 1
  if (a === 'even') return index % 2 === 0
  if (/^[+-]?\d+$/.test(a)) return index === parseInt(a, 10)
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(a)
  if (!m) return false
  const A = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : parseInt(m[1], 10)
  const B = m[2] ? parseInt(m[2], 10) : 0
  if (A === 0) return index === B
  const k = (index - B) / A
  return k >= 0 && Number.isInteger(k)
}

function matchCompound(c: Compound, el: MatchTarget): boolean {
  if (c.tag && c.tag !== el.tag) return false
  if (c.id && el.id() !== c.id) return false
  for (const cls of c.classes) if (!el.hasClass(cls)) return false
  for (const a of c.attrs) {
    const v = el.attr(a.name)
    if (v === undefined) return false
    if (!a.op) continue
    let have = v
    let want = a.value ?? ''
    if (a.i) {
      have = have.toLowerCase()
      want = want.toLowerCase()
    }
    switch (a.op) {
      case '=':
        if (have !== want) return false
        break
      case '~=':
        if (!have.split(/\s+/).includes(want)) return false
        break
      case '|=':
        if (have !== want && !have.startsWith(want + '-')) return false
        break
      case '^=':
        if (!want || !have.startsWith(want)) return false
        break
      case '$=':
        if (!want || !have.endsWith(want)) return false
        break
      case '*=':
        if (!want || !have.includes(want)) return false
        break
    }
  }
  for (const p of c.pseudos) if (!matchPseudo(p, el)) return false
  return true
}

function matchPseudo(p: Compound['pseudos'][number], el: MatchTarget): boolean {
  switch (p.name) {
    case 'hover':
      return el.state('hover')
    case 'focus':
    case 'focus-visible':
      return el.state('focus')
    case 'focus-within':
      return el.state('focus-within')
    case 'active':
      return el.state('active')
    case 'checked':
      return el.state('checked')
    case 'disabled':
      return el.attr('disabled') !== undefined
    case 'enabled':
      return el.attr('disabled') === undefined
    case 'required':
      return el.attr('required') !== undefined
    case 'optional':
      return el.attr('required') === undefined
    case 'read-only':
      return el.attr('readonly') !== undefined
    case 'read-write':
      return el.attr('readonly') === undefined
    case 'placeholder-shown':
      return el.attr('placeholder') !== undefined && !el.attr('value')
    case 'link':
    case 'any-link':
      return el.tag === 'a' && el.attr('href') !== undefined
    case 'visited':
    case 'target':
    case 'indeterminate':
    case 'invalid':
      return false
    case 'valid':
      return true
    case 'root':
      return el.tag === 'html'
    case 'scope':
      return el.tag === 'html'
    case 'empty':
      return el.isEmpty()
    case 'first-child':
      return el.siblings()[0]?.same(el) ?? false
    case 'last-child': {
      const s = el.siblings()
      return s[s.length - 1]?.same(el) ?? false
    }
    case 'only-child':
      return el.siblings().length === 1
    case 'first-of-type':
      return el.siblings().find((s) => s.tag === el.tag)?.same(el) ?? false
    case 'last-of-type': {
      const s = el.siblings().filter((x) => x.tag === el.tag)
      return s[s.length - 1]?.same(el) ?? false
    }
    case 'only-of-type':
      return el.siblings().filter((x) => x.tag === el.tag).length === 1
    case 'nth-child':
    case 'nth-last-child':
    case 'nth-of-type':
    case 'nth-last-of-type': {
      let s = el.siblings()
      if (p.name.endsWith('of-type')) s = s.filter((x) => x.tag === el.tag)
      if (p.name.includes('last')) s = [...s].reverse()
      const i = s.findIndex((x) => x.same(el))
      return i >= 0 && nth(p.arg ?? '', i + 1)
    }
    case 'not':
      return !(p.list ?? []).some((sel) => matches(sel, el))
    case 'is':
    case 'where':
    case 'matches':
      return (p.list ?? []).some((sel) => matches(sel, el))
    case 'has':
      return false
    default:
      // :lang(), :dir(), vendor pseudo-classes, ...
      return false
  }
}

/** True when `sel` matches `el` (ignores the pseudo-element). */
export function matches(sel: Selector, el: MatchTarget): boolean {
  return matchFrom(sel, 0, el)
}

function matchFrom(sel: Selector, i: number, el: MatchTarget): boolean {
  if (!matchCompound(sel.parts[i], el)) return false
  if (i === sel.parts.length - 1) return true
  const comb = sel.combinators[i]
  if (comb === '>') {
    const p = el.parent()
    return !!p && matchFrom(sel, i + 1, p)
  }
  if (comb === ' ') {
    for (let p = el.parent(); p; p = p.parent()) if (matchFrom(sel, i + 1, p)) return true
    return false
  }
  if (comb === '+') {
    const prev = el.prevSibling()
    return !!prev && matchFrom(sel, i + 1, prev)
  }
  for (let prev = el.prevSibling(); prev; prev = prev.prevSibling()) if (matchFrom(sel, i + 1, prev)) return true
  return false
}

/**
 * Rules bucketed by the subject compound's most specific key, so an element
 * only checks rules that could possibly match it.
 */
export class RuleIndex {
  private byId = new Map<string, Rule[]>()
  private byClass = new Map<string, Rule[]>()
  private byTag = new Map<string, Rule[]>()
  private universal: Rule[] = []

  constructor(rules: Rule[]) {
    for (const r of rules) {
      const subject = r.selector.parts[0]
      const push = (m: Map<string, Rule[]>, k: string) => {
        let l = m.get(k)
        if (!l) m.set(k, (l = []))
        l.push(r)
      }
      if (subject.id) push(this.byId, subject.id)
      else if (subject.classes.length) push(this.byClass, subject.classes[0])
      else if (subject.tag) push(this.byTag, subject.tag)
      else this.universal.push(r)
    }
  }

  /** Matching rules for `el`, sorted by specificity then source order. */
  match(el: MatchTarget, classes: string[]): Rule[] {
    const cand: Rule[] = [...this.universal]
    const id = el.id()
    if (id) cand.push(...(this.byId.get(id) ?? []))
    for (const c of classes) cand.push(...(this.byClass.get(c) ?? []))
    cand.push(...(this.byTag.get(el.tag) ?? []))
    const out = cand.filter((r) => matches(r.selector, el))
    return out.sort((a, b) => (a.layer ?? UNLAYERED) - (b.layer ?? UNLAYERED) || a.selector.specificity - b.selector.specificity || a.order - b.order)
  }
}

// ------------------------------------------------------------------ values

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000',
  olive: '#808000', lime: '#00ff00', aqua: '#00ffff', cyan: '#00ffff', teal: '#008080', navy: '#000080',
  fuchsia: '#ff00ff', magenta: '#ff00ff', pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700', indigo: '#4b0082',
  violet: '#ee82ee', coral: '#ff7f50', crimson: '#dc143c', tomato: '#ff6347', salmon: '#fa8072', khaki: '#f0e68c',
  beige: '#f5f5dc', ivory: '#fffff0', lavender: '#e6e6fa', tan: '#d2b48c', chocolate: '#d2691e', firebrick: '#b22222',
  darkred: '#8b0000', darkgreen: '#006400', darkblue: '#00008b', darkgray: '#a9a9a9', darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3', lightgrey: '#d3d3d3', dimgray: '#696969', dimgrey: '#696969', gainsboro: '#dcdcdc',
  whitesmoke: '#f5f5f5', snow: '#fffafa', ghostwhite: '#f8f8ff', aliceblue: '#f0f8ff', azure: '#f0ffff',
  honeydew: '#f0fff0', mintcream: '#f5fffa', seashell: '#fff5ee', linen: '#faf0e6', oldlace: '#fdf5e6',
  floralwhite: '#fffaf0', lightblue: '#add8e6', lightgreen: '#90ee90', lightyellow: '#ffffe0', lightpink: '#ffb6c1',
  lightcoral: '#f08080', lightcyan: '#e0ffff', lightsalmon: '#ffa07a', lightseagreen: '#20b2aa', lightskyblue: '#87cefa',
  lightslategray: '#778899', lightsteelblue: '#b0c4de', skyblue: '#87ceeb', steelblue: '#4682b4', royalblue: '#4169e1',
  dodgerblue: '#1e90ff', deepskyblue: '#00bfff', cornflowerblue: '#6495ed', cadetblue: '#5f9ea0', slateblue: '#6a5acd',
  slategray: '#708090', slategrey: '#708090', darkslategray: '#2f4f4f', midnightblue: '#191970', mediumblue: '#0000cd',
  seagreen: '#2e8b57', forestgreen: '#228b22', limegreen: '#32cd32', springgreen: '#00ff7f', mediumseagreen: '#3cb371',
  darkolivegreen: '#556b2f', yellowgreen: '#9acd32', olivedrab: '#6b8e23', lawngreen: '#7cfc00', chartreuse: '#7fff00',
  turquoise: '#40e0d0', darkturquoise: '#00ced1', mediumturquoise: '#48d1cc', aquamarine: '#7fffd4', darkcyan: '#008b8b',
  orangered: '#ff4500', darkorange: '#ff8c00', goldenrod: '#daa520', darkgoldenrod: '#b8860b', peru: '#cd853f',
  sienna: '#a0522d', saddlebrown: '#8b4513', rosybrown: '#bc8f8f', sandybrown: '#f4a460', wheat: '#f5deb3',
  burlywood: '#deb887', moccasin: '#ffe4b5', peachpuff: '#ffdab9', bisque: '#ffe4c4', mistyrose: '#ffe4e1',
  hotpink: '#ff69b4', deeppink: '#ff1493', palevioletred: '#db7093', mediumvioletred: '#c71585', orchid: '#da70d6',
  plum: '#dda0dd', thistle: '#d8bfd8', darkviolet: '#9400d3', darkorchid: '#9932cc', darkmagenta: '#8b008b',
  mediumpurple: '#9370db', mediumorchid: '#ba55d3', blueviolet: '#8a2be2', rebeccapurple: '#663399',
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

function hslToHex(h: number, s: number, l: number) {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return `#${hex2(f(0) * 255)}${hex2(f(8) * 255)}${hex2(f(4) * 255)}`
}

/**
 * CSS color → `#rrggbb`, `'transparent'`, or undefined when unsupported.
 * `alpha` receives the alpha channel (0..1).
 */
export function cssColor(value: string, alpha?: { a: number }): string | undefined {
  const v = value.trim().toLowerCase()
  if (alpha) alpha.a = 1
  if (v === 'transparent') return 'transparent'
  if (NAMED[v]) return NAMED[v]
  let m = /^#([0-9a-f]{3,8})$/.exec(v)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return undefined
    if (alpha && h.length === 8) alpha.a = parseInt(h.slice(6), 16) / 255
    return `#${h.slice(0, 6)}`
  }
  m = /^rgba?\(\s*([^)]+)\)$/.exec(v)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean)
    const ch = (s: string) => (s.endsWith('%') ? (parseFloat(s) * 255) / 100 : parseFloat(s))
    if (parts.length < 3 || parts.slice(0, 3).some((p) => !Number.isFinite(ch(p)))) return undefined
    if (alpha && parts[3] !== undefined) alpha.a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    return `#${hex2(ch(parts[0]))}${hex2(ch(parts[1]))}${hex2(ch(parts[2]))}`
  }
  m = /^hsla?\(\s*([^)]+)\)$/.exec(v)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) return undefined
    const h = parseFloat(parts[0]) * (parts[0].endsWith('turn') ? 360 : 1)
    if (alpha && parts[3] !== undefined) alpha.a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    return hslToHex(((h % 360) + 360) % 360, parseFloat(parts[1]), parseFloat(parts[2]))
  }
  // oklch() / oklab(): Tailwind v4's whole palette
  m = /^ok(lch|lab)\(\s*([^)]+)\)$/.exec(v)
  if (m) {
    const parts = m[2].split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) return undefined
    const num = (s: string, pct = 1) => (s === 'none' ? 0 : s.endsWith('%') ? (parseFloat(s) / 100) * pct : parseFloat(s))
    const L = num(parts[0])
    let a: number
    let b: number
    if (m[1] === 'lch') {
      const C = num(parts[1], 0.4)
      const H = (num(parts[2]) * Math.PI) / 180
      a = C * Math.cos(H)
      b = C * Math.sin(H)
    } else {
      a = num(parts[1], 0.4)
      b = num(parts[2], 0.4)
    }
    if (![L, a, b].every(Number.isFinite)) return undefined
    if (alpha && parts[3] !== undefined) alpha.a = num(parts[3])
    return oklabToHex(L, a, b)
  }
  // color-mix(in <space>, c1 [p1], c2 [p2]): mixed in sRGB, alpha carried (`/50` = mix with transparent)
  m = /^color-mix\(\s*in\s+[a-z-]+(?:\s+[a-z]+\s+hue)?\s*,(.*)\)$/.exec(v)
  if (m) {
    const args = splitTop(m[1], ',').map((x) => x.trim())
    if (args.length !== 2) return undefined
    const parsed = args.map((arg) => {
      const pm = /\s(\d*\.?\d+)%$/.exec(arg)
      const color = (pm ? arg.slice(0, pm.index) : arg).trim()
      const al = { a: 1 }
      const hex = cssColor(color, al)
      return { hex, a: hex === 'transparent' ? 0 : al.a, p: pm ? parseFloat(pm[1]) / 100 : undefined }
    })
    if (parsed.some((x) => !x.hex)) return undefined
    let [p1, p2] = [parsed[0].p, parsed[1].p]
    if (p1 === undefined && p2 === undefined) p1 = p2 = 0.5
    else if (p1 === undefined) p1 = 1 - p2!
    else if (p2 === undefined) p2 = 1 - p1
    const sum = p1 + p2!
    const w1 = p1 / sum
    const w2 = p2! / sum
    const a1 = parsed[0].a * w1
    const a2 = parsed[1].a * w2
    const outA = (a1 + a2) * Math.min(1, sum)
    if (alpha) alpha.a = outA
    // premultiplied: a transparent side contributes no color
    const rgb = (h: string) => (h === 'transparent' ? [0, 0, 0] : [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)))
    const [c1, c2] = [rgb(parsed[0].hex!), rgb(parsed[1].hex!)]
    if (a1 + a2 === 0) return 'transparent'
    const ch = (i: number) => (c1[i] * a1 + c2[i] * a2) / (a1 + a2)
    return `#${hex2(ch(0))}${hex2(ch(1))}${hex2(ch(2))}`
  }
  return undefined
}

/** OKLab → sRGB hex (https://bottosson.github.io/posts/oklab/), clamped to the gamut. */
function oklabToHex(L: number, a: number, b: number): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  const enc = (x: number) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)
  return `#${lin.map((x) => hex2(Math.max(0, Math.min(255, enc(Math.max(0, x)))))).join('')}`
}

/** Finds the first color token in a shorthand (`background`, `border`). */
export function findColor(value: string, alpha?: { a: number }): string | undefined {
  for (const tok of splitTop(value.replace(/\s+/g, ' '), ' ')) {
    const c = cssColor(tok, alpha)
    if (c) return c
  }
  return undefined
}

/** Resolves `var(--x, fallback)` against custom properties (recursively). */
export function resolveVars(value: string, vars: Map<string, string>, depth = 0): string {
  if (!value.includes('var(') || depth > 8) return value
  let out = ''
  let i = 0
  while (i < value.length) {
    const start = value.indexOf('var(', i)
    if (start < 0) {
      out += value.slice(i)
      break
    }
    out += value.slice(i, start)
    let d = 0
    let j = start + 3
    for (; j < value.length; j++) {
      if (value[j] === '(') d++
      else if (value[j] === ')' && --d === 0) break
    }
    const inner = value.slice(start + 4, j)
    const comma = splitTop(inner, ',')
    const name = comma[0].trim()
    const fallback = comma.length > 1 ? comma.slice(1).join(',').trim() : ''
    const v = vars.get(name)
    out += resolveVars(v !== undefined ? v : fallback, vars, depth + 1)
    i = j + 1
  }
  return out
}

/** Decodes a CSS string token: `"\2715"` → `✕`. */
export function cssString(v: string): string | undefined {
  const m = /^(["'])([\s\S]*)\1$/.exec(v.trim())
  if (!m) return undefined
  return m[2].replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_, hex: string, ch: string) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : ch))
}
