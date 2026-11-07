import { describe, expect, it } from 'vitest'
import { callExpression, evalBridge, HookMissingError } from '../src/bridge.js'
import { detailsHtml, findNode, formatBytes, rectText, summarize, timelineSvg, treeHtml } from '../src/view.js'
import type { ComponentInfo } from '../../../src/devtools/tree.js'

const tree: ComponentInfo[] = [
  {
    id: 1, name: 'App', props: {}, rect: { x: 0, y: 0, width: 80, height: 24 }, elements: [2],
    children: [
      { id: 3, name: 'Sidebar', props: { open: true }, rect: { x: 0, y: 0, width: 20, height: 24 }, elements: [4], children: [] },
      { id: 5, name: 'List<T>', props: {}, rect: null, elements: [], children: [] },
    ],
  },
]

describe('view helpers', () => {
  it('renders the component tree with selection, collapse and filter', () => {
    const html = treeHtml(tree, 3, new Set())
    expect(html).toContain('<div class="row selected" data-id="3">')
    expect(html).toContain('&lt;List&lt;T&gt;&gt;')
    expect(html).toContain('<span class="rect">0,0 80×24</span>')
    expect(html).toContain('<span class="rect">—</span>')
    expect(treeHtml(tree, null, new Set([1]))).not.toContain('Sidebar')
    const filtered = treeHtml(tree, null, new Set([1]), 'side')
    expect(filtered).toContain('Sidebar')
    expect(filtered).not.toContain('List')
    expect(treeHtml([], null, new Set())).toContain('No components')
    expect(findNode(tree, 5)!.name).toBe('List<T>')
    expect(findNode(tree, 99)).toBeNull()
  })

  it('renders details', () => {
    const html = detailsHtml({ id: 3, name: 'Sidebar', file: '/x/Sidebar.vue', props: { open: true, title: 'a"b' }, rect: { x: 1, y: 2, width: 3, height: 4 }, elements: [4], setupState: {}, childCount: 0 })
    expect(html).toContain('&lt;Sidebar&gt; <span class="muted">#3</span>')
    expect(html).toContain('<span class="v-num">true</span>')
    expect(html).toContain('&quot;a\\&quot;b&quot;')
    expect(html).toContain('1,2 3×4')
    expect(html).toContain('<td class="empty">none</td>')
    expect(detailsHtml(null)).toContain('Select a component')
  })

  it('renders the timeline', () => {
    const recs = [
      { frame: 1, time: 0, ms: 2, bytes: 100, changedRows: 3 },
      { frame: 2, time: 0, ms: 32, bytes: 0, changedRows: 0 },
    ]
    const svg = timelineSvg(recs)
    expect(svg).toContain('<rect class="ok"')
    expect(svg).toContain('<rect class="slow"')
    expect(svg).toContain('<title>frame 2: 32 ms, 0 B, 0 rows changed</title>')
    expect(timelineSvg([])).toContain('No frames yet')
    expect(summarize(recs)).toEqual({ frames: 2, avgMs: 17, maxMs: 32, avgBytes: 50, totalBytes: 100 })
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(rectText(null)).toBe('—')
  })
})

describe('bridge', () => {
  const run = (hook: unknown) => (expr: string, cb: (r: unknown, ex?: { isException?: boolean; value?: string }) => void) => {
    try {
      cb(new Function('window', `return ${expr}`)({ __VUECLI_DEVTOOLS_HOOK__: hook }))
    } catch (e) {
      cb(undefined, { isException: true, value: String(e) })
    }
  }
  it('calls hook methods with JSON arguments', async () => {
    const hook = { add: (a: number, b: number) => a + b, nothing: () => undefined, later: async () => 1 }
    const b = evalBridge(run(hook))
    expect(await b.call('add', 2, 3)).toBe(5)
    expect(await b.call('nothing')).toBeNull()
    expect(await b.call('later')).toBeNull()
    expect(callExpression('x', ['a"b'])).toContain('["a\\"b"]')
  })
  it('reports a missing hook or method', async () => {
    await expect(evalBridge(run(undefined)).call('getState')).rejects.toBeInstanceOf(HookMissingError)
    await expect(evalBridge(run({})).call('getState')).rejects.toBeInstanceOf(HookMissingError)
    await expect(evalBridge(run({ boom: () => { throw new Error('x') } })).call('boom')).rejects.toThrow(/x/)
  })
})
