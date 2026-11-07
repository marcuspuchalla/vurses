import { describe, expect, it } from 'vitest'
import { render } from '../../src/testing.js'
import { defineComponent, h } from 'vue'
import { Code, dedentCode, normalizeLanguage, parseLineSet, tokenizeCode, tokenizeCodeLines } from '../../src/components/code.js'
import { fgAt, rgb, tpl } from './helpers.js'
import { darkTheme } from '../../src/style/theme.js'

const types = (code: string, lang: string) =>
  tokenizeCode(code, lang)
    .filter((t) => t.text.trim())
    .map((t) => `${t.type}:${t.text}`)

describe('tokenizer', () => {
  it('highlights TypeScript', () => {
    const t = types(`const x: number = foo(1.5) / 2 // hi`, 'typescript')
    expect(t).toEqual(['keyword:const', 'variable:x', 'punctuation::', 'type:number', 'operator:=', 'function:foo', 'punctuation:(', 'number:1.5', 'punctuation:)', 'operator:/', 'number:2', 'comment:// hi'])
  })

  it('distinguishes regex literals from division', () => {
    expect(types(`a = /x+/g`, 'js')).toContain('regex:/x+/g')
    expect(types(`a = b / c / d`, 'js')).not.toContain('regex:/ c /')
  })

  it('handles multi-line comments and template strings', () => {
    const lines = tokenizeCodeLines('/* a\n b */ x = `t\n${y}`', 'js')
    expect(lines[0]).toEqual([{ type: 'comment', text: '/* a' }])
    expect(lines[1][0]).toEqual({ type: 'comment', text: ' b */' })
    expect(lines[2]).toEqual([{ type: 'string', text: '${y}`' }])
  })

  it('highlights JSON keys and values', () => {
    expect(types(`{"a": 1, "b": [true, "s"]}`, 'json')).toEqual(['punctuation:{', 'property:"a"', 'punctuation::', 'number:1', 'punctuation:,', 'property:"b"', 'punctuation::', 'punctuation:[', 'constant:true', 'punctuation:,', 'string:"s"', 'punctuation:]}'])
  })

  it('highlights Vue SFCs with embedded script/style', () => {
    const t = types(`<template><div :class="c" id="x">{{ msg }}</div></template>\n<script setup lang="ts">\nconst a = 1\n</script>\n<style>.a { color: red; }</style>`, 'vue')
    expect(t).toContain('tag:template')
    expect(t).toContain('keyword::class')
    expect(t).toContain('attr:id')
    expect(t).toContain('string:"x"')
    expect(t).toContain('variable:msg')
    expect(t).toContain('keyword:const')
    expect(t).toContain('number:1')
    expect(t).toContain('property:color')
  })

  it('highlights HTML comments and entities', () => {
    expect(types(`<!-- c --><p class="a">&amp;</p>`, 'html')).toEqual(['comment:<!-- c -->', 'punctuation:<', 'tag:p', 'attr:class', 'operator:=', 'string:"a"', 'punctuation:>', 'constant:&amp;', 'punctuation:</', 'tag:p', 'punctuation:>'])
  })

  it('highlights CSS', () => {
    const t = types(`@media (max-width: 10px) { .btn:hover { color: #fff !important; } }`, 'scss')
    expect(t).toContain('keyword:@media')
    expect(t).toContain('property:max-width')
    expect(t).toContain('number:10px')
    expect(t).toContain('attr:.btn:hover')
    expect(t).toContain('number:#fff')
    expect(t).toContain('keyword:!important')
  })

  it('highlights bash', () => {
    const t = types(`export FOO=bar # c\nif [ -f "$FOO" ]; then echo $HOME | grep -v x; fi`, 'sh')
    expect(t).toEqual(expect.arrayContaining(['keyword:export', 'variable:FOO', 'comment:# c', 'keyword:if', 'attr:-f', 'string:"$FOO"', 'function:echo', 'variable:$H', 'function:grep', 'attr:-v', 'keyword:fi']))
  })

  it('highlights python', () => {
    const t = types(`@dec\ndef foo(a, b=2):\n    """doc"""\n    return len(a) # c\nclass A(B): pass`, 'py')
    expect(t).toEqual(expect.arrayContaining(['decorator:@dec', 'keyword:def', 'function:foo', 'string:"""doc"""', 'keyword:return', 'builtin:len', 'comment:# c', 'type:A', 'keyword:pass']))
  })

  it('falls back to plain text', () => {
    expect(normalizeLanguage('cobol')).toBe('plain')
    expect(tokenizeCode('x = 1', 'cobol')).toEqual([{ type: 'plain', text: 'x = 1' }])
  })

  it('parses line sets and dedents', () => {
    expect([...parseLineSet('1,3-5')]).toEqual([1, 3, 4, 5])
    expect(dedentCode('\n    a\n      b\n')).toBe('a\n  b')
  })
})

describe('Code', () => {
  it('renders line numbers, a title and highlighted lines', async () => {
    const code = 'const a = 1\nconst b = 2\nconsole.log(a + b)'
    const r = await render(tpl(`<Code :code="code" lang="ts" line-numbers title="main.ts" :highlight="[2]" />`, () => ({ code })), { columns: 34, rows: 6 })
    expect(r.lastFrame()).toBe(
      [
        '╭─ main.ts ──────────────────────╮',
        '│ 1 │ const a = 1                │',
        '│ 2 ▌ const b = 2                │',
        '│ 3 │ console.log(a + b)         │',
        '╰────────────────────────────────╯',
      ].join('\n'),
    )
    // keyword color = theme accent
    expect(fgAt(r, 6, 1)).toBe(rgb(darkTheme.accent))
    // number color = theme warning
    expect(fgAt(r, 16, 1)).toBe(rgb(darkTheme.warning))
  })

  it('clips long lines by default and wraps with wrap', async () => {
    const code = 'const message = "a very long string that does not fit"'
    let r = await render(tpl(`<Code :code="code" lang="js" border="none" />`, () => ({ code })), { columns: 20, rows: 3 })
    expect(r.lastFrame()).toBe('const message = "a v')
    r = await render(tpl(`<Code :code="code" lang="js" border="none" wrap />`, () => ({ code })), { columns: 20, rows: 4 })
    expect(r.lastFrame().split('\n').length).toBeGreaterThan(1)
  })

  it('uses slot text (render functions) and dedents it', async () => {
    const App = defineComponent({ render: () => h(Code, { lang: 'py', border: 'none' }, () => '\n        def f():\n            return 1\n    ') })
    const r = await render(App, { columns: 20, rows: 3 })
    expect(r.lastFrame()).toBe('def f():\n    return 1')
  })

  it('uses theme overrides (syntax.<type>)', async () => {
    const theme = { ...darkTheme, name: 'x', 'syntax.keyword': '#ff0000' }
    const r = await render(tpl(`<Code code="let x" lang="js" border="none" />`), { columns: 10, rows: 1, theme })
    expect(fgAt(r, 0, 0)).toBe(rgb('#ff0000'))
  })
})
