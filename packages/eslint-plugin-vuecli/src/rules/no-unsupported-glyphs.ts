import type { Rule } from 'eslint'
import { BLOCKS, DEFAULT_BLOCKS, EMOJI_BLOCKS, blockOf } from '../blocks.js'
import { DOCS, defineTemplateVisitor, type VNode } from '../utils.js'

export interface GlyphOptions {
  /** Allowed Unicode block names (replaces the default list). */
  allowedBlocks?: string[]
  /** Extra block names added to the allowed list. */
  additionalBlocks?: string[]
  /** Extra code point ranges, inclusive: [[0xe000, 0xf8ff]]. */
  allowedRanges?: [number, number][]
  /** Individual characters that are always allowed. */
  allowChars?: string
  /** Allow single-codepoint emoji (default true). Sequences are still checked. */
  allowEmoji?: boolean
  /** Report ZWJ sequences, variation selectors, skin tones, flags, keycaps and tag sequences (default true). */
  checkSequences?: boolean
}

type Issue = { messageId: string; index: number; length: number; data: Record<string, string> }

const SEQUENCES: { test: (cp: number) => boolean; kind: string }[] = [
  { test: (cp) => cp === 0x200d, kind: 'a zero-width joiner (emoji ZWJ sequence)' },
  { test: (cp) => (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef), kind: 'a variation selector' },
  { test: (cp) => cp >= 0x1f3fb && cp <= 0x1f3ff, kind: 'an emoji skin-tone modifier' },
  { test: (cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff, kind: 'a regional-indicator flag' },
  { test: (cp) => cp === 0x20e3, kind: 'a keycap sequence' },
  { test: (cp) => cp >= 0xe0020 && cp <= 0xe007f, kind: 'a tag sequence' },
]

const hex = (cp: number) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')

/** Builds a checker from options; exported for tooling and tests. */
export function createGlyphChecker(opts: GlyphOptions = {}) {
  const names = [...(opts.allowedBlocks ?? DEFAULT_BLOCKS), ...(opts.additionalBlocks ?? []), ...(opts.allowEmoji === false ? [] : EMOJI_BLOCKS)]
  const ranges: [number, number][] = [...names.map((n) => BLOCKS[n]).filter(Boolean), ...(opts.allowedRanges ?? [])]
  const chars = new Set([...(opts.allowChars ?? '')].map((c) => c.codePointAt(0)!))
  const sequences = opts.checkSequences !== false
  const allowed = (cp: number) => chars.has(cp) || ranges.some(([a, b]) => cp >= a && cp <= b)

  /** Returns the problems in a string (at most one sequence and one block issue per distinct code point). */
  return function check(text: string): Issue[] {
    const issues: Issue[] = []
    const seen = new Set<number>()
    let index = 0
    for (const ch of text) {
      const cp = ch.codePointAt(0)!
      const i = index
      index += ch.length
      if (cp < 0x80 || seen.has(cp)) continue
      seen.add(cp)
      if (chars.has(cp)) continue
      const seq = sequences ? SEQUENCES.find((s) => s.test(cp)) : undefined
      if (seq) {
        issues.push({ messageId: 'sequence', index: i, length: ch.length, data: { kind: seq.kind, code: hex(cp) } })
        continue
      }
      if (SEQUENCES.some((s) => s.test(cp))) continue // sequences disabled
      if (!allowed(cp)) {
        const block = blockOf(cp)
        issues.push({
          messageId: block === 'Private Use Area' || block?.startsWith('Supplementary Private Use') ? 'privateUse' : 'block',
          index: i,
          length: ch.length,
          data: { char: ch, code: hex(cp), block: block ?? 'an unlisted block' },
        })
      }
    }
    return issues
  }
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow glyphs that commonly render wrong or are missing in terminal fonts',
      recommended: true,
      url: `${DOCS}#vueclino-unsupported-glyphs`,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedBlocks: { type: 'array', items: { type: 'string', enum: Object.keys(BLOCKS) }, uniqueItems: true },
          additionalBlocks: { type: 'array', items: { type: 'string', enum: Object.keys(BLOCKS) }, uniqueItems: true },
          allowedRanges: {
            type: 'array',
            items: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 0x10ffff }, minItems: 2, maxItems: 2 },
          },
          allowChars: { type: 'string' },
          allowEmoji: { type: 'boolean' },
          checkSequences: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      sequence:
        'This text contains {{kind}} ({{code}}). Many terminals (and fonts like Menlo) draw such sequences as several glyphs or with the wrong width, which misaligns the layout.',
      block: "'{{char}}' ({{code}}, {{block}}) is outside the allowed Unicode blocks and is often missing from Menlo and common terminal fonts.",
      privateUse: "'{{char}}' ({{code}}) is a private-use code point (e.g. a Nerd Font icon): it only renders with a patched font. Allow it with `allowedRanges` if your users have one.",
    },
  },
  create(context) {
    const check = createGlyphChecker((context.options[0] ?? {}) as GlyphOptions)
    const source = context.sourceCode

    /** Reports issues of `text`, which starts at source offset `start`. */
    const report = (node: VNode | Rule.Node, text: string, start: number | null) => {
      for (const issue of check(text)) {
        const loc =
          start !== null
            ? { start: source.getLocFromIndex(start + issue.index), end: source.getLocFromIndex(start + issue.index + issue.length) }
            : (node.loc as Rule.Node['loc'])!
        context.report({ loc, messageId: issue.messageId, data: issue.data })
      }
    }
    // offset of the cooked text inside the raw source (only exact when raw === value: no escapes)
    const offsetOf = (node: { range?: [number, number] }, raw: string, value: string, quote: number) =>
      node.range && raw.slice(quote, raw.length - quote) === value ? node.range[0] + quote : null

    const literal = (node: Rule.Node & { value?: unknown; raw?: string }) => {
      if (typeof node.value !== 'string') return
      report(node, node.value, offsetOf(node, node.raw ?? '', node.value, 1))
    }
    const templateElement = (node: Rule.Node & { value: { raw: string; cooked: string | null } }) => {
      const text = node.value.cooked ?? node.value.raw
      const range = (node as { range?: [number, number] }).range
      // TemplateElement ranges include the surrounding ` / } and ${ / `
      report(node, text, range && node.value.raw === text ? range[0] + 1 : null)
    }
    const script = { Literal: literal, TemplateElement: templateElement } as unknown as Record<string, (n: any) => void>
    return defineTemplateVisitor(
      context,
      {
        ...script,
        VText(node: VNode & { value: string }) {
          const raw = source.text.slice(node.range[0], node.range[1])
          report(node, node.value, raw === node.value ? node.range[0] : null)
        },
        VLiteral(node: VNode & { value: string }) {
          const raw = source.text.slice(node.range[0], node.range[1])
          const q = raw[0] === '"' || raw[0] === "'" ? 1 : 0
          report(node, node.value, raw.slice(q, raw.length - q) === node.value ? node.range[0] + q : null)
        },
      },
      script,
    )
  },
}
export default rule
