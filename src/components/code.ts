import { computed, defineComponent, h, type PropType, type VNodeChild } from 'vue'
import { useTheme } from '../composables.js'
import type { Theme } from '../style/theme.js'

// ------------------------------------------------------------------ tokenizer

export type CodeTokenType =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'function'
  | 'type'
  | 'builtin'
  | 'variable'
  | 'property'
  | 'operator'
  | 'punctuation'
  | 'tag'
  | 'attr'
  | 'constant'
  | 'regex'
  | 'decorator'
  | 'heading'

export interface CodeToken {
  type: CodeTokenType
  text: string
}

type Rule = [RegExp, CodeTokenType | ((m: RegExpExecArray, ctx: RuleContext) => CodeTokenType | CodeToken[])]
interface RuleContext {
  /** Previous non-whitespace token. */
  prev: CodeToken | undefined
  rest: string
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

const JS_KEYWORDS = words(`
  break case catch class const continue debugger default delete do else export extends finally for from function
  if import in instanceof let new of return static super switch this throw try typeof var void while with yield
  async await get set as satisfies implements interface type enum declare namespace module abstract private
  protected public readonly override keyof infer is asserts unique accessor`)
const JS_CONSTANTS = words('true false null undefined NaN Infinity')
const JS_BUILTINS = words(`
  console window document globalThis process require Math JSON Object Array String Number Boolean Symbol BigInt
  Promise Map Set WeakMap WeakSet Date RegExp Error TypeError Intl Reflect Proxy parseInt parseFloat setTimeout
  setInterval clearTimeout clearInterval fetch structuredClone queueMicrotask`)
const TS_TYPES = words('string number boolean any unknown never void object bigint symbol')

const PY_KEYWORDS = words(`
  and as assert async await break class continue def del elif else except finally for from global if import in is
  lambda nonlocal not or pass raise return try while with yield match case`)
const PY_CONSTANTS = words('True False None Ellipsis NotImplemented')
const PY_BUILTINS = words(`
  print len range open int str float bool list dict set tuple type isinstance issubclass enumerate zip map filter
  sorted reversed sum min max abs any all iter next super object property staticmethod classmethod repr input
  getattr setattr hasattr format round id hash vars dir self cls`)

const SH_KEYWORDS = words('if then else elif fi for while until do done case esac in function select time return exit local export readonly declare unset shift break continue')
const SH_BUILTINS = words(`
  echo printf cd pwd ls cat grep sed awk find xargs rm cp mv mkdir rmdir touch chmod chown ln test read source
  eval exec kill trap wait sleep set alias unalias type which head tail sort uniq wc cut tr tee curl wget git npm
  npx node pnpm yarn docker make sudo ssh tar gzip env true false`)

/** JavaScript / TypeScript (also JSX-ish code without markup highlighting). */
function jsRules(ts: boolean): Rule[] {
  return [
    [/\/\/[^\n]*/y, 'comment'],
    [/\/\*[\s\S]*?(?:\*\/|$)/y, 'comment'],
    [/`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`?/y, 'string'],
    [/"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y, 'string'],
    [/@[A-Za-z_$][\w$]*/y, 'decorator'],
    [/(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/y, 'number'],
    [
      /\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+\/[dgimsuyv]*/y,
      (m, ctx) => {
        // a regex literal can only start where an expression is expected
        const p = ctx.prev
        const exprStart = !p || p.type === 'operator' || p.type === 'keyword' || (p.type === 'punctuation' && /[([{,;:]$/.test(p.text))
        return exprStart ? 'regex' : [{ type: 'operator', text: '/' }]
      },
    ],
    [
      /[A-Za-z_$][\w$]*/y,
      (m, ctx) => {
        const w = m[0]
        if (JS_KEYWORDS.has(w)) return ctx.prev?.text === '.' ? 'property' : 'keyword'
        if (JS_CONSTANTS.has(w)) return 'constant'
        if (ts && TS_TYPES.has(w)) return 'type'
        if (ctx.prev?.text === '.') return /^\s*\(/.test(ctx.rest) ? 'function' : 'property'
        if (/^\s*(?:\(|=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>)/.test(ctx.rest) || /^\s*`/.test(ctx.rest)) return 'function'
        if (JS_BUILTINS.has(w)) return 'builtin'
        if (/^[A-Z]/.test(w)) return 'type'
        return 'variable'
      },
    ],
    [/=>|\.\.\.|\?\?=?|\?\.|[=!]==?|[<>]=?|&&=?|\|\|=?|\*\*=?|[-+*/%&|^~!?]=?|=/y, 'operator'],
    [/[{}()[\];,.:]/y, 'punctuation'],
  ]
}

const JSON_RULES: Rule[] = [
  [/"(?:\\.|[^"\\\n])*"?(?=\s*:)/y, 'property'],
  [/"(?:\\.|[^"\\\n])*"?/y, 'string'],
  [/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y, 'number'],
  [/\b(?:true|false|null)\b/y, 'constant'],
  [/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, 'comment'],
  [/[{}[\],:]/y, 'punctuation'],
]

const CSS_RULES: Rule[] = [
  [/\/\*[\s\S]*?(?:\*\/|$)/y, 'comment'],
  [/\/\/[^\n]*/y, 'comment'],
  [/"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y, 'string'],
  [/@[\w-]+/y, 'keyword'],
  [/#[\da-fA-F]{3,8}\b/y, 'number'],
  [/-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?/y, 'number'],
  [/--[\w-]+|\$[\w-]+/y, 'variable'],
  [/!important\b/y, 'keyword'],
  [
    /[a-zA-Z_-][\w-]*/y,
    (m, ctx) => {
      if (/^\s*:(?!:)/.test(ctx.rest) && !/^\s*:[\w-]+\s*[{,]/.test(ctx.rest)) return 'property'
      if (/^\(/.test(ctx.rest)) return 'function'
      if (ctx.prev && (ctx.prev.text === ':' || ctx.prev.type === 'number' || ctx.prev.type === 'constant')) return 'constant'
      return 'tag'
    },
  ],
  [/[.#][\w-]+|::?[\w-]+/y, 'attr'],
  [/[{}();,:>+~*=[\]]/y, 'punctuation'],
]

const SH_RULES: Rule[] = [
  [/#![^\n]*/y, 'comment'],
  [/(?<![\w$])#[^\n]*/y, 'comment'],
  [/'[^']*'?/y, 'string'],
  [/"(?:\\.|\$\([^)]*\)|[^"\\])*"?/y, 'string'],
  [/\$\{[^}]*\}?|\$\(|\$[\w@#?$!*-]/y, 'variable'],
  [/(?<![\w-])--?[\w][\w-]*(=)?/y, 'attr'],
  [/\b\d+\b/y, 'number'],
  [
    /[\w./-][\w./-]*/y,
    (m, ctx) => {
      const w = m[0]
      if (/^=/.test(ctx.rest) && /^[A-Za-z_]\w*$/.test(w)) return 'variable'
      if (SH_KEYWORDS.has(w)) return 'keyword'
      const cmdPos = !ctx.prev || /^(?:\||&&|\|\||;|\(|`|\$\(|then|do|else|sudo|exec|xargs|time)$/.test(ctx.prev.text) || ctx.prev.type === 'keyword'
      if (SH_BUILTINS.has(w) || (cmdPos && /^[A-Za-z_][\w.-]*$/.test(w))) return 'function'
      return 'plain'
    },
  ],
  [/&&|\|\||;;|[|&;<>]=?|>>|<<-?|=/y, 'operator'],
  [/[(){}[\]]/y, 'punctuation'],
]

const PY_RULES: Rule[] = [
  [/#[^\n]*/y, 'comment'],
  [/[rRbBuUfF]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/y, 'string'],
  [/[rRbBuUfF]{0,2}(?:"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)/y, 'string'],
  [/@[\w.]+/y, 'decorator'],
  [/(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[jJ]?/y, 'number'],
  [
    /[A-Za-z_]\w*/y,
    (m, ctx) => {
      const w = m[0]
      if (ctx.prev?.text === 'def') return 'function'
      if (ctx.prev?.text === 'class') return 'type'
      if (PY_KEYWORDS.has(w)) return 'keyword'
      if (PY_CONSTANTS.has(w)) return 'constant'
      if (ctx.prev?.text === '.') return /^\s*\(/.test(ctx.rest) ? 'function' : 'property'
      if (PY_BUILTINS.has(w)) return 'builtin'
      if (/^\s*\(/.test(ctx.rest)) return 'function'
      if (/^[A-Z]/.test(w)) return 'type'
      return 'variable'
    },
  ],
  [/->|\*\*=?|\/\/=?|[=!<>]=|<<=?|>>=?|:=|[-+*/%&|^~<>@]=?|=/y, 'operator'],
  [/[{}()[\];,.:]/y, 'punctuation'],
]

const MD_RULES: Rule[] = [
  [/^#{1,6}[^\n]*/my, 'heading'],
  [/```[\s\S]*?(?:```|$)|`[^`\n]*`?/y, 'string'],
  [/\*\*[^*\n]+\*\*|__[^_\n]+__/y, 'keyword'],
  [/\[[^\]\n]*\]\([^)\n]*\)/y, 'function'],
  [/^\s*(?:[-*+]|\d+\.)\s/my, 'punctuation'],
  [/^>[^\n]*/my, 'comment'],
]

const LANGS: Record<string, Rule[]> = {
  js: jsRules(false),
  ts: jsRules(true),
  json: JSON_RULES,
  css: CSS_RULES,
  bash: SH_RULES,
  python: PY_RULES,
  markdown: MD_RULES,
}

const ALIASES: Record<string, string> = {
  javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
  typescript: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  jsonc: 'json', json5: 'json',
  scss: 'css', less: 'css', postcss: 'css',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', shellscript: 'bash',
  py: 'python', python3: 'python',
  md: 'markdown',
  htm: 'html', xml: 'html', svg: 'html', vue: 'vue',
  text: 'plain', txt: 'plain', plaintext: 'plain',
}

/** Normalized language id (`'typescript'` → `'ts'`), or `'plain'` if unsupported. */
export function normalizeLanguage(lang: string | undefined): string {
  const l = (lang ?? 'plain').toLowerCase().trim()
  const a = ALIASES[l] ?? l
  return a in LANGS || a === 'html' || a === 'vue' ? a : 'plain'
}

function push(out: CodeToken[], type: CodeTokenType, text: string) {
  if (!text) return
  const last = out[out.length - 1]
  if (last && last.type === type) last.text += text
  else out.push({ type, text })
}

function runRules(code: string, rules: Rule[], out: CodeToken[]) {
  let i = 0
  let prev: CodeToken | undefined
  let plain = ''
  const flush = () => {
    if (plain) push(out, 'plain', plain)
    plain = ''
  }
  outer: while (i < code.length) {
    const c = code[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      plain += c
      i++
      continue
    }
    for (const [re, type] of rules) {
      re.lastIndex = i
      const m = re.exec(code)
      if (!m || m[0].length === 0) continue
      const ctx: RuleContext = { prev, rest: code.slice(i + m[0].length, i + m[0].length + 80) }
      const t = typeof type === 'function' ? type(m, ctx) : type
      flush()
      if (Array.isArray(t)) {
        let len = 0
        for (const tok of t) {
          push(out, tok.type, tok.text)
          len += tok.text.length
          prev = tok
        }
        i += len
      } else {
        const tok = { type: t, text: m[0] }
        push(out, t, m[0])
        prev = tok
        i += m[0].length
      }
      continue outer
    }
    plain += c
    prev = { type: 'plain', text: c }
    i++
  }
  flush()
}

function tokenizeMarkup(code: string, out: CodeToken[], vue: boolean) {
  const re = /<!--[\s\S]*?(?:-->|$)|<\/?([A-Za-z][\w:.-]*)((?:\s+(?:[^\s"'>/=]+)(?:\s*=\s*(?:"[^"]*"?|'[^']*'?|[^\s>]+))?)*)\s*(\/?)>?|\{\{[\s\S]*?(?:\}\}|$)|&[#\w]+;/g
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    if (m.index > i) push(out, 'plain', code.slice(i, m.index))
    const s = m[0]
    if (s.startsWith('<!--')) push(out, 'comment', s)
    else if (s.startsWith('{{')) {
      push(out, 'punctuation', '{{')
      runRules(s.slice(2, s.endsWith('}}') ? -2 : undefined), LANGS.ts, out)
      if (s.endsWith('}}')) push(out, 'punctuation', '}}')
    } else if (s.startsWith('&')) push(out, 'constant', s)
    else {
      const closing = s.startsWith('</')
      push(out, 'punctuation', closing ? '</' : '<')
      push(out, 'tag', m[1])
      const attrs = m[2] ?? ''
      const attrRe = /(\s+)([^\s"'>/=]+)(?:(\s*=\s*)("[^"]*"?|'[^']*'?|[^\s>]+))?/g
      let a: RegExpExecArray | null
      while ((a = attrRe.exec(attrs))) {
        push(out, 'plain', a[1])
        const name = a[2]
        const dynamic = vue && /^(?::|@|v-|#)/.test(name)
        push(out, dynamic ? 'keyword' : 'attr', name)
        if (a[3] !== undefined) {
          push(out, 'operator', a[3])
          const v = a[4]
          if (dynamic && /^["']/.test(v)) {
            push(out, 'string', v[0])
            runRules(v.slice(1, v.length > 1 && v.endsWith(v[0]) ? -1 : undefined), LANGS.ts, out)
            if (v.length > 1 && v.endsWith(v[0])) push(out, 'string', v[0])
          } else push(out, 'string', v)
        }
      }
      const rest = s.slice(1 + (closing ? 1 : 0) + m[1].length + attrs.length)
      if (rest) push(out, 'punctuation', rest)
      // embedded <script> / <style>
      const tag = m[1].toLowerCase()
      if (!closing && !m[3] && s.endsWith('>') && (tag === 'script' || tag === 'style')) {
        const end = code.toLowerCase().indexOf(`</${tag}`, re.lastIndex)
        const stop = end < 0 ? code.length : end
        const body = code.slice(re.lastIndex, stop)
        const lang = /\blang\s*=\s*["']?(\w+)/.exec(attrs)?.[1]
        const rules = tag === 'style' ? CSS_RULES : LANGS[normalizeLanguage(lang ?? 'ts')] ?? LANGS.ts
        runRules(body, rules, out)
        re.lastIndex = stop
      }
    }
    i = re.lastIndex
  }
  if (i < code.length) push(out, 'plain', code.slice(i))
}

/** Tokenizes source code into a flat token list. */
export function tokenizeCode(code: string, language?: string): CodeToken[] {
  const lang = normalizeLanguage(language)
  const out: CodeToken[] = []
  if (lang === 'plain') push(out, 'plain', code)
  else if (lang === 'html' || lang === 'vue') tokenizeMarkup(code, out, lang === 'vue')
  else runRules(code, LANGS[lang], out)
  return out
}

/** Tokenizes and splits into lines (tokens never span a line break). */
export function tokenizeCodeLines(code: string, language?: string): CodeToken[][] {
  const lines: CodeToken[][] = [[]]
  for (const t of tokenizeCode(code.replace(/\r\n?/g, '\n').replace(/\t/g, '  '), language)) {
    const parts = t.text.split('\n')
    parts.forEach((p, i) => {
      if (i) lines.push([])
      if (p) lines[lines.length - 1].push({ type: t.type, text: p })
    })
  }
  return lines
}

// ------------------------------------------------------------------ colors

/** Default token colors (theme tokens). Override per theme with `syntax.<type>` theme keys. */
export const SYNTAX_COLORS: Record<CodeTokenType, string> = {
  plain: 'text',
  keyword: 'accent',
  string: 'success',
  number: 'warning',
  comment: 'muted',
  function: 'info',
  type: 'primary',
  builtin: 'info',
  variable: 'text',
  property: 'info',
  operator: 'muted',
  punctuation: 'muted',
  tag: 'error',
  attr: 'warning',
  constant: 'warning',
  regex: 'error',
  decorator: 'accent',
  heading: 'primary',
}

export function tokenColor(type: CodeTokenType, theme?: Theme, overrides?: Partial<Record<CodeTokenType, string>>): string {
  const o = overrides?.[type]
  if (o) return o
  const key = `syntax.${type}`
  if (theme && theme[key] !== undefined) return theme[key]
  return SYNTAX_COLORS[type]
}

/** Parses `[1, 3]`, `'1,3-5'` into a set of line numbers. */
export function parseLineSet(v: number[] | string | number | undefined): Set<number> {
  const out = new Set<number>()
  if (v === undefined || v === null) return out
  if (typeof v === 'number') return out.add(v)
  if (Array.isArray(v)) {
    for (const n of v) out.add(Number(n))
    return out
  }
  for (const part of String(v).split(/[\s,]+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part)
    if (!m) continue
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i)
  }
  return out
}

// ------------------------------------------------------------------ component

/**
 * Syntax highlighted source code.
 *   <Code :code="src" language="ts" line-numbers :highlight="[3, 4]" title="main.ts" />
 * Languages: js/ts (jsx/tsx), json, html/vue/xml, css/scss, bash/sh, python, markdown, plain.
 */
export const Code = defineComponent({
  name: 'Code',
  props: {
    code: { type: String, default: undefined },
    language: { type: String, default: undefined },
    lang: { type: String, default: undefined },
    lineNumbers: Boolean,
    /** First line number. */
    startLine: { type: Number, default: 1 },
    /** Highlighted lines: `[2, 5]` or `'2,4-6'` (line numbers as displayed). */
    highlight: { type: [Array, String, Number] as PropType<number[] | string | number>, default: undefined },
    /** Wrap long lines (default: clip). */
    wrap: Boolean,
    title: String,
    border: { type: String, default: 'round' },
    /** Per-token-type color overrides, e.g. `{ keyword: 'magenta' }`. */
    colors: { type: Object as PropType<Partial<Record<CodeTokenType, string>>>, default: undefined },
    /** Trim leading/trailing blank lines and common indentation. */
    dedentCode: { type: Boolean, default: true },
    bg: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const theme = useTheme()
    const source = () => {
      let src = props.code ?? textOf(slots.default?.())
      if (props.dedentCode) src = dedentCode(src)
      return src
    }
    const language = computed(() => normalizeLanguage(props.language ?? props.lang))
    return () => {
      const src = source()
      const lines = tokenizeCodeLines(src, language.value)
      if (lines.length > 1 && lines[lines.length - 1].length === 0 && src.endsWith('\n')) lines.pop()
      const hl = parseLineSet(props.highlight)
      const last = props.startLine + lines.length - 1
      const numW = String(last).length
      const th = theme.value
      const rows = lines.map((toks, i) => {
        const no = props.startLine + i
        const marked = hl.has(no)
        const spans: VNodeChild[] = toks.map((t) =>
          h('tui-text', { color: tokenColor(t.type, th, props.colors), italic: t.type === 'comment' || undefined, bold: t.type === 'heading' || undefined }, t.text),
        )
        return h('tui-box', { key: i, flexDirection: 'row', flexShrink: 0, bg: marked ? 'selection' : undefined }, [
          props.lineNumbers
            ? h('tui-text', { wrap: 'none', flexShrink: 0, color: marked ? 'warning' : 'muted', bold: marked }, `${String(no).padStart(numW)} ${marked ? '▌' : '│'} `)
            : marked
              ? h('tui-text', { wrap: 'none', flexShrink: 0, color: 'warning' }, '▌')
              : null,
          h('tui-box', { flexGrow: 1, flexShrink: 1, overflow: 'hidden' }, [h('tui-text', { wrap: props.wrap ? 'wrap' : 'none' }, spans.length ? spans : [' '])]),
        ])
      })
      const bordered = props.border !== 'none'
      return h(
        'tui-box',
        {
          flexDirection: 'column',
          border: props.border,
          borderColor: 'border',
          title: props.title,
          titleColor: 'muted',
          paddingX: bordered ? 1 : 0,
          bg: props.bg,
          // never squash the lines vertically, but let the block get narrower than its
          // longest line (in a row, next to other blocks): each line clips on its own
          minHeight: rows.length + (bordered ? 2 : 0),
          flexShrink: 1,
        },
        rows,
      )
    }
  },
})

function textOf(nodes: unknown): string {
  if (nodes == null || typeof nodes === 'boolean') return ''
  if (typeof nodes === 'string' || typeof nodes === 'number') return String(nodes)
  if (Array.isArray(nodes)) return nodes.map(textOf).join('')
  const c = (nodes as { children?: unknown }).children
  return typeof c === 'string' ? c : Array.isArray(c) ? textOf(c) : ''
}

/** Removes leading/trailing blank lines and common indentation. */
export function dedentCode(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  let min = Infinity
  for (const l of lines) if (l.trim()) min = Math.min(min, /^[ \t]*/.exec(l)![0].length)
  return lines.map((l) => l.slice(Number.isFinite(min) ? min : 0)).join('\n')
}
