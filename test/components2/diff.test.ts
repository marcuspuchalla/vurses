import { describe, expect, it } from 'vitest'
import { render } from '../../src/testing.js'
import { diffLines, diffWords, myersDiff, parseUnifiedDiff } from '../../src/components/diff.js'
import { bgAt, tpl } from './helpers.js'

const apply = (a: string[], b: string[]) => {
  // re-create b from the edit script to check correctness
  const out: string[] = []
  for (const op of myersDiff(a, b)) if (op.type !== 'delete') out.push(op.type === 'equal' ? a[op.a] : b[op.b])
  return out
}

describe('myersDiff', () => {
  it('produces a minimal, valid edit script', () => {
    const a = 'ABCABBA'.split('')
    const b = 'CBABAC'.split('')
    const ops = myersDiff(a, b)
    expect(apply(a, b)).toEqual(b)
    // the classic example has edit distance 5
    expect(ops.filter((o) => o.type !== 'equal')).toHaveLength(5)
  })

  it('handles empty and identical inputs', () => {
    expect(myersDiff([], [])).toEqual([])
    expect(myersDiff(['a'], ['a'])).toEqual([{ type: 'equal', a: 0, b: 0 }])
    expect(myersDiff([], ['x']).map((o) => o.type)).toEqual(['insert'])
    expect(myersDiff(['x'], []).map((o) => o.type)).toEqual(['delete'])
  })

  it('round-trips random sequences', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) % 5) + ''
    for (let i = 0; i < 50; i++) {
      const a = Array.from({ length: 1 + (i % 13) }, rnd)
      const b = Array.from({ length: 1 + ((i * 7) % 11) }, rnd)
      expect(apply(a, b)).toEqual(b)
    }
  })
})

describe('diffLines / parseUnifiedDiff', () => {
  const a = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n'
  const b = 'one\ntwo\nTHREE\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\n'

  it('groups changes into hunks with context', () => {
    const hunks = diffLines(a, b, 1)
    expect(hunks.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines])).toEqual([
      [2, 3, 2, 3],
      [10, 1, 10, 2],
    ])
    expect(hunks[0].lines.map((l) => l.type)).toEqual(['context', 'del', 'add', 'context'])
  })

  it('reports the line before a pure insertion', () => {
    expect(diffLines('a\nb\n', 'x\na\nb\n', 0).map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines])).toEqual([[0, 0, 1, 1]])
  })

  it('parses multi-file git diffs', () => {
    const text = [
      'diff --git a/x.js b/x.js',
      'index 1..2 100644',
      '--- a/x.js',
      '+++ b/x.js',
      '@@ -1,3 +1,3 @@ function f()',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      ' const c = 4',
      'diff --git a/y.txt b/y.txt',
      '--- a/y.txt',
      '+++ b/y.txt',
      '@@ -5 +5,2 @@',
      ' x',
      '+y',
      '\\ No newline at end of file',
    ].join('\n')
    const files = parseUnifiedDiff(text)
    expect(files.map((f) => f.newName)).toEqual(['x.js', 'y.txt'])
    expect(files[0].hunks[0].section).toBe('function f()')
    expect(files[0].hunks[0].lines.map((l) => [l.type, l.oldNo, l.newNo])).toEqual([
      ['context', 1, 1],
      ['del', 2, undefined],
      ['add', undefined, 2],
      ['context', 3, 3],
    ])
    expect(files[1].hunks[0].lines).toHaveLength(2)
  })

  it('diffs words', () => {
    const w = diffWords('const b = 2', 'const b = 3')
    expect(w.old).toEqual([{ text: 'const b = ', changed: false }, { text: '2', changed: true }])
    expect(w.new).toEqual([{ text: 'const b = ', changed: false }, { text: '3', changed: true }])
  })
})

describe('Diff', () => {
  const a = 'one\ntwo\nthree\nfour\n'
  const b = 'one\ntwo\nTHREE\nfour\nfive\n'

  it('renders a unified view with line numbers and stats', async () => {
    const r = await render(tpl(`<Diff :old="a" :new="b" filename="n.txt" :context="1" />`, () => ({ a, b })), { columns: 30, rows: 10 })
    expect(r.lastFrame()).toBe(
      [
        '╭─ n.txt  +2 -1 ─────────────╮',
        '│ @@ -2,3 +2,4 @@            │',
        '│ 2 2   two                  │',
        '│ 3   - three                │',
        '│   3 + THREE                │',
        '│ 4 4   four                 │',
        '│   5 + five                 │',
        '╰────────────────────────────╯',
      ].join('\n'),
    )
    // added / deleted rows get a tinted background
    expect(bgAt(r, 8, 3)).toMatch(/^48;2;/)
    expect(bgAt(r, 8, 4)).toMatch(/^48;2;/)
    expect(bgAt(r, 8, 4)).not.toBe(bgAt(r, 8, 3))
    expect(bgAt(r, 8, 2)).toBe('')
  })

  it('renders a split view', async () => {
    const r = await render(tpl(`<Diff :old="a" :new="b" :context="0" split border="none" />`, () => ({ a, b })), { columns: 31, rows: 6 })
    expect(r.lastFrame()).toBe(['@@ -3,1 +3,1 @@', '3 - three      │3 + THREE', '@@ -4,0 +5,1 @@', '               │5 + five'].join('\n'))
  })

  it('highlights changed words', async () => {
    const r = await render(tpl(`<Diff old="let x = 1" new="let x = 2" word-diff border="none" :line-numbers="false" />`), { columns: 20, rows: 4 })
    const frame = r.lastFrame().split('\n')
    expect(frame[1]).toBe('- let x = 1')
    const strong = bgAt(r, 10, 1)
    expect(strong).not.toBe(bgAt(r, 4, 1))
  })

  it('renders a unified diff string and shows "No changes"', async () => {
    let r = await render(tpl(`<Diff :diff="d" border="none" />`, () => ({ d: '--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n' })), { columns: 20, rows: 4 })
    expect(r.lastFrame()).toBe('@@ -1,1 +1,1 @@\n1   - a\n  1 + b')
    r = await render(tpl(`<Diff old="same" new="same" />`), { columns: 20, rows: 4 })
    expect(r.lastFrame()).toContain('No changes')
  })
})
