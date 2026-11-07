/** Tags understood natively by the renderer (usable directly in templates). */
export const TERMINAL_TAGS = new Set([
  'tui-root', 'tui-box', 'tui-text', 'tui-newline', 'box', 'text', 'span', 'br', 'view',
])

// compiler-core NodeTypes (kept numeric so this module has no compiler dependency)
const ROOT = 0
const ELEMENT = 1
const TEXT = 2

interface AstNode {
  type: number
  content?: unknown
  children?: AstNode[]
}

/**
 * Terminal whitespace rules for templates: whitespace that contains a newline
 * is source formatting and is collapsed (or dropped at the start/end of an
 * element); plain spaces are kept verbatim, because in a terminal UI they are
 * usually intentional ("●  label").
 */
export function terminalWhitespace(node: AstNode) {
  if ((node.type !== ROOT && node.type !== ELEMENT) || !node.children) return
  const kids = node.children
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]
    if (c.type !== TEXT || typeof c.content !== 'string') continue
    let t = c.content
    if (!t.includes('\n')) continue
    if (/^\s*$/.test(t)) {
      kids.splice(i--, 1)
      continue
    }
    const first = i === 0
    const last = i === kids.length - 1
    t = t.replace(/^[ \t]*\r?\n\s*/, first ? '' : ' ')
    t = t.replace(/\s*\r?\n[ \t]*$/, last ? '' : ' ')
    t = t.replace(/[ \t]*\r?\n\s*/g, ' ')
    c.content = t
  }
}

/** Template compiler options that make Vue treat terminal tags as elements. */
export const compilerOptions = {
  isCustomElement: (tag: string) => TERMINAL_TAGS.has(tag),
  // static-content stringification produces DOM-only HTML strings
  hoistStatic: false,
  whitespace: 'preserve' as const,
  nodeTransforms: [terminalWhitespace as (node: any) => void],
}
